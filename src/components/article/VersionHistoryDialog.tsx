import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Loader2, RotateCcw, Trash2, History } from "lucide-react";
import { toast } from "sonner";

interface Version {
  id: string;
  article_id: string;
  reason: string;
  content: string;
  word_count: number | null;
  created_at: string | null;
  metadata?: any;
}

const REASON_LABEL: Record<string, string> = {
  auto_improve_before: "До авто-доработки",
  manual: "Ручное сохранение",
  humanize: "Humanize Fix",
  optimize: "Оптимизация",
  benchmark: "Benchmark",
  fix: "Правка",
  rewrite: "Rewrite",
  auto: "Авто",
};

export function VersionHistoryDialog() {
  const [open, setOpen] = useState(false);
  const [articleId, setArticleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [currentAi, setCurrentAi] = useState<number | null>(null);

  useEffect(() => {
    function onOpen(e: any) {
      const id = e?.detail?.articleId;
      if (!id) return;
      setArticleId(id);
      setOpen(true);
    }
    window.addEventListener("open-article-versions", onOpen as any);
    return () => window.removeEventListener("open-article-versions", onOpen as any);
  }, []);

  useEffect(() => {
    if (!open || !articleId) return;
    setLoading(true);
    (async () => {
      const [{ data: vs }, { data: art }] = await Promise.all([
        supabase.from("article_versions" as any).select("*").eq("article_id", articleId).order("created_at", { ascending: false }).limit(50),
        supabase.from("articles").select("ai_score").eq("id", articleId).maybeSingle(),
      ]);
      setVersions((vs as any) || []);
      setCurrentAi((art?.ai_score as any) ?? null);
      setLoading(false);
    })();
  }, [open, articleId]);

  async function revert(v: Version) {
    if (!articleId) return;
    if (!confirm("Откатить статью на эту версию? Текущая версия будет сохранена в истории.")) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: cur } = await supabase.from("articles").select("title,content,ai_score").eq("id", articleId).maybeSingle();
      // snapshot current first
      if (cur?.content && session?.user?.id) {
        await supabase.from("article_versions").insert({
          article_id: articleId,
          user_id: session.user.id,
          title: cur.title ?? null,
          content: cur.content,
          reason: "before_revert",
          word_count: cur.content.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length,
          metadata: { ai_score_before: cur.ai_score },
        } as any);
      }
      await supabase.from("articles").update({ content: v.content, updated_at: new Date().toISOString() }).eq("id", articleId);
      toast.success("Откат выполнен. Запустите перепроверку качества.");
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Ошибка отката");
    }
  }

  async function remove(id: string) {
    if (!confirm("Удалить эту версию?")) return;
    const { error } = await supabase.from("article_versions" as any).delete().eq("id", id);
    if (error) { toast.error("Не удалось удалить"); return; }
    setVersions((v) => v.filter((x) => x.id !== id));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" /> История версий статьи</DialogTitle>
          <DialogDescription>
            Снимки сохраняются перед авто-доработкой и ручным откатом. Текущий AI-score: {currentAi ?? "-"}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : versions.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">История пуста</div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 pr-2">
              {versions.map((v) => {
                const aiBefore = v.metadata?.ai_score_before;
                const diff = aiBefore != null && currentAi != null ? currentAi - Number(aiBefore) : null;
                return (
                  <div key={v.id} className="rounded-md border border-border/50 bg-card/40 p-3 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{REASON_LABEL[v.reason] || v.reason}</span>
                        <span className="text-muted-foreground">{v.created_at ? format(new Date(v.created_at), "dd.MM.yyyy HH:mm") : ""}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => revert(v)} className="h-7 text-[11px]">
                          <RotateCcw className="h-3 w-3 mr-1" /> Откатить
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(v.id)} className="h-7 w-7">
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <span>{v.word_count ?? "-"} слов</span>
                      {aiBefore != null && (
                        <span>AI до: <span className="font-mono">{aiBefore}</span></span>
                      )}
                      {diff != null && (
                        <span className={diff >= 0 ? "text-emerald-400" : "text-rose-400"}>
                          {diff >= 0 ? "+" : ""}{diff} к текущему
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
