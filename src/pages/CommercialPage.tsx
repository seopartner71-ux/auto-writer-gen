import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Check, Loader2, Sparkles, RefreshCw, Save, ChevronRight, ChevronLeft, Brain, Plus, Eye, ImageIcon, BookmarkPlus, FolderOpen, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PAGE_TYPES, TONES, BLOCKS, type PageType, type BlockDef } from "@/features/commercial/constants";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Step = 1 | 2 | 3 | 4;

interface BlockState extends BlockDef {
  enabled: boolean;
  content?: string;
  status: "pending" | "generating" | "done" | "error";
  wordCount?: number;
  customInstruction?: string;
  customTitle?: string;
  source?: "default" | "ai";
  regenCount?: number;
}
interface StructureAnalysis {
  intent: string;
  entities: string[];
  expectations: string[];
  internal_links: string[];
  seo_notes: string;
  recommended_blocks: Array<{
    type: string;
    title: string;
    h_level: number;
    desc: string;
    words: number;
    elements: string[];
  }>;
}

const STEP_LABELS = ["Тип", "Бриф", "Структура", "Генерация"];

const getFunctionErrorMessage = async (error: unknown, fallback = "Ошибка генерации") => {
  const context = (error as { context?: Response })?.context;
  if (context) {
    try {
      const payload = await context.clone().json();
      if (typeof payload?.error === "string") return payload.error;
      if (typeof payload?.message === "string") return payload.message;
    } catch {
      try {
        const text = await context.clone().text();
        if (text) return text;
      } catch {
        // ignore and use the generic message below
      }
    }
  }
  return error instanceof Error ? error.message : fallback;
};

