import { useMemo, useState } from "react";
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
import { Check, Loader2, Sparkles, RefreshCw, Save, ChevronRight, ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PAGE_TYPES, TONES, BLOCKS, type PageType, type BlockDef } from "@/features/commercial/constants";

type Step = 1 | 2 | 3 | 4;

interface BlockState extends BlockDef {
  enabled: boolean;
  content?: string;
  status: "pending" | "generating" | "done" | "error";
  wordCount?: number;
}

const STEP_LABELS = ["Тип", "Бриф", "Структура", "Генерация"];

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
      if (error) throw error;
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
        },
      });
      if (error) throw error;
      const res = data as { content: string; word_count: number };
      setBlocks((arr) => arr.map((x, i) => (i === idx ? { ...x, status: "done", content: res.content, wordCount: res.word_count } : x)));
    } catch (e: any) {
      toast.error(`Блок "${b.title}": ${e?.message || "ошибка"}`);
      setBlocks((arr) => arr.map((x, i) => (i === idx ? { ...x, status: "error" } : x)));
    }
  };

  const startGeneration = async () => {
    setStep(4);
    const indices = blocks.map((b, i) => (b.enabled ? i : -1)).filter((i) => i >= 0);
    for (const i of indices) {
      setGenIdx(i);
      await generateBlock(i);
    }
    setGenIdx(-1);
    toast.success("Генерация завершена");
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
          </CardContent>
        </Card>
      )}

      {/* Step 3 */}
      {step === 3 && (
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
                        <Button size="sm" variant="ghost" onClick={() => generateBlock(idx)}>
                          <RefreshCw className="h-3 w-3 mr-1" /> Перегенерировать
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
            <Button className="w-full" disabled={genIdx >= 0 || !fullHtml || !!savedArticleId} onClick={saveAsArticle}>
              <Save className="h-4 w-4 mr-2" /> Сохранить как статью
            </Button>
            {savedArticleId && (
              <Button variant="outline" className="w-full" onClick={() => navigate(`/articles/${savedArticleId}`)}>
                Открыть в редакторе
              </Button>
            )}
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
    </div>
  );
}
