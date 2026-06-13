import { useState } from "react";
import { Loader2, Copy, Download, Check, X, Sparkles, FileText, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Format = "guide" | "rating" | "review" | "case";

const MODEL_OPTIONS = [
  { value: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5", hint: "Рекомендуем - живой русский, лучший тон для vc.ru", recommended: true },
  { value: "anthropic/claude-opus-4.1", label: "Claude Opus 4.1", hint: "Премиум - сильнее в нюансах и аргументации, дороже" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Длинный контекст, стабильный markdown" },
  { value: "openai/gpt-5", label: "GPT-5", hint: "Универсал, чуть суше по тону" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Быстро и дешево, просядет на длинных" },
];

interface Result {
  ok: boolean;
  markdown: string;
  meta: { title: string; subtitle: string; tags: string[]; ps_question: string };
  checklist: Array<{ label: string; ok: boolean; hint: string }>;
  cover_data_url: string | null;
  stats?: { chars: number; model: string };
}

const FORMAT_OPTIONS: Array<{ value: Format; label: string; hint: string }> = [
  { value: "guide", label: "Статья-разбор / гайд", hint: "Пошаговый разбор с цифрами" },
  { value: "rating", label: "Рейтинг / ТОП-N", hint: "Подборка с критериями и оценками" },
  { value: "review", label: "Обзор продукта", hint: "Личный опыт с плюсами и минусами" },
  { value: "case", label: "Кейс / антикейс / мнение", hint: "История с конфликтом и цифрами" },
];

export default function VcWriterPage() {
  const [format, setFormat] = useState<Format>("guide");
  const [model, setModel] = useState<string>("anthropic/claude-sonnet-4.5");
  const [topic, setTopic] = useState("");
  const [thesis, setThesis] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("экспертно-разговорный с легкой провокацией");
  const [length, setLength] = useState(5500);
  const [withCover, setWithCover] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const handleGenerate = async () => {
    if (topic.trim().length < 5) {
      toast.error("Укажите тему (минимум 5 символов)");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("vc-writer", {
        body: { format, model, topic, thesis, audience, tone, length, generate_cover: withCover },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Не удалось сгенерировать материал");
      setResult(data as Result);
      toast.success("Материал готов");
    } catch (e: any) {
      toast.error(e?.message || "Ошибка генерации");
    } finally {
      setLoading(false);
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} скопировано`));
  };

  const downloadCover = () => {
    if (!result?.cover_data_url) return;
    const a = document.createElement("a");
    a.href = result.cover_data_url;
    a.download = `vc-cover-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center gap-3">
        <Sparkles className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">vc.ru Writer</h1>
          <p className="text-sm text-muted-foreground">
            Генератор статей под формат vc.ru - с крючком в лиде, цифрами, провалами и P.S. для комментариев
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[420px_1fr] gap-6">
        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Параметры материала</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Формат</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FORMAT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <div className="flex flex-col">
                        <span>{o.label}</span>
                        <span className="text-xs text-muted-foreground">{o.hint}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Модель</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue>
                    {MODEL_OPTIONS.find((o) => o.value === model)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <div className="flex flex-col">
                        <span className="flex items-center gap-2">
                          {o.label}
                          {o.recommended && <Badge variant="secondary" className="h-4 text-[9px] px-1.5">рекомендуем</Badge>}
                        </span>
                        <span className="text-xs text-muted-foreground">{o.hint}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                {MODEL_OPTIONS.find((o) => o.value === model)?.hint}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Тема материала</Label>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Например: как мы вывели интернет-магазин с 0 до 2 млн оборота за полгода"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Главный тезис (необязательно)</Label>
              <Textarea
                value={thesis}
                onChange={(e) => setThesis(e.target.value)}
                placeholder="Что именно хотите доказать или показать. Можно оставить пустым - модель сформулирует сама."
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Аудитория</Label>
              <Input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="предприниматели, маркетологи, продакты..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Тон</Label>
              <Input value={tone} onChange={(e) => setTone(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Длина: {length} знаков</Label>
              </div>
              <Slider
                value={[length]}
                onValueChange={(v) => setLength(v[0])}
                min={3000}
                max={8000}
                step={500}
              />
              <p className="text-[10px] text-muted-foreground">vc.ru-топ обычно 4500-6500 знаков</p>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="space-y-0.5">
                <Label className="text-sm">Сгенерировать обложку</Label>
                <p className="text-xs text-muted-foreground">AI-картинка 1536x1024 для шапки</p>
              </div>
              <Switch checked={withCover} onCheckedChange={setWithCover} />
            </div>

            <Button onClick={handleGenerate} disabled={loading} className="w-full" size="lg">
              {loading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Пишу материал...</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2" /> Сгенерировать</>
              )}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center">
              Занимает 30-90 секунд. Обложка добавляет ~15 сек.
            </p>
          </CardContent>
        </Card>

        {/* Result */}
        <div className="space-y-4">
          {!result && !loading && (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>Заполните параметры слева и нажмите «Сгенерировать»</p>
              </CardContent>
            </Card>
          )}

          {loading && (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Loader2 className="h-10 w-10 mx-auto mb-3 animate-spin opacity-60" />
                <p>Готовим лид с крючком, цифры, провалы и P.S....</p>
              </CardContent>
            </Card>
          )}

          {result && (
            <>
              {/* Meta */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>Мета для полей vc.ru</span>
                    <Button size="sm" variant="ghost" onClick={() => copy(
                      `Заголовок: ${result.meta.title}\nПодзаголовок: ${result.meta.subtitle}\nТеги: ${result.meta.tags.join(", ")}`,
                      "Мета"
                    )}>
                      <Copy className="h-3 w-3 mr-1" /> Копировать всё
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Заголовок ({result.meta.title.length}/90)</div>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 font-medium">{result.meta.title}</div>
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => copy(result.meta.title, "Заголовок")}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Подзаголовок</div>
                    <div className="flex items-start gap-2">
                      <div className="flex-1">{result.meta.subtitle}</div>
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => copy(result.meta.subtitle, "Подзаголовок")}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Теги</div>
                    <div className="flex flex-wrap gap-1.5">
                      {result.meta.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">P.S. вопрос</div>
                    <div className="text-sm italic">{result.meta.ps_question}</div>
                  </div>
                </CardContent>
              </Card>

              {/* Cover */}
              {result.cover_data_url && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Обложка</span>
                      <Button size="sm" variant="ghost" onClick={downloadCover}>
                        <Download className="h-3 w-3 mr-1" /> Скачать PNG
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <img src={result.cover_data_url} alt="Обложка" className="w-full rounded-md border border-border" />
                  </CardContent>
                </Card>
              )}

              {/* Checklist */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Чек-лист соответствия vc.ru</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {result.checklist.map((c, i) => (
                      <div key={i} className={`flex items-start gap-2 p-2 rounded-md text-xs ${c.ok ? "bg-emerald-500/10" : "bg-rose-500/10"}`}>
                        {c.ok ? <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" /> : <X className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />}
                        <div className="min-w-0">
                          <div className="font-medium">{c.label}</div>
                          <div className="text-muted-foreground">{c.hint}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Markdown */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>Текст материала (markdown)</span>
                    <div className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                      <span>{result.stats?.chars ?? 0} знаков</span>
                      <Button size="sm" variant="ghost" onClick={() => copy(result.markdown, "Текст")}>
                        <Copy className="h-3 w-3 mr-1" /> Копировать в vc.ru
                      </Button>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={result.markdown}
                    readOnly
                    className="font-mono text-xs min-h-[500px] resize-y"
                  />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}