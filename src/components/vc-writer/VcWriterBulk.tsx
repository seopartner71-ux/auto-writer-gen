import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, Plus, Trash2, Wand2, Copy, Download, Check, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Format = "guide" | "rating" | "review" | "case";

const FORMATS: Array<{ value: Format; label: string }> = [
  { value: "guide", label: "Гайд" },
  { value: "rating", label: "Рейтинг" },
  { value: "review", label: "Обзор" },
  { value: "case", label: "Кейс" },
];

interface Props {
  model: string;
  modelLabel: string;
}

interface BatchItem {
  id: string;
  position: number;
  format: Format;
  topic: string;
  status: "queued" | "processing" | "done" | "failed";
  result: any | null;
  error: string | null;
}

interface BatchRow {
  id: string;
  status: string;
  model: string;
  generate_cover: boolean;
  total: number;
  completed: number;
  failed: number;
  created_at: string;
}

interface FormRow {
  id: string; // local id
  format: Format;
  topic: string;
  thesis: string;
  target_query?: string;
  intent?: string;
}

const newRow = (format: Format = "guide"): FormRow => ({
  id: Math.random().toString(36).slice(2),
  format,
  topic: "",
  thesis: "",
  target_query: "",
  intent: "",
});

export default function VcWriterBulk({ model, modelLabel }: Props) {
  const [rows, setRows] = useState<FormRow[]>([newRow(), newRow(), newRow()]);
  const [defaultAudience, setDefaultAudience] = useState("");
  const [defaultTone, setDefaultTone] = useState("экспертно-разговорный с легкой провокацией");
  const [defaultLength, setDefaultLength] = useState(5500);
  const [submitting, setSubmitting] = useState(false);

  // Topic generator
  const [niche, setNiche] = useState("");
  const [seedKeywords, setSeedKeywords] = useState("");
  const [seoMode, setSeoMode] = useState(true);
  const [topicsCount, setTopicsCount] = useState(8);
  const [preferredFormat, setPreferredFormat] = useState<Format | "mixed">("mixed");
  const [generatingTopics, setGeneratingTopics] = useState(false);

  // Active batch + items
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchRow | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [openItem, setOpenItem] = useState<BatchItem | null>(null);
  const pollRef = useRef<number | null>(null);

  const addRow = () => setRows((r) => [...r, newRow()]);
  const removeRow = (id: string) => setRows((r) => r.filter((x) => x.id !== id));
  const updateRow = (id: string, patch: Partial<FormRow>) =>
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const validRows = useMemo(() => rows.filter((r) => r.topic.trim().length >= 5), [rows]);

  const handleGenerateTopics = async () => {
    if (niche.trim().length < 3) {
      toast.error("Укажите нишу (минимум 3 символа)");
      return;
    }
    setGeneratingTopics(true);
    try {
      const { data, error } = await supabase.functions.invoke("vc-writer-topics", {
        body: {
          niche,
          keywords: seedKeywords,
          seo_mode: seoMode,
          count: topicsCount,
          preferred_format: preferredFormat === "mixed" ? null : preferredFormat,
          model,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Не удалось получить темы");
      const topics = data.topics as Array<{ topic: string; format: Format; thesis: string; target_query?: string; intent?: string }>;
      if (!topics?.length) throw new Error("Модель не вернула темы");
      setRows(topics.map((t) => ({
        id: Math.random().toString(36).slice(2),
        format: (t.format as Format) || "guide",
        topic: t.topic,
        thesis: t.thesis || "",
        target_query: t.target_query || "",
        intent: t.intent || "",
      })));
      const suffix = data.serper_used ? ` (на базе ${data.real_queries_count} реальных запросов Google)` : "";
      toast.success(`Сгенерировано тем: ${topics.length}${suffix}`);
    } catch (e: any) {
      toast.error(e?.message || "Ошибка генерации тем");
    } finally {
      setGeneratingTopics(false);
    }
  };

  const handleSubmit = async () => {
    if (validRows.length < 1) {
      toast.error("Добавьте хотя бы одну тему (минимум 5 символов)");
      return;
    }
    if (validRows.length > 15) {
      toast.error("Максимум 15 статей в пачке");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("vc-writer-batch", {
        body: {
          model,
          generate_cover: generateCover,
          audience: defaultAudience,
          tone: defaultTone,
          length: defaultLength,
          items: validRows.map((r) => ({
            format: r.format,
            topic: r.topic,
            thesis: r.target_query
              ? `SEO target_query (естественно вписать в заголовок и H2, использовать 4-8 раз в тексте в разных формах): "${r.target_query}". ${r.thesis}`.trim()
              : r.thesis,
          })),
        },
      });
      if (error) throw error;
      if (!data?.batch_id) throw new Error("Не удалось создать пачку");
      toast.success(`Пачка запущена: ${data.total} статей`);
      setActiveBatchId(data.batch_id);
    } catch (e: any) {
      toast.error(e?.message || "Ошибка");
    } finally {
      setSubmitting(false);
    }
  };

  // Poll active batch
  useEffect(() => {
    if (!activeBatchId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const [{ data: b }, { data: it }] = await Promise.all([
          supabase.from("vc_writer_batches").select("*").eq("id", activeBatchId).maybeSingle(),
          supabase.from("vc_writer_batch_items").select("id, position, format, topic, status, result, error")
            .eq("batch_id", activeBatchId).order("position", { ascending: true }),
        ]);
        if (stopped) return;
        if (b) setBatch(b as any);
        if (it) setItems(it as any);
        if (b && (b.status === "done" || b.status === "failed")) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (e) {
        // ignore transient
      }
    };
    tick();
    pollRef.current = window.setInterval(tick, 4000);
    return () => {
      stopped = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [activeBatchId]);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} скопировано`));
  };

  const downloadCover = (dataUrl: string, idx: number) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `vc-cover-${idx + 1}-${Date.now()}.png`;
    a.click();
  };

  const statusBadge = (s: BatchItem["status"]) => {
    const map: Record<string, { label: string; cls: string }> = {
      queued: { label: "в очереди", cls: "bg-muted text-muted-foreground" },
      processing: { label: "пишу...", cls: "bg-amber-500/15 text-amber-300" },
      done: { label: "готово", cls: "bg-emerald-500/15 text-emerald-300" },
      failed: { label: "ошибка", cls: "bg-rose-500/15 text-rose-300" },
    };
    const m = map[s] || map.queued;
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
  };

  const progressPct = batch ? Math.round(((batch.completed + batch.failed) / Math.max(1, batch.total)) * 100) : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            SEO-генератор тем (по реальным поисковым запросам)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Ниша / о чем</Label>
              <Input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="напр. SEO для интернет-магазинов" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ключевые слова-семена (через запятую, опционально)</Label>
              <Input
                value={seedKeywords}
                onChange={(e) => setSeedKeywords(e.target.value)}
                placeholder="seo продвижение интернет магазина, накрутка поведенческих..."
              />
            </div>
          </div>
          <div className="grid sm:grid-cols-[1fr_140px_180px_auto] gap-3 items-end">
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div className="space-y-0.5">
                <Label className="text-xs">SEO-режим (по запросам Google)</Label>
                <p className="text-[10px] text-muted-foreground">Подтягиваем реальные PAA / related из выдачи. Идеально под ссылки клиентам.</p>
              </div>
              <Switch checked={seoMode} onCheckedChange={setSeoMode} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Кол-во тем</Label>
              <Select value={String(topicsCount)} onValueChange={(v) => setTopicsCount(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[5, 7, 8, 10, 12, 15].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Формат тем</Label>
              <Select value={preferredFormat} onValueChange={(v) => setPreferredFormat(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mixed">Микс (рекомендуем)</SelectItem>
                  {FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleGenerateTopics} disabled={generatingTopics} variant="secondary">
              {generatingTopics ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Подобрать темы
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Темы для пачки ({validRows.length}/15)</span>
            <Button size="sm" variant="ghost" onClick={addRow} disabled={rows.length >= 15}>
              <Plus className="h-3 w-3 mr-1" /> Добавить
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.id} className="space-y-1.5 border border-border rounded-md p-2">
              <div className="grid grid-cols-[28px_140px_1fr_28px] gap-2 items-start">
                <div className="text-xs text-muted-foreground pt-2.5">{i + 1}.</div>
                <Select value={r.format} onValueChange={(v) => updateRow(r.id, { format: v as Format })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  value={r.topic}
                  onChange={(e) => updateRow(r.id, { topic: e.target.value })}
                  placeholder="Тема статьи (заголовок-крючок)"
                  className="h-9"
                />
                <Button size="icon" variant="ghost" onClick={() => removeRow(r.id)} disabled={rows.length <= 1} className="h-9 w-9">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-[28px_1fr] gap-2 items-center pl-0">
                <div />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">SEO-запрос</span>
                  <Input
                    value={r.target_query || ""}
                    onChange={(e) => updateRow(r.id, { target_query: e.target.value })}
                    placeholder="напр. как продвинуть интернет-магазин в google"
                    className="h-7 text-xs"
                  />
                  {r.intent && <Badge variant="outline" className="text-[9px] uppercase">{r.intent}</Badge>}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Общие настройки пачки</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Аудитория (общая)</Label>
            <Input value={defaultAudience} onChange={(e) => setDefaultAudience(e.target.value)} placeholder="предприниматели, маркетологи..." />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Тон (общий)</Label>
            <Input value={defaultTone} onChange={(e) => setDefaultTone(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Длина: {defaultLength} знаков</Label>
            <Slider value={[defaultLength]} onValueChange={(v) => setDefaultLength(v[0])} min={3000} max={8000} step={500} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3 sm:col-span-2">
            <div className="space-y-0.5">
              <Label className="text-sm">Генерировать обложку для каждой статьи</Label>
              <p className="text-xs text-muted-foreground">+15-20 сек на каждую статью</p>
            </div>
            <Switch checked={generateCover} onCheckedChange={setGenerateCover} />
          </div>
          <div className="sm:col-span-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Модель: <span className="text-foreground font-medium">{modelLabel}</span></span>
            <span>Время: ~{Math.ceil(validRows.length * (generateCover ? 1.0 : 0.7))} мин</span>
          </div>
          <Button onClick={handleSubmit} disabled={submitting || validRows.length < 1} size="lg" className="sm:col-span-2">
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Запустить пачку ({validRows.length})
          </Button>
        </CardContent>
      </Card>

      {batch && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Прогресс пачки</span>
              <div className="flex items-center gap-2 text-xs font-normal">
                <Badge variant="secondary">{batch.completed}/{batch.total} готово</Badge>
                {batch.failed > 0 && <Badge variant="destructive">{batch.failed} ошибок</Badge>}
                {batch.status === "done" && <Badge className="bg-emerald-500/20 text-emerald-300">завершено</Badge>}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="space-y-1.5">
              {items.map((it, idx) => (
                <div key={it.id} className="flex items-center gap-3 p-2 rounded-md border border-border hover:bg-muted/30 transition">
                  <span className="text-xs text-muted-foreground w-6">{idx + 1}.</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-14">{it.format}</span>
                  <div className="flex-1 min-w-0 truncate text-sm">
                    {it.status === "done" && it.result?.meta?.title ? it.result.meta.title : it.topic}
                  </div>
                  {statusBadge(it.status)}
                  {it.status === "done" && (
                    <Button size="sm" variant="ghost" onClick={() => setOpenItem(it)}>
                      <FileText className="h-3 w-3 mr-1" /> Открыть
                    </Button>
                  )}
                  {it.status === "failed" && (
                    <span className="text-[10px] text-rose-400 max-w-[200px] truncate" title={it.error || ""}>{it.error}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!openItem} onOpenChange={(o) => !o && setOpenItem(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {openItem?.result && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg">{openItem.result.meta?.title}</DialogTitle>
                <p className="text-sm text-muted-foreground">{openItem.result.meta?.subtitle}</p>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {(openItem.result.meta?.tags || []).map((t: string) => <Badge key={t} variant="secondary">{t}</Badge>)}
                </div>

                {openItem.result.cover_data_url && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Обложка</span>
                      <Button size="sm" variant="ghost" onClick={() => downloadCover(openItem.result.cover_data_url, openItem.position)}>
                        <Download className="h-3 w-3 mr-1" /> PNG
                      </Button>
                    </div>
                    <img src={openItem.result.cover_data_url} alt="" className="w-full rounded-md border border-border" />
                  </div>
                )}

                <div className="grid sm:grid-cols-2 gap-2">
                  {(openItem.result.checklist || []).map((c: any, i: number) => (
                    <div key={i} className={`flex items-start gap-2 p-2 rounded-md text-xs ${c.ok ? "bg-emerald-500/10" : "bg-rose-500/10"}`}>
                      {c.ok ? <Check className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" /> : <X className="h-3.5 w-3.5 text-rose-400 mt-0.5 shrink-0" />}
                      <div className="min-w-0">
                        <div className="font-medium">{c.label}</div>
                        <div className="text-muted-foreground">{c.hint}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Markdown ({openItem.result.stats?.chars ?? 0} знаков)</span>
                    <Button size="sm" variant="secondary" onClick={() => copy(openItem.result.markdown, "Текст")}>
                      <Copy className="h-3 w-3 mr-1" /> Скопировать в vc.ru
                    </Button>
                  </div>
                  <Textarea readOnly value={openItem.result.markdown} className="font-mono text-xs min-h-[400px]" />
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}