export default function CommercialPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const plan = (profile?.plan || "basic") as string;
  const isPro = plan === "pro" || plan === "factory";

  const [step, setStep] = useState<Step>(1);
  const [pageType, setPageType] = useState<PageType | null>(null);
  const [brief, setBrief] = useState<Record<string, any>>({ tone: "" });
  const [blocks, setBlocks] = useState<BlockState[]>([]);
  const [genIdx, setGenIdx] = useState<number>(-1);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiResults, setAiResults] = useState<{ kind: "utp" | "benefits"; items: string[] } | null>(null);
  const [savedArticleId, setSavedArticleId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<StructureAnalysis | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; page_type: string; brief: any }>>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [regenConfirmIdx, setRegenConfirmIdx] = useState<number | null>(null);

  const selectedType = PAGE_TYPES.find((t) => t.id === pageType);
  const tones = pageType ? TONES[pageType] : [];

  const initBlocks = (t: PageType) => {
    const list = BLOCKS[t].map<BlockState>((b) => ({
      ...b,
      enabled: (b.conditional ? b.conditional(brief) : true) && (!b.proOnly || isPro),
      status: "pending",
    }));
    setBlocks(list);
  };

  const goNext = () => {
    if (step === 1 && !pageType) return toast.error("Выбери тип страницы");
    if (step === 2) {
      if (!brief.niche || !brief.keyword) return toast.error("Заполни нишу и ключевой запрос");
      initBlocks(pageType!);
    }
    setStep((s) => Math.min(4, s + 1) as Step);
  };

  const selectType = (t: PageType) => {
    const def = PAGE_TYPES.find((p) => p.id === t)!;
    if (def.proOnly && !isPro) {
      toast.error("Этот тип страницы доступен на тарифе PRO");
      return;
    }
    setPageType(t);
    setBrief((b) => ({ ...b, tone: TONES[t][0] }));
  };

  const callAiHelper = async (kind: "utp" | "benefits") => {
    if (!brief.niche) return toast.error("Сначала укажи нишу");
    setAiBusy(kind);
    try {
      const { data, error } = await supabase.functions.invoke("commercial-brief-helper", {
        body: { kind, niche: brief.niche, page_type: pageType, city: brief.city },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error));
      setAiResults({ kind, items: (data as any).items || [] });
    } catch (e: any) {
      toast.error(e?.message || "Ошибка генерации");
    } finally {
      setAiBusy(null);
    }
  };

  const enabledBlocks = blocks.filter((b) => b.enabled);
  const totalWords = enabledBlocks.reduce((s, b) => s + b.words, 0);
  const cost = enabledBlocks.length;

  const runStructureAnalysis = async () => {
    if (!pageType || !brief.keyword) return toast.error("Заполни ключевой запрос");
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("commercial-structure-analyzer", {
        body: {
          page_type: pageType,
          niche: brief.niche,
          keyword: brief.keyword,
          city: brief.city,
          audience: brief.audience,
          utp: brief.utp,
          benefits: brief.benefits,
        },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error));
      setAnalysis(data as StructureAnalysis);
      toast.success("Анализ готов. Можно добавить блоки.");
    } catch (e: any) {
      toast.error(e?.message || "Ошибка анализа");
    } finally {
      setAnalyzing(false);
    }
  };

  const addAiBlock = (rb: StructureAnalysis["recommended_blocks"][number]) => {
    if (blocks.some((b) => b.type === rb.type)) {
      toast.info("Этот блок уже есть в структуре");
      return;
    }
    setBlocks((arr) => [
      ...arr,
      {
        type: rb.type,
        title: rb.title,
        desc: rb.desc,
        words: rb.words,
        enabled: true,
        status: "pending",
        customInstruction: `${rb.desc}${rb.elements?.length ? `\nРекомендуемые элементы: ${rb.elements.join(", ")}.` : ""}`,
        customTitle: rb.title,
        source: "ai",
      },
    ]);
  };

  const replaceWithAiBlocks = () => {
    if (!analysis?.recommended_blocks?.length) return;
    setBlocks(
      analysis.recommended_blocks.map<BlockState>((rb) => ({
        type: rb.type,
        title: rb.title,
        desc: rb.desc,
        words: rb.words,
        enabled: true,
        status: "pending",
        customInstruction: `${rb.desc}${rb.elements?.length ? `\nРекомендуемые элементы: ${rb.elements.join(", ")}.` : ""}`,
        customTitle: rb.title,
        source: "ai",
      })),
    );
    toast.success("Структура заменена на AI-рекомендации");
  };

  const generateBlock = async (idx: number) => {
    const b = blocks[idx];
    setBlocks((arr) => arr.map((x, i) => (i === idx ? { ...x, status: "generating" } : x)));
    try {
      const { data, error } = await supabase.functions.invoke("generate-commercial-block", {
        body: {
          block_type: b.type,
          page_type: pageType,
          brief,
          target_words: b.words,
          custom_instruction: b.customInstruction,
          custom_title: b.customTitle,
        },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error));
      const res = data as { content: string; word_count: number };
      setBlocks((arr) =>
        arr.map((x, i) =>
          i === idx
            ? { ...x, status: "done", content: res.content, wordCount: res.word_count, regenCount: (x.regenCount || 0) + (x.content ? 1 : 0) }
            : x,
        ),
      );
      return true;
    } catch (e: any) {
      toast.error(`Блок "${b.title}": ${e?.message || "ошибка"}`);
      setBlocks((arr) => arr.map((x, i) => (i === idx ? { ...x, status: "error" } : x)));
      return false;
    }
  };

  // Click "Перегенерировать". 1-я бесплатная (regenCount=0 после генерации), дальше — подтверждение списания.
  const handleRegenClick = (idx: number) => {
    const b = blocks[idx];
    if ((b.regenCount || 0) >= 1) {
      setRegenConfirmIdx(idx);
    } else {
      generateBlock(idx);
    }
  };

  // Brief templates -------------------------------------------------------
  const loadTemplates = async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from("commercial_brief_templates")
      .select("id, name, page_type, brief")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false });
    setTemplates((data as any) || []);
  };

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSelectedTemplateId(id);
    if (t.page_type !== pageType) {
      setPageType(t.page_type as PageType);
    }
    setBrief({ ...t.brief, tone: t.brief?.tone || TONES[t.page_type as PageType][0] });
    toast.success(`Загружен шаблон "${t.name}"`);
  };

  const saveTemplate = async () => {
    if (!profile?.id || !pageType) return;
    const name = window.prompt("Название шаблона:", brief.keyword || "Без названия");
    if (!name || !name.trim()) return;
    setSavingTemplate(true);
    const { error } = await supabase.from("commercial_brief_templates").insert({
      user_id: profile.id,
      name: name.trim(),
      page_type: pageType,
      brief,
    });
    setSavingTemplate(false);
    if (error) return toast.error(error.message);
    toast.success("Шаблон сохранен");
    await loadTemplates();
  };

  const deleteTemplate = async () => {
    if (!selectedTemplateId) return;
    if (!window.confirm("Удалить шаблон?")) return;
    await supabase.from("commercial_brief_templates").delete().eq("id", selectedTemplateId);
    setSelectedTemplateId("");
    toast.success("Шаблон удален");
    await loadTemplates();
  };

  // Load templates when user reaches Step 2.
  useEffect(() => {
    if (step === 2 && profile?.id && templates.length === 0) loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, profile?.id]);

  const startGeneration = async () => {
    setStep(4);
    const indices = blocks.map((b, i) => (b.enabled ? i : -1)).filter((i) => i >= 0);
    let failed = 0;
    for (const i of indices) {
      setGenIdx(i);
      const ok = await generateBlock(i);
      if (!ok) failed += 1;
    }
    setGenIdx(-1);
    if (failed) {
      toast.error(`Генерация завершена с ошибками: ${failed}`);
    } else {
      toast.success("Генерация завершена");
    }
  };

  const fullHtml = useMemo(
    () => blocks.filter((b) => b.enabled && b.content).map((b) => b.content).join("\n\n"),
    [blocks]
  );

  const saveAsArticle = async () => {
    if (!profile?.id || !fullHtml) return;
    const titleMatch = fullHtml.match(/<h1[^>]*>(.*?)<\/h1>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "") : `${selectedType?.title}: ${brief.keyword}`;
    const { data, error } = await supabase
      .from("articles")
      .insert({
        user_id: profile.id,
        title,
        content: fullHtml,
        status: "draft",
        page_type: pageType,
        commercial_brief: brief,
        keywords: brief.keyword ? [brief.keyword] : [],
      })
      .select("id")
      .single();
    if (error) return toast.error(error.message);
    setSavedArticleId(data.id);
    toast.success("Сохранено в Статьи");
  };

  return (
    <div className="container max-w-6xl py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Коммерческие страницы</h1>
          {selectedType && <Badge variant="secondary" className="mt-2">{selectedType.title}</Badge>}
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as Step;
          const active = step === n;
          const done = step > n;
          return (
            <div key={label} className="flex items-center gap-2">
              <button
                onClick={() => done && setStep(n)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition ${
                  active ? "bg-primary/15 text-primary font-medium"
                    : done ? "text-foreground hover:bg-accent cursor-pointer"
                    : "text-muted-foreground"
                }`}
              >
                <span className={`h-5 w-5 rounded-full flex items-center justify-center text-xs ${
                  done ? "bg-primary text-primary-foreground" : active ? "border border-primary" : "border border-muted-foreground/40"
                }`}>
                  {done ? <Check className="h-3 w-3" /> : n}
                </span>
                {label}
              </button>
              {i < 3 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          );
        })}
      </div>

      {/* Step 1 */}
      {step === 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PAGE_TYPES.map((t) => {
            const locked = t.proOnly && !isPro;
            const selected = pageType === t.id;
            const Icon = t.icon;
            return (
              <Card
                key={t.id}
                onClick={() => selectType(t.id)}
                className={`cursor-pointer transition hover:border-primary/50 ${selected ? "border-primary ring-1 ring-primary/30" : ""} ${locked ? "opacity-60" : ""}`}
              >
                <CardContent className="p-5 flex gap-4">
                  <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{t.title}</h3>
                      {locked && <Badge variant="outline" className="text-xs">PRO</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{t.desc}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Step 2 */}
      {step === 2 && pageType && (
        <Card>
          <CardContent className="p-6 space-y-4">
            {/* Templates bar */}
            <div className="flex items-end gap-2 flex-wrap pb-3 border-b">
              <div className="flex-1 min-w-[200px] space-y-1.5">
                <Label className="text-xs text-muted-foreground">Шаблоны брифов</Label>
                <Select value={selectedTemplateId} onValueChange={applyTemplate}>
                  <SelectTrigger>
                    <SelectValue placeholder={templates.length ? "Загрузить шаблон…" : "Шаблонов пока нет"} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} · {PAGE_TYPES.find((p) => p.id === t.page_type)?.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" size="sm" onClick={saveTemplate} disabled={savingTemplate || !brief.keyword}>
                <BookmarkPlus className="h-3.5 w-3.5 mr-1" /> Сохранить как шаблон
              </Button>
              {selectedTemplateId && (
                <Button variant="ghost" size="sm" onClick={deleteTemplate}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Удалить
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Ниша / тематика *</Label>
                <Input value={brief.niche || ""} onChange={(e) => setBrief({ ...brief, niche: e.target.value })} placeholder="ремонт квартир" />
              </div>
              <div className="space-y-1.5">
                <Label>Главный ключевой запрос *</Label>
                <Input value={brief.keyword || ""} onChange={(e) => setBrief({ ...brief, keyword: e.target.value })} />
              </div>
              {(pageType === "service" || pageType === "local") && (
                <div className="space-y-1.5">
                  <Label>Название компании</Label>
                  <Input value={brief.company || ""} onChange={(e) => setBrief({ ...brief, company: e.target.value })} />
                </div>
              )}
              {pageType === "category" && (
                <div className="space-y-1.5">
                  <Label>Название магазина / бренда</Label>
                  <Input value={brief.shop_name || ""} onChange={(e) => setBrief({ ...brief, shop_name: e.target.value })} />
                </div>
              )}
              {pageType === "product" && (
                <>
                  <div className="space-y-1.5">
                    <Label>Название товара</Label>
                    <Input value={brief.product_name || ""} onChange={(e) => setBrief({ ...brief, product_name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Артикул / модель</Label>
                    <Input value={brief.sku || ""} onChange={(e) => setBrief({ ...brief, sku: e.target.value })} />
                  </div>
                </>
              )}
              {(pageType === "service" || pageType === "local") && (
                <div className="space-y-1.5">
                  <Label>Город</Label>
                  <Input value={brief.city || ""} onChange={(e) => setBrief({ ...brief, city: e.target.value })} />
                </div>
              )}
              {pageType === "local" && (
                <div className="space-y-1.5">
                  <Label>Район (опц.)</Label>
                  <Input value={brief.district || ""} onChange={(e) => setBrief({ ...brief, district: e.target.value })} />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Тон</Label>
              <div className="flex flex-wrap gap-2">
                {tones.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setBrief({ ...brief, tone: t })}
                    className={`px-3 py-1.5 rounded-md text-sm border transition ${
                      brief.tone === t ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {pageType === "service" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between rounded-md border p-3">
                  <Label>Цены на сайте</Label>
                  <Switch checked={!!brief.has_prices} onCheckedChange={(v) => setBrief({ ...brief, has_prices: v })} />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <Label>Гарантии</Label>
                  <Switch checked={!!brief.has_guarantees} onCheckedChange={(v) => setBrief({ ...brief, has_guarantees: v })} />
                </div>
              </div>
            )}

            {pageType === "category" && (
              <>
                <div className="space-y-1.5">
                  <Label>LSI-ключи (опц.)</Label>
                  <Textarea rows={2} value={brief.lsi || ""} onChange={(e) => setBrief({ ...brief, lsi: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Количество товаров (опц.)</Label>
                  <Input type="number" value={brief.items_count || ""} onChange={(e) => setBrief({ ...brief, items_count: e.target.value ? Number(e.target.value) : undefined })} />
                </div>
              </>
            )}

            {pageType === "product" && (
              <>
                <div className="space-y-1.5">
                  <Label>Характеристики (список)</Label>
                  <Textarea rows={4} value={brief.features || ""} onChange={(e) => setBrief({ ...brief, features: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Целевая аудитория</Label>
                  <Input value={brief.audience || ""} onChange={(e) => setBrief({ ...brief, audience: e.target.value })} />
                </div>
              </>
            )}

            {pageType === "local" && (
              <>
                <div className="space-y-1.5">
                  <Label>Список услуг</Label>
                  <Textarea rows={3} value={brief.services || ""} onChange={(e) => setBrief({ ...brief, services: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Режим работы (опц.)</Label>
                  <Input value={brief.hours || ""} onChange={(e) => setBrief({ ...brief, hours: e.target.value })} />
                </div>
              </>
            )}

            {pageType !== "product" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>УТП</Label>
                  <Button size="sm" variant="outline" onClick={() => callAiHelper("utp")} disabled={aiBusy === "utp"}>
                    {aiBusy === "utp" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                    Сгенерировать через AI
                  </Button>
                </div>
                <Textarea rows={2} value={brief.utp || ""} onChange={(e) => setBrief({ ...brief, utp: e.target.value })} />
                {aiResults?.kind === "utp" && (
                  <div className="grid gap-2 mt-2">
                    {aiResults.items.map((it, i) => (
                      <button key={i} onClick={() => { setBrief({ ...brief, utp: it }); setAiResults(null); }}
                        className="text-left text-sm px-3 py-2 rounded-md border hover:border-primary hover:bg-accent transition">
                        {it}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {pageType !== "product" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Преимущества</Label>
                  <Button size="sm" variant="outline" onClick={() => callAiHelper("benefits")} disabled={aiBusy === "benefits"}>
                    {aiBusy === "benefits" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                    Сгенерировать через AI
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(brief.benefits || []).map((b: string, i: number) => (
                    <Badge key={i} variant="secondary" className="cursor-pointer"
                      onClick={() => setBrief({ ...brief, benefits: brief.benefits.filter((_: any, j: number) => j !== i) })}>
                      {b} ×
                    </Badge>
                  ))}
                </div>
                {aiResults?.kind === "benefits" && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {aiResults.items.map((it, i) => {
                      const picked = (brief.benefits || []).includes(it);
                      return (
                        <button key={i}
                          onClick={() => {
                            const cur = brief.benefits || [];
                            setBrief({ ...brief, benefits: picked ? cur.filter((x: string) => x !== it) : [...cur, it] });
                          }}
                          className={`text-xs px-2.5 py-1 rounded-full border transition ${
                            picked ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
                          }`}>
                          {it}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5 pt-2 border-t">
              <Label>Стоп-слова / запреты <span className="text-xs text-muted-foreground font-normal">(опц.)</span></Label>
              <Textarea
                rows={2}
                placeholder="конкурент X, не упоминать доставку в регионы, без слова дешево"
                value={brief.stop_words || ""}
                onChange={(e) => setBrief({ ...brief, stop_words: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Через запятую: бренды, темы, формулировки, которые модель не должна использовать.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-primary" />
                  <span className="font-medium text-sm">SEO-стратег: анализ структуры под запрос</span>
                </div>
                <Button size="sm" variant="outline" onClick={runStructureAnalysis} disabled={analyzing}>
                  {analyzing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                  {analysis ? "Перезапустить анализ" : "Запустить анализ"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Реверс-инжиниринг интента: ИИ моделирует, как поиск интерпретирует запрос, и предлагает блоки.
              </p>

              {analysis && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-3 text-sm">
                  {analysis.intent && (
                    <div><span className="text-muted-foreground">Интент:</span> {analysis.intent}</div>
                  )}
                  {analysis.entities?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-muted-foreground text-xs">Сущности:</span>
                      {analysis.entities.map((e, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{e}</Badge>
                      ))}
                    </div>
                  )}
                  {analysis.expectations?.length > 0 && (
                    <div>
                      <div className="text-muted-foreground text-xs mb-1">Ожидания ИИ от контента:</div>
                      <ul className="text-xs space-y-0.5 list-disc list-inside">
                        {analysis.expectations.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  )}
                  {analysis.recommended_blocks?.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-xs">Рекомендуемые блоки:</span>
                        <Button size="sm" variant="ghost" onClick={replaceWithAiBlocks} className="h-7 text-xs">
                          Заменить все
                        </Button>
                      </div>
                      <div className="grid gap-1.5">
                        {analysis.recommended_blocks.map((rb, i) => {
                          const exists = blocks.some((b) => b.type === rb.type);
                          return (
                            <div key={i} className="flex items-center justify-between rounded border bg-background p-2">
                              <div className="min-w-0 pr-2">
                                <div className="text-xs font-medium truncate">H{rb.h_level} · {rb.title}</div>
                                <div className="text-xs text-muted-foreground truncate">{rb.desc} · ~{rb.words} сл.</div>
                              </div>
                              <Button size="sm" variant="outline" disabled={exists} onClick={() => addAiBlock(rb)} className="h-7 text-xs shrink-0">
                                <Plus className="h-3 w-3 mr-1" />
                                {exists ? "Добавлен" : "Добавить"}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {analysis.seo_notes && (
                    <div className="text-xs italic text-muted-foreground">{analysis.seo_notes}</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 space-y-3">
              {blocks.map((b, i) => {
              const locked = b.proOnly && !isPro;
              return (
                <div key={b.type} className={`flex items-center justify-between rounded-md border p-3 ${locked ? "opacity-50" : ""}`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{b.title}</span>
                      {locked && <Badge variant="outline" className="text-xs">PRO</Badge>}
                      {b.source === "ai" && <Badge variant="secondary" className="text-xs">AI</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{b.desc} · ~{b.words} слов</p>
                  </div>
                  <Switch
                    checked={b.enabled}
                    disabled={locked}
                    onCheckedChange={(v) => setBlocks((arr) => arr.map((x, j) => (j === i ? { ...x, enabled: v } : x)))}
                  />
                </div>
              );
              })}
              <div className="flex items-center justify-between pt-3 border-t">
                <div className="text-sm text-muted-foreground">Итого: ~{totalWords} слов</div>
                <div className="text-sm">Стоимость: <span className="font-medium text-primary">{cost} кредитов</span></div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 4 */}
      {step === 4 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            {blocks.filter((b) => b.enabled).map((b) => {
              const idx = blocks.indexOf(b);
              return (
                <Card key={b.type}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{b.title}</span>
                        {b.status === "generating" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                        {b.status === "done" && <Check className="h-3 w-3 text-green-500" />}
                        {b.status === "error" && <Badge variant="destructive" className="text-xs">ошибка</Badge>}
                        {b.wordCount && <span className="text-xs text-muted-foreground">{b.wordCount} сл.</span>}
                      </div>
                      {b.status !== "generating" && genIdx < 0 && (
                        <Button size="sm" variant="ghost" onClick={() => handleRegenClick(idx)}>
                          <RefreshCw className="h-3 w-3 mr-1" />
                          {(b.regenCount || 0) >= 1 ? "Перегенерировать (1 кр.)" : "Перегенерировать"}
                        </Button>
                      )}
                    </div>
                    {b.content ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: b.content }} />
                    ) : b.status === "pending" ? (
                      <p className="text-sm text-muted-foreground">Ожидание...</p>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <div className="space-y-3">
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="text-sm font-medium">Сводка</div>
                <div className="text-xs text-muted-foreground">
                  Готово: {blocks.filter((b) => b.status === "done").length} / {enabledBlocks.length}
                </div>
                <div className="text-xs text-muted-foreground">
                  Всего слов: {blocks.reduce((s, b) => s + (b.wordCount || 0), 0)}
                </div>
              </CardContent>
            </Card>
            <Button variant="outline" className="w-full" disabled={!fullHtml} onClick={() => setShowPreview(true)}>
              <Eye className="h-4 w-4 mr-2" /> Превью всей страницы
            </Button>
            <Button className="w-full" disabled={genIdx >= 0 || !fullHtml || !!savedArticleId} onClick={saveAsArticle}>
              <Save className="h-4 w-4 mr-2" /> Сохранить как статью
            </Button>
            {savedArticleId && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  // Open in a new tab so the heavy AI Writer editor cannot freeze
                  // the commercial flow state, and the user can always come back.
                  window.open(`/articles?edit=${savedArticleId}`, "_blank", "noopener,noreferrer");
                }}
              >
                Открыть в редакторе (новая вкладка)
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full"
              disabled={!brief.keyword}
              onClick={() => {
                const params = new URLSearchParams({
                  mode: "cover",
                  keyword: brief.keyword || "",
                  topic: brief.product_name || brief.niche || brief.keyword || "",
                });
                navigate(`/images?${params.toString()}`);
              }}
            >
              <ImageIcon className="h-4 w-4 mr-2" /> Сгенерировать обложку
            </Button>
          </div>
        </div>
      )}

      {/* Nav buttons */}
      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1) as Step)} disabled={step === 1 || genIdx >= 0}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Назад
        </Button>
        {step < 3 && <Button onClick={goNext}>Далее <ChevronRight className="h-4 w-4 ml-1" /></Button>}
        {step === 3 && (
          <Button onClick={startGeneration} disabled={enabledBlocks.length === 0}>
            <Sparkles className="h-4 w-4 mr-1" /> Сгенерировать ({cost} кр.)
          </Button>
        )}
      </div>

      {/* Preview dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Превью страницы</DialogTitle>
            <DialogDescription>
              Так страница будет выглядеть после сохранения как статьи.
            </DialogDescription>
          </DialogHeader>
          <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: fullHtml }} />
        </DialogContent>
      </Dialog>

      {/* Regen confirm dialog */}
      <Dialog open={regenConfirmIdx !== null} onOpenChange={(o) => !o && setRegenConfirmIdx(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Перегенерация блока</DialogTitle>
            <DialogDescription>
              Первая перегенерация была бесплатной. Каждая следующая списывает 1 кредит. Продолжить?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setRegenConfirmIdx(null)}>Отмена</Button>
            <Button
              onClick={() => {
                const i = regenConfirmIdx;
                setRegenConfirmIdx(null);
                if (i !== null) generateBlock(i);
              }}
            >
              Списать 1 кредит и перегенерировать
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
