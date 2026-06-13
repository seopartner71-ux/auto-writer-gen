import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, HelpCircle, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Protocol = "https://" | "http://";
type Preset = "custom" | "google" | "yandex" | "vk" | "mycom";

const TRANSLIT_MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function translit(s: string): string {
  let out = "";
  for (const ch of s) {
    const low = ch.toLowerCase();
    if (TRANSLIT_MAP[low] !== undefined) {
      const tr = TRANSLIT_MAP[low];
      out += ch === low ? tr : tr.charAt(0).toUpperCase() + tr.slice(1);
    } else {
      out += ch;
    }
  }
  return out;
}

function cleanUrlInput(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, "").replace(/^\/+/, "");
}

function sanitizeValue(v: string, doTranslit: boolean): string {
  let s = (v || "").trim();
  if (doTranslit) s = translit(s);
  // Lowercase, замена пробелов, чистка # & = и дублей
  s = s.toLowerCase().replace(/\s+/g, "_").replace(/[#&=]/g, "").replace(/_{2,}/g, "_");
  return encodeURIComponent(s).replace(/%5F/gi, "_");
}

function buildUrl(opts: {
  protocol: Protocol;
  url: string;
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
  doTranslit: boolean;
}): string {
  const cleanedHost = cleanUrlInput(opts.url);
  if (!cleanedHost) return "";
  // Базовая часть без фрагмента
  const noHash = cleanedHost.split("#")[0];
  const base = `${opts.protocol}${noHash}`;
  const params: Array<[string, string]> = [];
  const push = (k: string, v: string) => {
    const cleaned = sanitizeValue(v, opts.doTranslit);
    if (cleaned) params.push([k, cleaned]);
  };
  push("utm_source", opts.source);
  push("utm_medium", opts.medium);
  push("utm_campaign", opts.campaign);
  push("utm_content", opts.content);
  push("utm_term", opts.term);
  if (!params.length) return base;
  const sep = base.includes("?") ? "&" : "?";
  const qs = params.map(([k, v]) => `${k}=${v}`).join("&");
  return `${base}${sep}${qs}`.replace(/&{2,}/g, "&");
}

const PRESETS: Record<Exclude<Preset, "custom">, { source: string; medium: string }> = {
  google: { source: "google", medium: "cpc" },
  yandex: { source: "yandex", medium: "cpc" },
  vk: { source: "vkontakte", medium: "social" },
  mycom: { source: "mytarget", medium: "cpc" },
};

function Hint({ text }: { text: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Подсказка"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="max-w-sm text-xs leading-relaxed whitespace-pre-line">
        {text}
      </PopoverContent>
    </Popover>
  );
}

const TIP_SOURCE = `utm_source - название рекламной площадки, с которой пришел трафик.

Примеры значений: google, yandex, vkontakte, facebook, mytarget, telegram, email, instagram.

По этому параметру вы понимаете, какой канал привел пользователя на сайт. Заполняется обязательно.`;

const TIP_MEDIUM = `utm_medium - тип трафика или способ его получения.

Устоявшиеся значения:
- cpc - контекстная реклама с оплатой за клик
- display - баннерная реклама с оплатой за показы
- social_cpc / social - реклама в соцсетях
- email - рассылки
- referral - переходы с других сайтов
- organic - органический поиск

Стандартные значения помогают потом фильтровать трафик в Метрике и GA4.`;

const TIP_CAMPAIGN = `utm_campaign - произвольное название рекламной кампании.

Задается на ваше усмотрение, главное - чтобы вы сами потом отличили одну кампанию от другой в статистике.

Примеры: spring_sale, black_friday_2026, retarget_cart, promo_mebel.

Используйте латиницу и нижний регистр, слова разделяйте подчеркиванием.`;

const TIP_CONTENT = `utm_content - дополнительная информация об объявлении.

Часто используется, чтобы внутри одной кампании различать креативы: баннер vs текстовое объявление, разные изображения, разные тексты, разные кнопки.

Примеры: banner_240x60, text_v1, headline_a, btn_red, video_15s.

Удобно использовать вместе с динамическими переменными площадки.`;

const TIP_TERM = `utm_term - ключевое слово (или фраза), по которому показывалось объявление.

Чаще всего сюда подставляют динамическую переменную площадки: {keyword} для Google Ads или {keyword} / {phrase_id} для Яндекс.Директа - площадка сама подставит реальную фразу пользователя.

Можно задать и статически: kupit_divan, dostavka_moskva.`;

function ParamRow({ name, desc }: { name: string; desc: string }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs whitespace-nowrap">{name}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{desc}</TableCell>
    </TableRow>
  );
}

export default function UtmGeneratorPage() {
  const [protocol, setProtocol] = useState<Protocol>("https://");
  const [url, setUrl] = useState("");
  const [preset, setPreset] = useState<Preset>("custom");
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [term, setTerm] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const [doTranslit, setDoTranslit] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = "Генератор UTM-меток - СЕО-Модуль";
  }, []);

  const handleUrlChange = (raw: string) => {
    let v = raw.trim();
    const m = v.match(/^(https?):\/\//i);
    if (m) {
      setProtocol((m[1].toLowerCase() + "://") as Protocol);
      v = v.replace(/^https?:\/\//i, "");
    }
    setUrl(v);
  };

  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p === "custom") {
      setSource(""); setMedium(""); setCampaign(""); setContent(""); setTerm("");
      return;
    }
    const cfg = PRESETS[p];
    setSource(cfg.source);
    setMedium(cfg.medium);
    setCampaign("");
  };

  const result = useMemo(
    () => buildUrl({ protocol, url, source, medium, campaign, content, term, doTranslit }),
    [protocol, url, source, medium, campaign, content, term, doTranslit],
  );

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Генератор UTM-меток</h1>
        <p className="text-sm text-muted-foreground">
          Соберите корректную ссылку с UTM-параметрами для рекламной кампании. Все вычисления на клиенте.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        {/* LEFT: form */}
        <div className="space-y-6">
          {/* URL */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Адрес вашей страницы</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-1 rounded-md border border-border bg-muted/30 p-1 w-fit">
                {(["https://", "http://"] as Protocol[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setProtocol(p)}
                    className={cn(
                      "px-3 py-1 text-xs font-mono rounded-sm transition-colors",
                      protocol === p
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <Input
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="example.com/landing"
                className="font-mono"
              />
            </CardContent>
          </Card>

          {/* Presets */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Источник трафика</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={preset} onValueChange={(v) => applyPreset(v as Preset)}>
                <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
                  <TabsTrigger value="custom">Свои значения</TabsTrigger>
                  <TabsTrigger value="google">Google Ads</TabsTrigger>
                  <TabsTrigger value="yandex">Яндекс.Директ</TabsTrigger>
                  <TabsTrigger value="vk">ВКонтакте</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardContent>
          </Card>

          {/* Required */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Обязательные параметры</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs">
                  utm_source <Hint text="utm_source - название рекламной площадки. Примеры: google, yandex, vk" />
                  <span className="text-muted-foreground">- Источник кампании</span>
                </Label>
                <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="google" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs">
                  utm_medium <Hint text="utm_medium - тип рекламы. Примеры: cpc, email, social, banner, display" />
                  <span className="text-muted-foreground">- Тип трафика</span>
                </Label>
                <Input value={medium} onChange={(e) => setMedium(e.target.value)} placeholder="cpc" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs">
                  utm_campaign <Hint text="utm_campaign - произвольное название кампании. Пример: mebel_dlya_doma" />
                  <span className="text-muted-foreground">- Название кампании</span>
                </Label>
                <Input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="spring_sale" className="font-mono" />
              </div>
            </CardContent>
          </Card>

          {/* Optional */}
          <Card>
            <button
              type="button"
              onClick={() => setShowOptional((v) => !v)}
              className="flex w-full items-center justify-between p-6 pb-3 text-left"
            >
              <span className="text-base font-semibold">Дополнительные параметры</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", showOptional && "rotate-180")} />
            </button>
            {showOptional && (
              <CardContent className="space-y-4 pt-0">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs">
                    utm_content <Hint text="Дополнительная информация об объявлении. Пример: banner_240x60" />
                    <span className="text-muted-foreground">- Идентификатор объявления</span>
                  </Label>
                  <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="banner_240x60" className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs">
                    utm_term <Hint text="Ключевое слово, по которому показывается объявление" />
                    <span className="text-muted-foreground">- Ключевое слово</span>
                  </Label>
                  <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="kupit_divan" className="font-mono" />
                </div>
              </CardContent>
            )}
          </Card>

          {/* Extra settings */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label className="text-sm">Транслитерация кириллицы</Label>
                  <p className="text-[11px] text-muted-foreground">Автоматически переводит русские буквы в латиницу.</p>
                </div>
                <Switch checked={doTranslit} onCheckedChange={setDoTranslit} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: result + info */}
        <div className="space-y-6">
          <Card className="lg:sticky lg:top-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Результат</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={result || "https://example.com?utm_source=..."}
                readOnly
                rows={5}
                className="font-mono text-xs resize-none bg-muted/30"
              />
              <div className="flex items-center gap-3">
                <Button onClick={handleCopy} disabled={!result} className="gap-2">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  Копировать
                </Button>
                {copied && <span className="text-xs text-emerald-400">Ссылка скопирована ✓</span>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Автоматическое исправление ошибок</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li>- Только один знак ? в ссылке</li>
                <li>- Каждый параметр начинается с &</li>
                <li>- Автозамена символов # & =</li>
                <li>- Удаление дублирующихся http/https</li>
                <li>- Перевод в нижний регистр</li>
                <li>- Транслитерация кириллицы (при включенной опции)</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Reference */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Динамические переменные</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible defaultValue="ref">
            <AccordionItem value="ref" className="border-0">
              <AccordionTrigger className="py-2 text-sm">Показать справочник</AccordionTrigger>
              <AccordionContent>
                <Tabs defaultValue="google">
                  <TabsList>
                    <TabsTrigger value="google">Google Ads</TabsTrigger>
                    <TabsTrigger value="yandex">Яндекс.Директ</TabsTrigger>
                    <TabsTrigger value="vk">ВКонтакте / Target</TabsTrigger>
                  </TabsList>

                  <TabsContent value="google">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-1/3">Параметр</TableHead>
                          <TableHead>Что подставится</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <ParamRow name="{adgroupid}" desc="ID группы объявлений" />
                        <ParamRow name="{adposition}" desc="Позиция объявления (например: 1t2)" />
                        <ParamRow name="{campaignid}" desc="ID кампании" />
                        <ParamRow name="{creative}" desc="ID объявления" />
                        <ParamRow name="{device}" desc="Тип устройства" />
                        <ParamRow name="{keyword}" desc="Ключевое слово" />
                        <ParamRow name="{matchtype}" desc="Тип соответствия" />
                        <ParamRow name="{placement}" desc="Сайт показа" />
                        <ParamRow name="{targetid}" desc="ID ключевого слова / аудитории" />
                      </TableBody>
                    </Table>
                  </TabsContent>

                  <TabsContent value="yandex">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-1/3">Параметр</TableHead>
                          <TableHead>Что подставится</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <ParamRow name="{ad_id} / {banner_id}" desc="ID объявления" />
                        <ParamRow name="{campaign_id}" desc="ID кампании" />
                        <ParamRow name="{campaign_type}" desc="Тип кампании (type1-type4)" />
                        <ParamRow name="{device_type}" desc="desktop / mobile / tablet" />
                        <ParamRow name="{gbid}" desc="ID группы" />
                        <ParamRow name="{keyword}" desc="Ключевая фраза" />
                        <ParamRow name="{phrase_id}" desc="ID ключевой фразы" />
                        <ParamRow name="{position}" desc="Позиция в блоке" />
                        <ParamRow name="{position_type}" desc="Тип блока (premium / other / none)" />
                        <ParamRow name="{source}" desc="Место показа" />
                        <ParamRow name="{source_type}" desc="search / context" />
                        <ParamRow name="{region_name}" desc="Регион показа" />
                        <ParamRow name="{region_id}" desc="ID региона" />
                      </TableBody>
                    </Table>
                  </TabsContent>

                  <TabsContent value="vk">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-1/3">Параметр</TableHead>
                          <TableHead>Что подставится</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <ParamRow name="{{advertiser_id}}" desc="ID рекламодателя" />
                        <ParamRow name="{{campaign_id}}" desc="ID кампании" />
                        <ParamRow name="{{campaign_name}}" desc="Название кампании" />
                        <ParamRow name="{{banner_id}}" desc="ID баннера" />
                        <ParamRow name="{{geo}}" desc="ID региона" />
                        <ParamRow name="{{gender}}" desc="Пол пользователя" />
                        <ParamRow name="{{age}}" desc="Возраст пользователя" />
                        <ParamRow name="{{random}}" desc="Случайное число" />
                      </TableBody>
                    </Table>
                  </TabsContent>
                </Tabs>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
    </div>
  );
}