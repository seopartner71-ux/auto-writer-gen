import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, CheckCircle2, Circle, AlertCircle, RefreshCw, Square,
  ChevronDown, Pencil, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type SectionStatus = "pending" | "generating" | "done" | "error";

interface SectionRow {
  id: string;
  article_id: string;
  section_index: number;
  h2_title: string;
  content: string;
  status: SectionStatus;
  error_message: string | null;
}

interface Props {
  articleId: string;
  keyword: string;
  language?: string;
  personaPrompt?: string;
  /** Existing outline (e.g. from Research/Plan step). */
  existingOutline?: { text: string }[];
  /** Called after generation completes (or is stopped) with the assembled markdown. */
  onComplete?: (markdown: string, h1: string) => void;
}

const FUN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const PUB_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export function SectionedGenerator({
  articleId, keyword, language = "ru", personaPrompt = "",
  existingOutline, onComplete,
}: Props) {
  const [h1, setH1] = useState<string>("");
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [phase, setPhase] = useState<"idle" | "outlining" | "running" | "done" | "stopped">("idle");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [liveText, setLiveText] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const stopFlag = useRef(false);
  const [editPromptFor, setEditPromptFor] = useState<SectionRow | null>(null);
  const [promptText, setPromptText] = useState("");

  const total = sections.length;
  const doneCount = sections.filter(s => s.status === "done").length;
  const progress = total ? Math.round((doneCount / total) * 100) : 0;

  // Load existing sections (resume)
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("article_sections")
        .select("id,article_id,section_index,h2_title,content,status,error_message")
        .eq("article_id", articleId)
        .order("section_index", { ascending: true });
      if (!mounted) return;
      if (data && data.length) {
        setSections(data as SectionRow[]);
        setH1((data as any[])[0]?.h2_title && (data as any[])[0].section_index === 0 && (data as any[])[0].h2_title.startsWith("__H1__:")
          ? (data as any[])[0].h2_title.replace("__H1__:", "")
          : "");
      }
    })();
    return () => { mounted = false; };
  }, [articleId]);

  // Realtime subscription to keep section rows in sync
  useEffect(() => {
    const ch = supabase
      .channel(`sections-${articleId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "article_sections",
        filter: `article_id=eq.${articleId}`,
      }, (payload: any) => {
        const row = payload.new as SectionRow;
        if (!row) return;
        setSections(prev => {
          const idx = prev.findIndex(s => s.id === row.id);
          if (idx === -1) return [...prev, row].sort((a, b) => a.section_index - b.section_index);
          const copy = [...prev]; copy[idx] = { ...copy[idx], ...row }; return copy;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [articleId]);

  async function ensureOutline(): Promise<{ h1: string; h2: string[] } | null> {
    setPhase("outlining");
    try {
      const { data, error } = await supabase.functions.invoke("generate-section-outline", {
        body: { keyword, language, existing_outline: existingOutline },
      });
      if (error) throw error;
      if (!data?.h1 || !Array.isArray(data?.h2)) throw new Error("Bad outline response");
      return { h1: data.h1, h2: data.h2 };
    } catch (e: any) {
      toast.error(`Не удалось сгенерировать структуру: ${e?.message || e}`);
      setPhase("idle");
      return null;
    }
  }

  async function createSectionRows(h1Title: string, h2: string[]) {
    // Compose blueprint: intro (no H2), each H2, FAQ, conclusion
    const blueprint: { title: string; kind: "intro" | "h2" | "faq" | "conclusion" }[] = [
      { title: "Введение", kind: "intro" },
      ...h2.map(t => ({ title: t, kind: "h2" as const })),
      { title: "Часто задаваемые вопросы", kind: "faq" },
      { title: "Заключение", kind: "conclusion" },
    ];

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    // Wipe previous sections (fresh run)
    await supabase.from("article_sections").delete().eq("article_id", articleId);

    const rows = blueprint.map((b, i) => ({
      article_id: articleId,
      user_id: user.id,
      section_index: i,
      h2_title: b.title,
      status: "pending" as const,
      content: "",
      prompt: b.kind, // store kind in prompt column for now
    }));
    const { data, error } = await supabase
      .from("article_sections")
      .insert(rows)
      .select("*");
    if (error) throw error;
    setSections(data as SectionRow[]);
    setH1(h1Title);
    return data as SectionRow[];
  }

  async function streamSection(
    section: SectionRow,
    h1Title: string,
    allH2: string[],
    extraPrompt = "",
  ): Promise<void> {
    const kind = (section as any).prompt as "intro" | "h2" | "faq" | "conclusion";
    setActiveIndex(section.section_index);
    setLiveText("");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const { data: { session } } = await supabase.auth.getSession();
    const auth = session?.access_token ? `Bearer ${session.access_token}` : `Bearer ${PUB_KEY}`;

    const resp = await fetch(`${FUN_BASE}/generate-section-stream`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({
        article_id: articleId,
        section_id: section.id,
        h1_title: h1Title,
        h2_title: section.h2_title,
        all_h2_titles: allH2,
        section_index: section.section_index,
        total_sections: sections.length || allH2.length,
        keyword,
        language,
        persona_prompt: personaPrompt,
        section_kind: kind,
        extra_prompt: extraPrompt,
      }),
    });

    if (!resp.ok || !resp.body) {
      const t = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${t.slice(0, 120)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let acc = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) !== -1) {
        let line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          const delta = j?.choices?.[0]?.delta?.content;
          if (delta) {
            acc += delta;
            setLiveText(acc);
          }
        } catch { /* partial */ }
      }
    }
    abortRef.current = null;
    setActiveIndex(null);
    setLiveText("");
  }

  async function startGeneration() {
    stopFlag.current = false;
    const outline = await ensureOutline();
    if (!outline) return;

    let rows: SectionRow[];
    try {
      rows = await createSectionRows(outline.h1, outline.h2);
    } catch (e: any) {
      toast.error(`Ошибка создания разделов: ${e?.message || e}`);
      setPhase("idle");
      return;
    }

    setPhase("running");
    const h2Only = outline.h2;

    for (const row of rows) {
      if (stopFlag.current) {
        setPhase("stopped");
        toast(`Генерация остановлена. Готово ${rows.filter(r => r.status === "done").length} из ${rows.length}.`);
        finalize();
        return;
      }
      try {
        await streamSection(row, outline.h1, h2Only);
      } catch (e: any) {
        if (e?.name === "AbortError") {
          setPhase("stopped");
          finalize();
          return;
        }
        toast.error(`Ошибка раздела "${row.h2_title}": ${e?.message || e}`);
      }
    }
    setPhase("done");
    finalize();
  }

  function stopGeneration() {
    stopFlag.current = true;
    abortRef.current?.abort();
  }

  async function finalize() {
    // Refetch latest content & assemble
    const { data } = await supabase
      .from("article_sections")
      .select("*")
      .eq("article_id", articleId)
      .order("section_index", { ascending: true });
    const list = (data || []) as SectionRow[];
    const md = `# ${h1}\n\n` + list.filter(s => s.status === "done").map(s => s.content.trim()).join("\n\n");
    onComplete?.(md, h1);
  }

  async function regenerateOne(s: SectionRow, extraPrompt = "") {
    if (!h1) {
      const { data: a } = await supabase.from("articles").select("title").eq("id", articleId).maybeSingle();
      if (a?.title) setH1(a.title);
    }
    const allH2 = sections.filter(x => (x as any).prompt === "h2").map(x => x.h2_title);
    setPhase("running");
    try {
      await streamSection(s, h1 || keyword, allH2, extraPrompt);
      toast.success(`Раздел "${s.h2_title}" обновлен`);
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.error(`Ошибка: ${e?.message || e}`);
    } finally {
      setPhase("idle");
      finalize();
    }
  }

  async function deleteSection(s: SectionRow) {
    await supabase.from("article_sections").delete().eq("id", s.id);
    setSections(prev => prev.filter(x => x.id !== s.id));
  }

  const showResume = useMemo(
    () => phase === "idle" && sections.some(s => s.status === "done") && sections.some(s => s.status !== "done"),
    [phase, sections],
  );

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">Тема</div>
            <div className="font-medium truncate">{keyword}</div>
          </div>
          <div className="flex gap-2">
            {phase === "running" || phase === "outlining" ? (
              <Button variant="destructive" size="sm" onClick={stopGeneration}>
                <Square className="size-4 mr-1" /> Остановить
              </Button>
            ) : (
              <Button size="sm" onClick={startGeneration} disabled={!keyword}>
                <Sparkles className="size-4 mr-1" />
                {sections.length ? "Перегенерировать всё" : "Сгенерировать"}
              </Button>
            )}
          </div>
        </div>

        {(total > 0) && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{phase === "outlining" ? "Создаю структуру..." : `Готово ${doneCount} из ${total}`}</span>
              <span>{progress}%</span>
            </div>
            <Progress value={phase === "outlining" ? 5 : progress} />
          </div>
        )}

        {showResume && (
          <div className="text-xs rounded-md border border-dashed border-primary/40 bg-primary/5 p-2">
            Найдена незавершенная статья. Нажмите "Сгенерировать", чтобы начать заново, или используйте 🔄 на нужных разделах.
          </div>
        )}
      </Card>

      <div className="space-y-2">
        {sections.map((s) => {
          const isActive = activeIndex === s.section_index;
          const Icon = s.status === "done" ? CheckCircle2
            : s.status === "generating" || isActive ? Loader2
            : s.status === "error" ? AlertCircle : Circle;
          const iconCls = s.status === "done" ? "text-emerald-500"
            : s.status === "error" ? "text-destructive"
            : isActive || s.status === "generating" ? "text-primary animate-spin"
            : "text-muted-foreground";
          return (
            <Card key={s.id} className="p-3">
              <div className="flex items-start gap-3">
                <Icon className={`size-5 mt-0.5 shrink-0 ${iconCls}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm truncate">{s.h2_title}</div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={phase === "running" || phase === "outlining"}>
                          <ChevronDown className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => regenerateOne(s)}>
                          <RefreshCw className="size-4 mr-2" /> Перегенерировать раздел
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setEditPromptFor(s); setPromptText(""); }}>
                          <Pencil className="size-4 mr-2" /> Редактировать промт
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => deleteSection(s)} className="text-destructive">
                          Удалить раздел
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {(isActive && liveText) ? (
                    <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground max-h-40 overflow-auto">{liveText}</pre>
                  ) : s.content ? (
                    <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground max-h-32 overflow-hidden line-clamp-6">{s.content.slice(0, 300)}{s.content.length > 300 ? "..." : ""}</pre>
                  ) : s.status === "error" && s.error_message ? (
                    <div className="mt-1 text-xs text-destructive">{s.error_message}</div>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!editPromptFor} onOpenChange={(o) => !o && setEditPromptFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Доп. инструкции для раздела</DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground mb-2">
            Раздел: <span className="font-medium">{editPromptFor?.h2_title}</span>
          </div>
          <Textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="Например: добавь конкретный пример из практики, упомяни цены в рублях..."
            rows={5}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditPromptFor(null)}>Отмена</Button>
            <Button onClick={() => {
              if (editPromptFor) regenerateOne(editPromptFor, promptText);
              setEditPromptFor(null);
            }}>
              <RefreshCw className="size-4 mr-1" /> Регенерировать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}