import { useEffect, useState } from "react";
import { Loader2, Copy, Download, Check, X, Sparkles, Link2, Plus, Trash2, History, RotateCcw, Wand2, Search, Wrench, ExternalLink, ShieldCheck, AlertTriangle, ShieldAlert, Telescope, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import VcWriterBulk from "@/components/vc-writer/VcWriterBulk";

type Format = "guide" | "rating" | "review" | "case";
type AuthorPersona = "agency" | "inhouse" | "brand_owner" | "expert" | "freeform";

const PERSONA_OPTIONS: Array<{ value: AuthorPersona; label: string; hint: string }> = [
  { value: "freeform", label: "Свободный формат", hint: "Без конкретного автора-бизнеса. Обобщения: 'практика показывает', 'у коллег'." },
  { value: "agency", label: "Агентство / подрядчик", hint: "'Мы в агентстве', 'клиент пришёл с задачей'. Без выдуманных имён клиентов." },
  { value: "inhouse", label: "In-house маркетолог/продакт", hint: "'У нас в компании', 'наша команда'. Без выдуманных оборотов и штата." },
  { value: "brand_owner", label: "Владелец бренда продукта", hint: "Запрещены выдуманные собственные сервис, штат, парк, кейсы клиентов." },
  { value: "expert", label: "Независимый эксперт", hint: "От первого лица как наблюдатель. Без своего бизнеса/штата/клиентов." },
];

/** Эвристика автоподбора персоны по теме. */
function suggestPersona(topic: string): { persona: AuthorPersona; reason: string } | null {
  const t = (topic || "").toLowerCase();
  if (!t || t.length < 8) return null;
  if (/\b(наш(е|и|у|его)?\s+(продукт|сервис|приложение|бренд|масло|стартап|сайт))|мы\s+(запустили|выпустили|сделали\s+продукт)|наша\s+компания|наш\s+стартап\b/.test(t)) {
    return { persona: "brand_owner", reason: "тема от первого лица о собственном продукте" };
  }
  if (/\b(агентств|подрядчик|клиент(а|у|ы)?\s+привели|для\s+клиента|на\s+проекте\s+клиента)\b/.test(t)) {
    return { persona: "agency", reason: "тема про работу с клиентами" };
  }
  if (/\b(in-?house|внутри\s+компании|внутренн|у\s+нас\s+в\s+команде|маркетолог\s+в\s+штате)\b/.test(t)) {
    return { persona: "inhouse", reason: "тема про in-house работу" };
  }
  if (/\b(обзор|сравнение|тестировал|проверил|разбор\s+продукта|опыт\s+использован|плюсы\s+и\s+минусы)\b/.test(t)) {
    return { persona: "expert", reason: "обзорно-аналитическая тема" };
  }
  return null;
}

const MODEL_OPTIONS = [
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Рекомендуем сейчас - стабильно укладывается в лимит генерации", recommended: true },
  { value: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5", hint: "Живой русский, но может быть медленнее" },
  { value: "anthropic/claude-opus-4.1", label: "Claude Opus 4.1", hint: "Премиум - сильнее в нюансах и аргументации, дороже" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Длинный контекст, стабильный markdown" },
  { value: "openai/gpt-5", label: "GPT-5", hint: "Универсал, чуть суше по тону" },
];

interface Result {
  ok: boolean;
  markdown: string;
  meta: { title: string; subtitle: string; tags: string[]; ps_question: string };
  checklist: Array<{ label: string; ok: boolean; hint: string }>;
  cover_data_url: string | null;
  stats?: { chars: number; model: string };
  seo?: { mode: boolean; target_query: string | null; suggestions: string[] };
  links_report?: { injected: string[]; appended: string[] };
  history_id?: string | null;
  risk_report?: RiskReport | null;
}

interface FactClaim {
  text: string;
  kind: string;
  verified: boolean;
  note: string;
}

interface RiskReport {
  total: number;
  unverified: number;
  level: "low" | "medium" | "high";
  claims: FactClaim[];
  summary: string;
}

interface HistoryRow {
  id: string;
  created_at: string;
  format: string;
  model: string;
  topic: string;
  thesis: string | null;
  audience: string | null;
  tone: string | null;
  length_target: number | null;
  target_query: string | null;
  seo_mode: boolean | null;
  client_links: Array<{ url: string; anchor: string; hint?: string }> | null;
  title: string | null;
  subtitle: string | null;
  tags: string[] | null;
  ps_question: string | null;
  markdown: string | null;
  checklist: Array<{ label: string; ok: boolean; hint: string }> | null;
  links_report: { injected: string[]; appended: string[] } | null;
  chars: number | null;
  is_favorite: boolean | null;
  author_persona?: string | null;
  verified_facts?: string | null;
  risk_report?: RiskReport | null;
}

const FORMAT_OPTIONS: Array<{ value: Format; label: string; hint: string }> = [
  { value: "guide", label: "Статья-разбор / гайд", hint: "Пошаговый разбор с цифрами" },
  { value: "rating", label: "Рейтинг / ТОП-N", hint: "Подборка с критериями и оценками" },
  { value: "review", label: "Обзор продукта", hint: "Личный опыт с плюсами и минусами" },
  { value: "case", label: "Кейс / антикейс / мнение", hint: "История с конфликтом и цифрами" },
];

export default function VcWriterPage() {
  const [format, setFormat] = useState<Format>("guide");
  const [model, setModel] = useState<string>("google/gemini-2.5-flash");
  const [topic, setTopic] = useState("");
  const [thesis, setThesis] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("экспертно-разговорный с легкой провокацией");
  const [length, setLength] = useState(5500);
  const [seoMode, setSeoMode] = useState(true);
  const [targetQuery, setTargetQuery] = useState("");
  const [clientLinks, setClientLinks] = useState<Array<{ url: string; anchor: string; hint: string }>>([]);
  const [pinnedCompany, setPinnedCompany] = useState("");
  const [ratingType, setRatingType] = useState<"services" | "products" | "saas" | "manual">("services");
  const [ratingCity, setRatingCity] = useState("");
  const [ratingManual, setRatingManual] = useState("");
  const [addUtm, setAddUtm] = useState(true);
  // Конверсионный блок-оффер автора (нативный CTA в стиле vc.ru).
  const [offerEnabled, setOfferEnabled] = useState(false);
  const [offerStyle, setOfferStyle] = useState<"soft" | "native" | "leadmagnet">("native");
  const [offerText, setOfferText] = useState("");
  const [offerBenefit, setOfferBenefit] = useState("");
  const [offerCta, setOfferCta] = useState("Оставить заявку");
  const [offerUrl, setOfferUrl] = useState("");
  // Уровень контент-воронки (TOFU / MOFU / BOFU / auto).
  const [funnelStage, setFunnelStage] = useState<"auto" | "tofu" | "mofu" | "bofu">("auto");
  const [funnelPackLoading, setFunnelPackLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [authorPersona, setAuthorPersona] = useState<AuthorPersona>("freeform");
  const [verifiedFacts, setVerifiedFacts] = useState("");
  const [nicheTerms, setNicheTerms] = useState("");
  const [factCheckOn, setFactCheckOn] = useState(true);
  const [humanizeOn, setHumanizeOn] = useState(false);
  // Источник кейса/обзора: имя клиента, URL, дата. Обязателен для форматов case/review.
  const [caseSource, setCaseSource] = useState("");
  // Если research.format_mismatch=true, генерация блокируется до явного согласия.
  const [allowMismatch, setAllowMismatch] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [humanizing, setHumanizing] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [serpTop, setSerpTop] = useState<Array<{ position: number; title: string; link: string; snippet: string }> | null>(null);
  const [serpPaa, setSerpPaa] = useState<string[]>([]);
  const [serpLoading, setSerpLoading] = useState(false);
  const [serpOnlyVc, setSerpOnlyVc] = useState(true);
  const [defaking, setDefaking] = useState(false);
  const [webChecking, setWebChecking] = useState(false);
  const [webResults, setWebResults] = useState<Array<{ text: string; status: string; why?: string; evidence?: Array<{ title: string; link: string; snippet: string }> }> | null>(null);
  const [personaTouched, setPersonaTouched] = useState(false);
  const [personaSuggest, setPersonaSuggest] = useState<{ persona: AuthorPersona; reason: string } | null>(null);

  // Topic Research (этап анализа топ-материалов перед генерацией)
  const [researching, setResearching] = useState(false);
  // Отметка о том, что research уже запускался для текущей темы (чтобы не дёргать повторно).
  const [autoResearchedTopic, setAutoResearchedTopic] = useState<string>("");
  const [research, setResearch] = useState<{
    summary_md: string;
    recommended_format: Format;
    dominant_format: Format;
    format_reason: string;
    format_mismatch: boolean;
    mismatch_warning: string;
    title_patterns: string[];
    audience_signals: string[];
    sources: Array<{ title: string; link: string }>;
  } | null>(null);

  // Topics by Site: анализ сайта клиента -> темы в VC-форматах.
  const [siteUrl, setSiteUrl] = useState("");
  const [siteExtra, setSiteExtra] = useState("");
  const [siteLoading, setSiteLoading] = useState(false);
  const [siteResult, setSiteResult] = useState<null | {
    site_url: string;
    pages_analyzed: string[];
    site_analysis: {
      products_services: string[]; audience: string[];
      buying_scenarios: string[]; client_pains: string[];
      buyer_mistakes: string[]; loss_points: string[];
    };
    topics: Array<{
      title: string; format: string; vc_format: Format;
      problem: string; site_role: string; case_source_hint: string;
      site_removable: boolean; site_is_only_reason: boolean;
      valid: boolean; reject_reason: string;
    }>;
    valid_count: number;
  }>(null);

  // Topics by SEO query: подбор тем под поисковый запрос без анализа сайта клиента.
  const [seoNiche, setSeoNiche] = useState("");
  const [seoKeywords, setSeoKeywords] = useState("");
  const [seoTopicsLoading, setSeoTopicsLoading] = useState(false);
  const [seoTopicsResult, setSeoTopicsResult] = useState<null | {
    serper_used: boolean;
    real_queries_count: number;
    topics: Array<{
      topic: string; format: Format; thesis: string;
      target_query: string; intent: string; search_volume_guess: string;
    }>;
  }>(null);

  const runTopicsBySeo = async () => {
    const niche = seoNiche.trim();
    if (niche.length < 3) {
      toast.error("Укажите нишу или основной запрос (минимум 3 символа)");
      return;
    }
    setSeoTopicsLoading(true);
    setSeoTopicsResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("vc-writer-topics", {
        body: {
          niche,
          keywords: seoKeywords.trim() || undefined,
          count: 10,
          seo_mode: true,
          model,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Не удалось подобрать темы");
      setSeoTopicsResult({
        serper_used: !!data.serper_used,
        real_queries_count: Number(data.real_queries_count) || 0,
        topics: Array.isArray(data.topics) ? data.topics : [],
      });
      toast.success(
        data.serper_used
          ? `Подобрано ${data.topics?.length || 0} тем (учтено ${data.real_queries_count} реальных запросов)`
          : `Подобрано ${data.topics?.length || 0} тем`,
      );
    } catch (e: any) {
      toast.error(e?.message || "Подбор тем не удался");
    } finally {
      setSeoTopicsLoading(false);
    }
  };

  const applySeoTopic = (t: NonNullable<typeof seoTopicsResult>["topics"][number]) => {
    setTopic(t.topic);
    if (t.format) setFormat(t.format);
    if (t.thesis) setThesis(t.thesis);
    if (t.target_query) {
      setSeoMode(true);
      setTargetQuery(t.target_query);
    }
    toast.success("SEO-тема применена. Можно сразу запускать генерацию.");
  };

  const runTopicsBySite = async () => {
    const u = siteUrl.trim();
    if (!/^https?:\/\/\S+\.\S+/i.test(u)) {
      toast.error("Укажите корректный URL сайта (с http:// или https://)");
      return;
    }
    setSiteLoading(true);
    setSiteResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("vc-writer-tools", {
        body: { action: "topics_by_site", site_url: u, extra_context: siteExtra.trim() || null },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Не удалось проанализировать сайт");
      setSiteResult(data);
      toast.success(`Найдено ${data.valid_count}/${data.topics.length} валидных тем`);
    } catch (e: any) {
      toast.error(e?.message || "Анализ сайта не удался");
    } finally {
      setSiteLoading(false);
    }
  };

  const applySiteTopic = (t: NonNullable<typeof siteResult>["topics"][number]) => {
    setTopic(t.title);
    setFormat(t.vc_format);
    setThesis(t.problem);
    if (siteResult?.site_url && !clientLinks.some((l) => l.url === siteResult.site_url)) {
      setClientLinks([
        ...clientLinks,
        { url: siteResult.site_url, anchor: "сайт", hint: t.site_role },
      ].slice(0, 5));
    }
    if ((t.vc_format === "case" || t.vc_format === "review") && t.case_source_hint && !caseSource.trim()) {
      setCaseSource(t.case_source_hint);
    }
    toast.success("Тема применена. Дополните «Источник кейса» реальными данными.");
  };

  const runTopicResearch = async () => {
    if (topic.trim().length < 5) {
      toast.error("Сначала укажите тему (минимум 5 символов)");
      return;
    }
    setResearching(true);
    setResearch(null);
    setAllowMismatch(false);
    try {
      const { data, error } = await supabase.functions.invoke("vc-writer-tools", {
        body: { action: "topic_research", topic: topic.trim(), selected_format: format },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Анализ не удался");
      setResearch(data);
      toast.success(data.format_mismatch
        ? `В топе доминирует формат "${data.dominant_format}", а вы выбрали "${format}"`
        : `Анализ готов. Рекомендованный формат: ${data.recommended_format}`);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось проанализировать тему");
    } finally {
      setResearching(false);
    }
  };

  // Автозапуск анализа темы с дебаунсом 1.5с: только если тема ≥15 символов
  // и для этой темы ещё не запускали. Снимает с пользователя необходимость
  // помнить про кнопку - именно это раньше ломало качество.
  useEffect(() => {
    const t = topic.trim();
    if (t.length < 15) return;
    if (autoResearchedTopic === t) return;
    if (researching) return;
    const id = setTimeout(() => {
      setAutoResearchedTopic(t);
      runTopicResearch();
    }, 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  // Любая смена формата сбрасывает разрешение на mismatch.
  useEffect(() => { setAllowMismatch(false); }, [format]);

  // Auto-suggest persona on topic change (only if user didn't manually pick).
  useEffect(() => {
    if (personaTouched) return;
    const s = suggestPersona(topic);
    setPersonaSuggest(s);
    if (s && s.persona !== authorPersona) {
      setAuthorPersona(s.persona);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from("vc_writer_history")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setHistory((data as unknown as HistoryRow[]) || []);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось загрузить историю");
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (historyOpen) loadHistory();
  }, [historyOpen]);

  const restoreFromHistory = (row: HistoryRow) => {
    setFormat((row.format as Format) || "guide");
    setModel(row.model || "anthropic/claude-sonnet-4.5");
    setTopic(row.topic || "");
    setThesis(row.thesis || "");
    setAudience(row.audience || "");
    setTone(row.tone || "экспертно-разговорный с легкой провокацией");
    setLength(row.length_target || 5500);
    setSeoMode(!!row.seo_mode);
    setTargetQuery(row.target_query || "");
    setClientLinks(
      Array.isArray(row.client_links)
        ? row.client_links.map((l) => ({ url: l.url || "", anchor: l.anchor || "", hint: l.hint || "" }))
        : [],
    );
    setAuthorPersona(((row.author_persona as AuthorPersona) || "freeform"));
    setVerifiedFacts(row.verified_facts || "");
    setResult({
      ok: true,
      markdown: row.markdown || "",
      meta: {
        title: row.title || "",
        subtitle: row.subtitle || "",
        tags: Array.isArray(row.tags) ? row.tags : [],
        ps_question: row.ps_question || "",
      },
      checklist: Array.isArray(row.checklist) ? row.checklist : [],
      cover_data_url: null,
      stats: { chars: row.chars || 0, model: row.model },
      seo: { mode: !!row.seo_mode, target_query: row.target_query, suggestions: [] },
      links_report: row.links_report || undefined,
      risk_report: row.risk_report || null,
      history_id: row.id,
    });
    setHistoryOpen(false);
    toast.success("Параметры и результат загружены");
  };

  const deleteHistoryRow = async (id: string) => {
    const { error } = await supabase.from("vc_writer_history").delete().eq("id", id);
    if (error) {
      toast.error("Не удалось удалить");
      return;
    }
    setHistory((h) => h.filter((r) => r.id !== id));
  };

  const handleGenerate = async () => {
    if (topic.trim().length < 5) {
      toast.error("Укажите тему (минимум 5 символов)");
      return;
    }
    return doGenerate();
  };

  /**
   * Funnel Pack — генерим 3 связанные статьи (TOFU+MOFU+BOFU) под одну исходную
   * тему через batch-эндпоинт. Темы автодеривируются из текущего topic.
   */
  const handleFunnelPack = async () => {
    const base = topic.trim();
    if (base.length < 5) {
      toast.error("Сначала укажите базовую тему");
      return;
    }
    setFunnelPackLoading(true);
    try {
      const year = new Date().getFullYear();
      const items = [
        {
          format: "guide",
          funnel_stage: "tofu",
          topic: `Что такое ${base}: как работает и где применяется`,
          thesis: `Информационный разбор темы «${base}» для аудитории, которая впервые с ней сталкивается. Без продаж.`,
        },
        {
          format: "guide",
          funnel_stage: "mofu",
          topic: `Как выбрать ${base} в ${year}: сравнение вариантов и типовые ошибки`,
          thesis: `Сравнение основных вариантов по теме «${base}», ошибки покупателей и чек-лист выбора. Цель — провести читателя к решению.`,
        },
        {
          format: "guide",
          funnel_stage: "bofu",
          topic: `Сколько стоит ${base} в ${year} и как не переплатить`,
          thesis: `Ценовые диапазоны по сегментам, ошибки на которых теряют деньги, чек-лист проверки перед покупкой и блок «как мы помогаем».`,
        },
      ];
      const { data, error } = await supabase.functions.invoke("vc-writer-batch", {
        body: {
          items,
          model,
          audience,
          tone,
          length,
          default_format: "guide",
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Не удалось создать Funnel Pack");
      toast.success("Funnel Pack отправлен в очередь (3 статьи). Прогресс - во вкладке «Массовая генерация».");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось запустить Funnel Pack");
    } finally {
      setFunnelPackLoading(false);
    }
  };

  const doGenerate = async () => {
    // Hard-stop: для case/review без источника блокируем генерацию.
    if ((format === "case" || format === "review") && caseSource.trim().length < 5) {
      toast.error("Укажите источник кейса: имя клиента/проекта, URL или дату. Без этого модель выдумает героя.");
      return;
    }
    // Hard-stop: research показал несоответствие формата, а пользователь не подтвердил.
    if (research?.format_mismatch && !allowMismatch) {
      toast.error(`Формат «${format}» не соответствует топу выдачи. Смените на «${research.recommended_format}» или подтвердите генерацию.`);
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      // Поддержка нескольких запросов через запятую: первый - главный target, остальные - LSI
      const queries = targetQuery
        .split(/[,\n;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const primaryQuery = queries[0] || null;
      const extraQueries = queries.slice(1);
      const thesisWithExtras = extraQueries.length
        ? `${thesis}\n\nДополнительные SEO-запросы (вписать естественно в текст и подзаголовки, по 1-2 раза каждый): ${extraQueries.join(", ")}`
        : thesis;
      // Источник кейса присоединяем к проверенным фактам, чтобы модель использовала
      // именно его как героя/контекст материала и не выдумывала клиента.
      const factsWithSource = (() => {
        const src = caseSource.trim();
        if (!src) return verifiedFacts.trim() || null;
        const header = format === "case"
          ? `ИСТОЧНИК КЕЙСА (использовать как героя статьи, не выдумывать другого):\n${src}`
          : `ОБЪЕКТ ОБЗОРА (использовать именно его, не подменять):\n${src}`;
        return [header, verifiedFacts.trim()].filter(Boolean).join("\n\n").slice(0, 4000);
      })();
      const { data, error } = await supabase.functions.invoke("vc-writer", {
        body: {
          format, model, topic, thesis: thesisWithExtras, audience, tone, length,
          generate_cover: false,
          seo_mode: seoMode,
          target_query: primaryQuery,
          author_persona: authorPersona,
          verified_facts: factsWithSource,
          fact_check: factCheckOn,
          humanize: humanizeOn,
          topic_research: research?.summary_md || null,
          funnel_stage: funnelStage,
          niche_terms: nicheTerms
            .split(/[,;\n]+/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 2)
            .slice(0, 10),
          client_links: clientLinks
            .filter((l) => l.url.trim() && l.anchor.trim())
            .map((l) => {
              if (!addUtm) return l;
              try {
                const u = new URL(l.url.trim());
                if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", "vc");
                if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", "article");
                return { ...l, url: u.toString() };
              } catch {
                return l;
              }
            })
            .slice(0, 5),
          pinned_company: format === "rating" ? pinnedCompany.trim() : "",
          rating_type: format === "rating" ? ratingType : undefined,
          rating_city: format === "rating" ? ratingCity.trim() : undefined,
          rating_manual: format === "rating" && ratingType === "manual" ? ratingManual.trim() : undefined,
          offer_block: (() => {
            if (!offerEnabled) return undefined;
            const o = offerText.trim();
            const c = offerCta.trim();
            let u = offerUrl.trim();
            if (!o || !c || !/^https?:\/\/\S+$/i.test(u)) return undefined;
            if (addUtm) {
              try {
                const url = new URL(u);
                if (!url.searchParams.has("utm_source")) url.searchParams.set("utm_source", "vc");
                if (!url.searchParams.has("utm_medium")) url.searchParams.set("utm_medium", "article");
                if (!url.searchParams.has("utm_campaign")) url.searchParams.set("utm_campaign", "offer");
                u = url.toString();
              } catch { /* ignore */ }
            }
            return {
              style: offerStyle,
              offer: o,
              benefit: offerBenefit.trim() || undefined,
              cta: c,
              url: u,
            };
          })(),
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Не удалось сгенерировать материал");
      setResult(data as Result);
      const tq = (data as Result).seo?.target_query;
      toast.success(tq ? `Материал готов. SEO-цель: ${tq}` : "Материал готов");
      if ((data as any)?.offer_silenced) {
        toast.warning((data as any).offer_silenced);
      }
    } catch (e: any) {
      toast.error(e?.message || "Ошибка генерации");
    } finally {
      setLoading(false);
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} скопировано`));
  };

  const runHumanize = async () => {
    if (!result?.markdown) return;
    setHumanizing(true);
    try {
      const { data, error } = await supabase.functions.invoke("vc-writer-tools", {
        body: { action: "humanize", markdown: result.markdown },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("humanize failed");
      setResult({
        ...result,
        markdown: data.markdown,
        checklist: data.checklist || result.checklist,
        stats: { chars: data.stats?.chars ?? result.stats?.chars ?? 0, model: result.stats?.model || "" },
      });
      toast.success(`Humanize готово (${data.passes_applied} прохода)`);
    } catch (e: any) {
      toast.error(e?.message || "Humanize не удался");
    } finally {
      setHumanizing(false);
    }
  };

  const rerunFactCheck = async () => {
    if (!result?.markdown) return;
    setRechecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("vc-writer-tools", {
        body: { action: "factcheck", markdown: result.markdown, verified_facts: verifiedFacts.trim() || null },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("factcheck failed");
      setResult({ ...result, risk_report: data.risk_report });
      toast.success("Факт-чек обновлён");
    } catch (e: any) {
      toast.error(e?.message || "Факт-чек не удался");
    } finally {
      setRechecking(false);
    }
  };

  const runDefake = async () => {
    if (!result?.markdown || !result?.risk_report) return;
    const claims = result.risk_report.claims.filter((c) => !c.verified).map((c) => ({ text: c.text, note: c.note }));
    if (!claims.length) { toast.info("Нет неподтверждённых утверждений"); return; }
    setDefaking(true);
    try {
      const { data, error } = await supabase.functions.invoke("vc-writer-tools", {
        body: {
          action: "defake",
          markdown: result.markdown,
          claims,
          model,
          verified_facts: verifiedFacts.trim() || null,
          ps_question: result.meta.ps_question,
          client_links: clientLinks.filter((l) => l.url && l.anchor).slice(0, 5),
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("defake failed");
      setResult({
        ...result,
        markdown: data.markdown,
        checklist: data.checklist || result.checklist,
        links_report: data.links_report || result.links_report,
        risk_report: data.risk_report ?? result.risk_report,
        stats: { chars: data.stats?.chars ?? result.stats?.chars ?? 0, model: result.stats?.model || "" },
      });
      setWebResults(null);
      const newUnv = data.risk_report?.unverified ?? 0;
      toast.success(newUnv ? `Готово. Осталось ${newUnv} непроверенных` : "Выдуманные числа убраны");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось убрать выдуманные числа");
    } finally {
      setDefaking(false);
    }
  };

  const runWebFactCheck = async () => {
    if (!result?.risk_report) return;
    const claims = result.risk_report.claims.filter((c) => !c.verified).map((c) => ({ text: c.text, kind: c.kind, note: c.note }));
    if (!claims.length) { toast.info("Нет неподтверждённых утверждений"); return; }
    setWebChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("vc-writer-tools", {
        body: { action: "factcheck_web", claims },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("web factcheck failed");
      setWebResults(data.results || []);
      const s = data.summary || { confirmed: 0, contradicted: 0, not_found: 0, total: 0 };
      toast.success(`Web-проверка: подтверждено ${s.confirmed}, опровергнуто ${s.contradicted}, не найдено ${s.not_found}`);
    } catch (e: any) {
      toast.error(e?.message || "Web-проверка не удалась");
    } finally {
      setWebChecking(false);
    }
  };

  const runAutoFix = async () => {
    if (!result?.markdown) return;
    const failed = result.checklist.filter((c) => !c.ok).map((c) => `${c.label} (${c.hint})`);
    if (!failed.length) {
      toast.info("Чек-лист уже зелёный");
      return;
    }
    setFixing(true);
    try {
      const { data, error } = await supabase.functions.invoke("vc-writer-tools", {
        body: {
          action: "fix",
          markdown: result.markdown,
          failed,
          ps_question: result.meta.ps_question,
          model,
          verified_facts: verifiedFacts.trim() || null,
          client_links: clientLinks.filter((l) => l.url && l.anchor).slice(0, 5),
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("fix failed");
      setResult({
        ...result,
        markdown: data.markdown,
        checklist: data.checklist || result.checklist,
        links_report: data.links_report || result.links_report,
        risk_report: data.risk_report ?? result.risk_report,
        stats: { chars: data.stats?.chars ?? result.stats?.chars ?? 0, model: result.stats?.model || "" },
      });
      const stillBad = (data.checklist || []).filter((c: any) => !c.ok).length;
      toast.success(stillBad ? `Исправлено. Осталось ${stillBad} замечаний` : "Все пункты зелёные");
    } catch (e: any) {
      toast.error(e?.message || "Автофикс не удался");
    } finally {
      setFixing(false);
    }
  };

  const loadSerpTop = async () => {
    const q = (result?.seo?.target_query || targetQuery.split(/[,\n;]+/)[0] || topic || "").trim();
    if (!q) {
      toast.error("Нет запроса для поиска");
      return;
    }
    setSerpLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("vc-writer-tools", {
        body: { action: "serp_top", query: q, only_vc: serpOnlyVc },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("serp failed");
      setSerpTop(data.top || []);
      setSerpPaa(data.paa || []);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось загрузить SERP");
    } finally {
      setSerpLoading(false);
    }
  };

  const modelLabel = MODEL_OPTIONS.find((o) => o.value === model)?.label || model;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Sparkles className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">vc.ru Writer</h1>
            <p className="text-sm text-muted-foreground">
              Генератор статей под формат vc.ru - с крючком в лиде, цифрами, провалами и P.S. для комментариев
            </p>
          </div>
        </div>
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              <History className="h-4 w-4 mr-1.5" /> История
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
            <SheetHeader>
              <SheetTitle>История генераций</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-2">
              {historyLoading && (
                <div className="py-10 text-center text-muted-foreground text-sm">
                  <Loader2 className="h-5 w-5 mx-auto animate-spin mb-2" /> Загружаю...
                </div>
              )}
              {!historyLoading && history.length === 0 && (
                <div className="py-10 text-center text-muted-foreground text-sm">
                  Пока ничего не сгенерировано
                </div>
              )}
              {history.map((row) => (
                <div key={row.id} className="rounded-md border border-border p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{row.title || row.topic}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{row.topic}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => restoreFromHistory(row)}>
                        <RotateCcw className="h-3 w-3 mr-1" /> Открыть
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-rose-400" onClick={() => deleteHistoryRow(row.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">{row.format}</Badge>
                    {row.target_query && (
                      <Badge variant="outline" className="h-4 px-1.5 text-[9px]">SEO: {row.target_query.slice(0, 40)}</Badge>
                    )}
                    {row.risk_report && row.risk_report.total > 0 && (
                      <Badge
                        variant="outline"
                        className={`h-4 px-1.5 text-[9px] ${
                          row.risk_report.level === "high" ? "border-rose-500/40 text-rose-300"
                          : row.risk_report.level === "medium" ? "border-amber-500/40 text-amber-300"
                          : "border-emerald-500/40 text-emerald-300"
                        }`}
                        title={row.risk_report.summary}
                      >
                        Риск: {row.risk_report.unverified}/{row.risk_report.total}
                      </Badge>
                    )}
                    {!!row.chars && <span>{row.chars} зн.</span>}
                    <span>•</span>
                    <span>{new Date(row.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <Tabs defaultValue="single" className="space-y-4">
        <TabsList>
          <TabsTrigger value="single">Одиночная статья</TabsTrigger>
          <TabsTrigger value="bulk">Пакет (до 15)</TabsTrigger>
        </TabsList>

        <TabsContent value="bulk" className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Модель для всей пачки</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger>
                    <SelectValue>{modelLabel}</SelectValue>
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
              </div>
            </CardContent>
          </Card>
          <VcWriterBulk model={model} modelLabel={modelLabel} />
        </TabsContent>

        <TabsContent value="single">
        <div className={result || loading ? "grid lg:grid-cols-[minmax(380px,440px)_1fr] gap-6 items-start" : "max-w-3xl mx-auto"}>
        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Параметры материала</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Формат</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
                <SelectTrigger>
                  <SelectValue>
                    {FORMAT_OPTIONS.find((o) => o.value === format)?.label}
                  </SelectValue>
                </SelectTrigger>
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
              <Label className="flex items-center gap-1.5">
                Уровень воронки
                <Badge variant="outline" className="h-4 text-[9px] px-1.5">новое</Badge>
              </Label>
              <Select value={funnelStage} onValueChange={(v) => setFunnelStage(v as typeof funnelStage)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    <div className="flex flex-col">
                      <span>Авто</span>
                      <span className="text-xs text-muted-foreground">Без жёстких правил воронки (старое поведение)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="tofu">
                    <div className="flex flex-col">
                      <span>TOFU - трафик / охват</span>
                      <span className="text-xs text-muted-foreground">Информационная статья под Яндекс. Без оффера и клиентских ссылок.</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="mofu">
                    <div className="flex flex-col">
                      <span>MOFU - выбор и сравнение</span>
                      <span className="text-xs text-muted-foreground">Главный деньговый уровень: сравнение + ошибки + чек-лист + мягкий CTA.</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="bofu">
                    <div className="flex flex-col">
                      <span>BOFU - прямые заявки</span>
                      <span className="text-xs text-muted-foreground">Цены, ошибки, чек-лист проверки, блок «как мы помогаем», нативный CTA.</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              {funnelStage === "tofu" && offerEnabled && (
                <p className="text-[10px] text-amber-500">
                  На TOFU оффер автоматически отключается — это информационный уровень, не для заявок. Для CTA переключите воронку на MOFU/BOFU.
                </p>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[10px] text-muted-foreground">
                  Funnel Pack: 3 статьи под одну тему (TOFU + MOFU + BOFU) одной кнопкой.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  disabled={funnelPackLoading || topic.trim().length < 5}
                  onClick={() => handleFunnelPack()}
                >
                  {funnelPackLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Funnel Pack
                </Button>
              </div>
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

            {/* Topics by Site: анализ сайта клиента -> валидные темы в VC-форматах */}
            <div className="space-y-2 rounded-md border border-border p-3">
              <Label className="text-sm flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" /> Темы по сайту клиента
              </Label>
              <p className="text-[10px] text-muted-foreground leading-snug">
                Введите URL сайта клиента - подберём 8 тем, где сайт встроен нативно (как инструмент в процессе), а не выглядит рекламой. Сразу проверим: статья останется полезной, даже если убрать ссылку.
              </p>
              <div className="flex gap-2">
                <Input
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  placeholder="https://client.ru"
                  className="h-9 text-xs"
                />
                <Button
                  type="button" size="sm" variant="outline"
                  className="shrink-0 h-9 gap-1.5"
                  onClick={runTopicsBySite}
                  disabled={siteLoading || !siteUrl.trim()}
                >
                  {siteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Подобрать темы
                </Button>
              </div>
              <Input
                value={siteExtra}
                onChange={(e) => setSiteExtra(e.target.value.slice(0, 600))}
                placeholder="Контекст (необязательно): что именно продаёт, кому, частые жалобы клиентов"
                className="h-8 text-xs"
              />

              {siteResult && (
                <div className="space-y-2 pt-1">
                  <details className="text-[10px] text-muted-foreground">
                    <summary className="cursor-pointer hover:text-foreground">Анализ сайта (товары, аудитория, боли)</summary>
                    <div className="mt-1.5 space-y-1.5 pl-2 border-l border-border/40">
                      {siteResult.site_analysis.products_services?.length > 0 && (
                        <div><span className="opacity-70">Что продаёт:</span> {siteResult.site_analysis.products_services.join("; ")}</div>
                      )}
                      {siteResult.site_analysis.audience?.length > 0 && (
                        <div><span className="opacity-70">Аудитория:</span> {siteResult.site_analysis.audience.join("; ")}</div>
                      )}
                      {siteResult.site_analysis.client_pains?.length > 0 && (
                        <div><span className="opacity-70">Боли:</span> {siteResult.site_analysis.client_pains.join("; ")}</div>
                      )}
                      {siteResult.site_analysis.buyer_mistakes?.length > 0 && (
                        <div><span className="opacity-70">Ошибки покупателей:</span> {siteResult.site_analysis.buyer_mistakes.join("; ")}</div>
                      )}
                      {siteResult.site_analysis.loss_points?.length > 0 && (
                        <div><span className="opacity-70">Точки потерь:</span> {siteResult.site_analysis.loss_points.join("; ")}</div>
                      )}
                      <div className="opacity-60">Страницы: {siteResult.pages_analyzed.length}</div>
                    </div>
                  </details>

                  <div className="space-y-1.5">
                    {siteResult.topics.map((t, i) => (
                      <div
                        key={i}
                        className={`rounded border p-2 space-y-1 ${t.valid ? "border-border bg-muted/30" : "border-rose-500/30 bg-rose-500/5 opacity-70"}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium leading-snug">{t.title}</div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              <Badge variant="outline" className="h-4 px-1.5 text-[9px]">{t.format}</Badge>
                              <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">→ {t.vc_format}</Badge>
                              {!t.valid && (
                                <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-rose-500/40 text-rose-400">рекламная</Badge>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm" variant={t.valid ? "default" : "outline"}
                            className="h-7 shrink-0 text-[10px]"
                            disabled={!t.valid}
                            onClick={() => applySiteTopic(t)}
                          >
                            Применить
                          </Button>
                        </div>
                        {t.problem && <div className="text-[10px] text-muted-foreground"><span className="opacity-70">Проблема:</span> {t.problem}</div>}
                        {t.site_role && <div className="text-[10px] text-muted-foreground"><span className="opacity-70">Роль сайта:</span> {t.site_role}</div>}
                        {!t.valid && t.reject_reason && (
                          <div className="text-[10px] text-rose-400">Отклонено: {t.reject_reason}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Тема материала</Label>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Например: как мы вывели интернет-магазин с 0 до 2 млн оборота за полгода"
              />
              <div className="flex items-center justify-between gap-2 pt-1">
                <p className="text-[10px] text-muted-foreground leading-tight">
                  Анализ топ-материалов покажет, какой формат реально работает по теме, и подсветит риск «выбрали рейтинг, а в топе кейсы».
                </p>
                <Button
                  type="button" size="sm" variant="outline"
                  className="shrink-0 h-8 gap-1.5"
                  onClick={runTopicResearch}
                  disabled={researching || topic.trim().length < 5}
                >
                  {researching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Telescope className="h-3.5 w-3.5" />}
                  Анализ темы
                </Button>
              </div>
              {research && (
                <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">Анализ топ-материалов по теме</div>
                    <button
                      type="button"
                      onClick={() => setResearch(null)}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >сбросить</button>
                  </div>
                  {research.format_mismatch && (
                    <div className="rounded bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 text-amber-600 dark:text-amber-400 leading-snug flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <div>В топе доминирует формат «{research.dominant_format}», вы выбрали «{format}».</div>
                        {research.mismatch_warning && <div className="text-[10px] opacity-90">{research.mismatch_warning}</div>}
                        <button
                          type="button"
                          onClick={() => setFormat(research.recommended_format)}
                          className="text-[10px] underline hover:no-underline"
                        >Переключить на «{research.recommended_format}»</button>
                      </div>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Рекомендуем:</span>{" "}
                    <span className="font-medium">{research.recommended_format}</span>
                    {research.format_reason && <span className="text-muted-foreground"> - {research.format_reason}</span>}
                  </div>
                  {research.title_patterns?.length > 0 && (
                    <div>
                      <div className="text-muted-foreground mb-1">Заголовки, которые работают:</div>
                      <ul className="space-y-0.5 pl-3 list-disc marker:text-muted-foreground/50">
                        {research.title_patterns.slice(0, 4).map((t, i) => <li key={i}>{t}</li>)}
                      </ul>
                    </div>
                  )}
                  {research.audience_signals?.length > 0 && (
                    <div>
                      <div className="text-muted-foreground mb-1">Что обсуждают / возражения:</div>
                      <ul className="space-y-0.5 pl-3 list-disc marker:text-muted-foreground/50">
                        {research.audience_signals.slice(0, 4).map((t, i) => <li key={i}>{t}</li>)}
                      </ul>
                    </div>
                  )}
                  {research.sources?.length > 0 && (
                    <details className="text-[10px]">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">источники ({research.sources.length})</summary>
                      <ul className="mt-1 space-y-0.5 pl-3 list-disc marker:text-muted-foreground/40">
                        {research.sources.slice(0, 10).map((s, i) => (
                          <li key={i}><a href={s.link} target="_blank" rel="noreferrer" className="hover:underline">{s.title || s.link}</a></li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/50">
                    Этот анализ автоматически уйдёт в промпт генерации. Модель применит паттерны, но НЕ скопирует цифры/кейсы из найденных статей.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Главный тезис (необязательно)</Label>
              <Textarea
                value={thesis}
                onChange={(e) => setThesis(e.target.value)}
                placeholder="Что именно хотите доказать или показать. Можно оставить пустым - модель сформулирует сама."
                rows={3}
              />
              <p className="text-[11px] text-muted-foreground leading-snug">
                Совет vc.ru: дай конкретный факап с цифрой («слили 320 000 ₽ на рекламу из-за опечатки в utm_source») или острый конфликт в команде - это в 3 раза увеличит охват. Без хука статья соберёт 50-100 просмотров и уйдёт в небытие.
              </p>
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

            <div className="space-y-1.5 rounded-md border border-border p-3">
              <Label className="text-sm flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> От лица кого пишем
              </Label>
              <Select value={authorPersona} onValueChange={(v) => { setAuthorPersona(v as AuthorPersona); setPersonaTouched(true); }}>
                <SelectTrigger><SelectValue>{PERSONA_OPTIONS.find((o) => o.value === authorPersona)?.label}</SelectValue></SelectTrigger>
                <SelectContent>
                  {PERSONA_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <div className="flex flex-col">
                        <span>{o.label}</span>
                        <span className="text-xs text-muted-foreground">{o.hint}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Блокирует выдумывание фейковых сервисов, оборотов и парка клиентов автора - частая причина рискованного текста.
              </p>
              {personaSuggest && !personaTouched && (
                <div className="text-[10px] rounded bg-primary/10 border border-primary/20 px-2 py-1 text-primary">
                  Автоподбор: «{PERSONA_OPTIONS.find((o) => o.value === personaSuggest.persona)?.label}» ({personaSuggest.reason}). Изменить - выбери вручную.
                </div>
              )}
            </div>

            <div className="space-y-1.5 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" /> Проверенные факты
                </Label>
                <span className="text-[10px] text-muted-foreground">{verifiedFacts.length}/4000</span>
              </div>
              <Textarea
                value={verifiedFacts}
                onChange={(e) => setVerifiedFacts(e.target.value.slice(0, 4000))}
                placeholder={`Только реальные цифры и факты - модель не выдумает новые.\nПример:\n- цена нашего масла KAT 5W-30: 2400 руб/4л\n- цена Shell Helix Ultra 5W-30: 4100 руб/4л (Озон, июнь 2026)\n- тестировали на Camry 2019 и Kia Rio 2021, пробег по 12000 км\n- сертификация KAT: API SN, ACEA A3/B4`}
                rows={5}
                className="text-xs"
              />
              {verifiedFacts.trim().length < 20 ? (
                <div className="text-[10px] rounded bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 text-amber-600 dark:text-amber-400 leading-snug">
                  Включён режим «без конкретных чисел». Постпроцессор автоматически вырежет любые цены (руб, ₽), проценты, км/л/л.с., бизнес-метрики (N клиентов, постов) и заменит их на обобщения. Чтобы оставить конкретику - добавьте сюда реальные цифры построчно.
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground">
                  Числа из этого списка попадут в текст как есть. Любые другие конкретные цифры будут заменены на обобщения постпроцессором.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground leading-snug">
                Совет: пишите реальные «неровные» числа ($4 150, 2 437 руб, 11,6%, 6 240 км), а не круглые ($5 000, 2 500 руб, 10%). Это даёт +100 к доверию читателя vc.ru.
              </p>
            </div>

            <div className="space-y-1.5 rounded-md border border-border p-3">
              <Label className="text-sm flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Термины ниши (опционально)
              </Label>
              <Textarea
                value={nicheTerms}
                onChange={(e) => setNicheTerms(e.target.value.slice(0, 500))}
                placeholder={`Через запятую. Профжаргон, который покажет, что автор в теме.\nПримеры:\n- Недвижка в Турции: ТАПУ, Искан, DASK, Ekspertiz\n- Маркетинг: GA4, Roistat, Calltouch, CR, LTV\n- E-com: SKU, Last-Click, GMV`}
                rows={3}
                className="text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Модель обязана естественно использовать каждый термин минимум 1 раз. До 10 терминов.
              </p>
            </div>

            {(format === "case" || format === "review") && (
              <div className="space-y-1.5 rounded-md border border-border p-3">
                <Label className="text-sm flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Источник {format === "case" ? "кейса" : "обзора"}
                  <span className="text-rose-400">*</span>
                </Label>
                <Textarea
                  value={caseSource}
                  onChange={(e) => setCaseSource(e.target.value.slice(0, 600))}
                  placeholder={format === "case"
                    ? "Имя клиента/проекта, URL, период работ. Пример:\nКлиент: интернет-магазин SportLine (sportline.ru)\nПериод: март-сентябрь 2025\nИсточник данных: внутренние отчёты Метрики"
                    : "Что обозреваете: точное название, версия, URL, дата покупки. Пример:\nПродукт: масло KAT 5W-30, артикул 12345\nГде купили: Ozon, 12.03.2025, 2400 руб/4л\nНа чём тестировали: Toyota Camry 2019"}
                  rows={3}
                  className="text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Обязательное поле. Без него модель выдумает героя - это главная причина «вранья» в кейсах.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="space-y-0.5">
                <Label className="text-sm flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5" /> Fact-Check Guard
                </Label>
                <p className="text-[10px] text-muted-foreground">После генерации проверим конкретные числа и пометим неподтверждённые.</p>
              </div>
              <Switch checked={factCheckOn} onCheckedChange={setFactCheckOn} />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="space-y-0.5">
                <Label className="text-sm">Humanize-пасс (Sonnet + Opus)</Label>
                <p className="text-[10px] text-muted-foreground">
                  Двойная зачистка под живой человеческий ритм - снижает AI-детектор до &lt;5%. Добавляет ~90-120с к генерации.
                </p>
              </div>
              <Switch checked={humanizeOn} onCheckedChange={setHumanizeOn} />
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">SEO-режим (под поисковые запросы)</Label>
                  <p className="text-[10px] text-muted-foreground">
                    Статья оптимизируется под целевой запрос - ловит трафик из Google/Yandex, идеально для ссылок на клиентов.
                  </p>
                </div>
                <Switch checked={seoMode} onCheckedChange={setSeoMode} />
              </div>
              {seoMode && (
                <div className="space-y-1">
                  <Label className="text-xs">Целевые поисковые запросы (через запятую, до 5)</Label>
                  <Textarea
                    value={targetQuery}
                    onChange={(e) => setTargetQuery(e.target.value)}
                    placeholder="как продвинуть интернет-магазин в google, seo для маркетплейса, продвижение сайта услуг"
                    rows={2}
                    className="text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Первый запрос - главный (войдет в заголовок и H2). Остальные - дополнительные, естественно впишутся в текст. Пусто - подберём автоматически из реальных запросов Google.
                  </p>
                  {targetQuery.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean).length > 1 && (
                    <div className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">
                      Внимание: только первый запрос - основной SEO-таргет. Остальные используются как LSI (1-2 упоминания в тексте), не как равноценные цели. Если нужно равноценно - сгенерируй отдельные статьи в Пакетном режиме.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Длина: {length} знаков</Label>
                <div className="flex items-center gap-1">
                  {[
                    { label: "Короткий", v: 3500 },
                    { label: "Стандарт", v: 5500 },
                    { label: "Лонгрид", v: 7500 },
                  ].map((p) => (
                    <Button
                      key={p.v}
                      type="button"
                      size="sm"
                      variant={length === p.v ? "default" : "ghost"}
                      className="h-6 px-2 text-[10px]"
                      onClick={() => setLength(p.v)}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
              <Slider
                value={[length]}
                onValueChange={(v) => setLength(v[0])}
                min={3000}
                max={8000}
                step={500}
              />
              <p className="text-[10px] text-muted-foreground">vc.ru-топ обычно 4500-6500 знаков. Считаем без пробелов и markdown-разметки - vc.ru-редактор покажет похожее число (±5%).</p>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5" /> Клиентские ссылки ({clientLinks.length}/5)
                  </Label>
                  <p className="text-[10px] text-muted-foreground">
                    Ссылки впишутся в текст естественно, по 1 разу. Если модель не найдет место - добавим блоком «Полезное по теме» перед P.S.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={clientLinks.length >= 5}
                  onClick={() => setClientLinks([...clientLinks, { url: "", anchor: "", hint: "" }])}
                >
                  <Plus className="h-3 w-3 mr-1" /> Добавить
                </Button>
              </div>
              {clientLinks.length > 0 && (
                <div className="flex items-center justify-between rounded border border-border/60 px-2 py-1.5">
                  <Label className="text-[11px] flex-1 cursor-pointer" htmlFor="utm-toggle">
                    Добавлять UTM-метки (utm_source=vc, utm_medium=article)
                  </Label>
                  <Switch id="utm-toggle" checked={addUtm} onCheckedChange={setAddUtm} />
                </div>
              )}
              {clientLinks.map((l, i) => (
                <div key={i} className="space-y-1.5 rounded border border-border/60 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Ссылка {i + 1}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2"
                      onClick={() => setClientLinks(clientLinks.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <Input
                    value={l.url}
                    onChange={(e) => {
                      const next = [...clientLinks];
                      next[i] = { ...next[i], url: e.target.value };
                      setClientLinks(next);
                    }}
                    placeholder="https://client.ru/service"
                    className="h-8 text-xs"
                  />
                  <Input
                    value={l.anchor}
                    onChange={(e) => {
                      const next = [...clientLinks];
                      next[i] = { ...next[i], anchor: e.target.value };
                      setClientLinks(next);
                    }}
                    placeholder="Анкор (как фраза появится в тексте)"
                    className="h-8 text-xs"
                  />
                  <Input
                    value={l.hint}
                    onChange={(e) => {
                      const next = [...clientLinks];
                      next[i] = { ...next[i], hint: e.target.value };
                      setClientLinks(next);
                    }}
                    placeholder="Контекст (необязательно): где уместно упомянуть"
                    className="h-8 text-xs"
                  />
                </div>
              ))}
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" /> Блок-оффер автора (нативный CTA)
                  </Label>
                  <p className="text-[10px] text-muted-foreground">
                    Превращает «экспертный пост» в материал «под заявку». Вшивается ровно 1 раз в конце, без агрессивной рекламы.
                  </p>
                </div>
                <Switch checked={offerEnabled} onCheckedChange={setOfferEnabled} />
              </div>

              {offerEnabled && (
                <div className="space-y-2 pt-1">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Формат блока</Label>
                    <Select value={offerStyle} onValueChange={(v) => setOfferStyle(v as typeof offerStyle)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="native">Авто / Native CTA - отдельный H2 «Что делать дальше» (рекомендуется)</SelectItem>
                        <SelectItem value="soft">Soft - вшить в P.S. (для слабого коммерческого интента)</SelectItem>
                        <SelectItem value="leadmagnet">Lead-magnet - обмен на бесплатный чек-лист/расчёт (макс. конверсия)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Что предлагаете</Label>
                    <Input
                      value={offerText}
                      onChange={(e) => setOfferText(e.target.value)}
                      placeholder="бесплатный аудит РВД с выездом"
                      className="h-8 text-xs"
                      maxLength={240}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Выгода / крючок (опционально)</Label>
                    <Input
                      value={offerBenefit}
                      onChange={(e) => setOfferBenefit(e.target.value)}
                      placeholder="найдём 2-3 точки экономии за 30 минут"
                      className="h-8 text-xs"
                      maxLength={240}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">CTA-текст</Label>
                      <Input
                        value={offerCta}
                        onChange={(e) => setOfferCta(e.target.value)}
                        placeholder="Оставить заявку"
                        className="h-8 text-xs"
                        maxLength={80}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">URL клиента</Label>
                      <Input
                        value={offerUrl}
                        onChange={(e) => setOfferUrl(e.target.value)}
                        placeholder="https://client.ru/audit"
                        className="h-8 text-xs"
                        maxLength={500}
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    UTM-метки добавляются автоматически (utm_source=vc, utm_medium=article, utm_campaign=offer, utm_content=стиль) - если в URL уже есть метки, ваши не перетрутся. При выборе «Авто/Native» система сама переключится на Lead-magnet, если в оффере упомянуты чек-лист / расчёт / шаблон / калькулятор / гайд. Для рейтинга с закреплённым клиентом добавляется раскрытие («автор работает с компанией»). Блок контекстно привязывается к боли из тела статьи - это не баннер, а консалтинг-CTA.
                  </p>
                </div>
              )}
            </div>

            {format === "rating" && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <div className="space-y-1.5">
                  <Label className="text-sm">Источник реальных позиций</Label>
                  <Select value={ratingType} onValueChange={(v) => setRatingType(v as typeof ratingType)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="services">Услуги/компании (Google Maps)</SelectItem>
                      <SelectItem value="products">Товары (Google Shopping)</SelectItem>
                      <SelectItem value="saas">Сервисы/SaaS/сайты (Google поиск)</SelectItem>
                      <SelectItem value="manual">Ручной список</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    Реальные позиции тянутся из выбранного источника. Модель использует ТОЛЬКО их - никаких выдуманных компаний.
                  </p>
                </div>

                {ratingType === "services" && (
                  <div className="space-y-1.5">
                    <Label className="text-sm">Город / регион</Label>
                    <Input
                      value={ratingCity}
                      onChange={(e) => setRatingCity(e.target.value)}
                      placeholder="Москва, СПб, Екатеринбург..."
                      className="h-8 text-xs"
                      maxLength={80}
                    />
                  </div>
                )}

                {ratingType === "manual" && (
                  <div className="space-y-1.5">
                    <Label className="text-sm">Список позиций (по строкам)</Label>
                    <Textarea
                      value={ratingManual}
                      onChange={(e) => setRatingManual(e.target.value)}
                      placeholder={"Формат: Название | URL | цена | рейтинг\nПример:\nРВД Сервис | https://rvd-service.ru | 5 000-20 000 руб | 4.8\nГидравлик-М | https://hydraulic-m.ru | | 4.6"}
                      rows={6}
                      className="text-xs font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Обязательно только название. Остальные поля - через "|". От 5 до 10 строк.
                    </p>
                  </div>
                )}

                <Label className="text-sm flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5" /> Закрепить клиента на 1-м месте (опционально)
                </Label>
                <Input
                  value={pinnedCompany}
                  onChange={(e) => setPinnedCompany(e.target.value)}
                  placeholder="Например: РВД Сервис"
                  className="h-8 text-xs"
                  maxLength={120}
                />
                <p className="text-[10px] text-muted-foreground">
                  Если указать имя бренда/клиента - он встанет на позицию 01 в нумерованном списке и в карточках. У него всё равно будут указаны 1-2 реальных минуса в «Потенциальные зоны роста» - иначе текст станет рекламой и упадёт в качестве.
                </p>
              </div>
            )}

            {(() => {
              const needSource = format === "case" || format === "review";
              const sourceOk = !needSource || caseSource.trim().length >= 5;
              const researchDone = !!research;
              const personaOk = authorPersona !== "freeform" || personaTouched;
              const factsOk = verifiedFacts.trim().length >= 20 || !!caseSource.trim();
              const mismatchBlock = !!research?.format_mismatch && !allowMismatch;
              const checks: Array<{ ok: boolean; label: string }> = [
                { ok: researchDone, label: "Анализ темы выполнен" },
                { ok: sourceOk, label: needSource ? `Источник ${format === "case" ? "кейса" : "обзора"} указан` : "Источник не требуется" },
                { ok: factsOk, label: "Проверенные факты или источник" },
                { ok: personaOk, label: "Persona выбрана" },
                { ok: !mismatchBlock, label: mismatchBlock ? "Формат не совпадает с топом выдачи" : "Формат соответствует выдаче" },
              ];
              const readyCount = checks.filter((c) => c.ok).length;
              const total = checks.length;
              const color = readyCount === total
                ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
                : readyCount >= total - 1
                  ? "text-amber-400 border-amber-500/40 bg-amber-500/10"
                  : "text-rose-400 border-rose-500/40 bg-rose-500/10";
              return (
                <>
                  <div className={`rounded-md border px-3 py-2 text-[11px] space-y-1 ${color}`}>
                    <div className="font-medium">VC-готовность: {readyCount}/{total}</div>
                    <ul className="space-y-0.5">
                      {checks.map((c, i) => (
                        <li key={i} className="flex items-center gap-1.5">
                          <span className="opacity-80">{c.ok ? "✓" : "✗"}</span>
                          <span className={c.ok ? "opacity-90" : ""}>{c.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {mismatchBlock ? (
                    <div className="space-y-2">
                      <Button
                        onClick={() => setFormat(research!.recommended_format)}
                        className="w-full" size="lg"
                      >
                        Сменить формат на «{research!.recommended_format}»
                      </Button>
                      <Button
                        onClick={() => setAllowMismatch(true)}
                        variant="outline" className="w-full" size="sm"
                      >
                        Сгенерировать всё равно
                      </Button>
                    </div>
                  ) : (
                    <Button
                      onClick={handleGenerate}
                      disabled={loading || !sourceOk}
                      className="w-full" size="lg"
                    >
                      {loading ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Пишу материал...</>
                      ) : (
                        <><Sparkles className="h-4 w-4 mr-2" /> Сгенерировать</>
                      )}
                    </Button>
                  )}
                </>
              );
            })()}
            <p className="text-[10px] text-muted-foreground text-center">
              Занимает 30-90 секунд.
            </p>
          </CardContent>
        </Card>

        {/* Result */}
        {(result || loading) && (
        <div className="space-y-4">
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
                  {result.seo?.target_query && (
                    <div className="rounded-md bg-primary/10 border border-primary/20 px-2.5 py-1.5 text-xs">
                      <span className="text-muted-foreground">SEO-цель: </span>
                      <span className="font-mono">{result.seo.target_query}</span>
                    </div>
                  )}
                  {result.links_report && (result.links_report.injected.length + result.links_report.appended.length > 0) && (
                    <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 text-xs space-y-1">
                      <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                        <Link2 className="h-3 w-3" /> Клиентские ссылки вставлены
                      </div>
                      {result.links_report.injected.length > 0 && (
                        <div className="text-muted-foreground">В текст: {result.links_report.injected.join(", ")}</div>
                      )}
                      {result.links_report.appended.length > 0 && (
                        <div className="text-amber-400">В блок «Полезное по теме»: {result.links_report.appended.join(", ")}</div>
                      )}
                    </div>
                  )}
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

              {/* Google SERP preview */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Search className="h-4 w-4" /> Превью в Google
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border border-border bg-background p-3 space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="inline-block h-4 w-4 rounded-full bg-emerald-500/20 border border-emerald-500/40" />
                      <span>vc.ru</span>
                      <span>›</span>
                      <span className="truncate">{(result.meta.title || "статья").toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").slice(0, 50)}</span>
                    </div>
                    <div className="text-[17px] leading-snug text-[#1a0dab] dark:text-[#8ab4f8] font-normal line-clamp-2">
                      {result.meta.title.length > 60 ? result.meta.title.slice(0, 57) + "..." : result.meta.title}
                    </div>
                    <div className="text-[12px] text-muted-foreground line-clamp-2">
                      {result.meta.subtitle.length > 160 ? result.meta.subtitle.slice(0, 157) + "..." : result.meta.subtitle}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                    <span className={result.meta.title.length > 60 ? "text-amber-400" : "text-emerald-400"}>
                      Title: {result.meta.title.length}/60
                    </span>
                    <span>•</span>
                    <span className={result.meta.subtitle.length > 160 ? "text-amber-400" : "text-emerald-400"}>
                      Description: {result.meta.subtitle.length}/160
                    </span>
                    {result.seo?.target_query && (
                      <>
                        <span>•</span>
                        <span className={result.meta.title.toLowerCase().includes(result.seo.target_query.toLowerCase().slice(0, 20)) ? "text-emerald-400" : "text-rose-400"}>
                          {result.meta.title.toLowerCase().includes(result.seo.target_query.toLowerCase().slice(0, 20)) ? "Запрос в title" : "Запрос НЕ в title"}
                        </span>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Checklist */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>Чек-лист соответствия vc.ru</span>
                    {result.checklist.some((c) => !c.ok) && (
                      <Button size="sm" variant="outline" disabled={fixing} onClick={runAutoFix}>
                        {fixing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wrench className="h-3 w-3 mr-1" />}
                        Автоисправление
                      </Button>
                    )}
                  </CardTitle>
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

              {/* Risk / Fact-Check Report */}
              {(result.risk_report || factCheckOn) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        {result.risk_report?.level === "high" ? (
                          <ShieldAlert className="h-4 w-4 text-rose-400" />
                        ) : result.risk_report?.level === "medium" ? (
                          <AlertTriangle className="h-4 w-4 text-amber-400" />
                        ) : (
                          <ShieldCheck className="h-4 w-4 text-emerald-400" />
                        )}
                        Fact-Check Guard
                        {result.risk_report && (
                          <Badge
                            variant="outline"
                            className={
                              result.risk_report.level === "high"
                                ? "border-rose-500/40 text-rose-300"
                                : result.risk_report.level === "medium"
                                  ? "border-amber-500/40 text-amber-300"
                                  : "border-emerald-500/40 text-emerald-300"
                            }
                          >
                            {result.risk_report.unverified}/{result.risk_report.total} непроверенных
                          </Badge>
                        )}
                      </span>
                      <Button size="sm" variant="outline" disabled={rechecking} onClick={rerunFactCheck}>
                        {rechecking ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
                        Перепроверить
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!result.risk_report && (
                      <p className="text-xs text-muted-foreground">
                        Нажми «Перепроверить» - модель найдёт все конкретные цифры/цены/показатели в тексте и пометит риск-моменты.
                      </p>
                    )}
                    {result.risk_report && (
                      <div className="space-y-2.5">
                        <p className={`text-xs ${
                          result.risk_report.level === "high" ? "text-rose-300"
                          : result.risk_report.level === "medium" ? "text-amber-300"
                          : "text-emerald-300"
                        }`}>
                          {result.risk_report.summary}
                        </p>
                        {result.risk_report.unverified > 0 && (
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="default" disabled={defaking} onClick={runDefake}>
                              {defaking ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wrench className="h-3 w-3 mr-1" />}
                              Убрать выдуманные числа
                            </Button>
                            <Button size="sm" variant="outline" disabled={webChecking} onClick={runWebFactCheck}>
                              {webChecking ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Search className="h-3 w-3 mr-1" />}
                              Проверить в Google
                            </Button>
                          </div>
                        )}
                        {!verifiedFacts.trim() && result.risk_report.unverified > 0 && (
                          <div className="text-[11px] rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1.5 text-amber-200">
                            Совет: заполни «Проверенные факты» слева своими реальными цифрами и нажми «Сгенерировать» снова или «Автоисправление» - модель уберёт выдуманные числа.
                          </div>
                        )}
                        {result.risk_report.claims.length > 0 && (
                          <ul className="space-y-1.5">
                            {result.risk_report.claims.map((c, i) => (
                              <li
                                key={i}
                                className={`flex items-start gap-2 text-xs rounded p-2 ${
                                  c.verified ? "bg-emerald-500/10" : "bg-rose-500/10"
                                }`}
                              >
                                {c.verified
                                  ? <Check className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                                  : <AlertTriangle className="h-3.5 w-3.5 text-rose-400 mt-0.5 shrink-0" />}
                                <div className="min-w-0">
                                  <div className="font-mono text-[11px] truncate">{c.text}</div>
                                  <div className="text-muted-foreground text-[10px]">
                                    <Badge variant="outline" className="h-3.5 px-1 text-[9px] mr-1">{c.kind}</Badge>
                                    {c.note}
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                        {webResults && webResults.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                            <div className="text-[11px] text-muted-foreground">Результаты проверки в Google:</div>
                            {webResults.map((w, i) => (
                              <div
                                key={i}
                                className={`rounded p-2 text-xs ${
                                  w.status === "confirmed" ? "bg-emerald-500/10"
                                  : w.status === "contradicted" ? "bg-rose-500/10"
                                  : "bg-muted/40"
                                }`}
                              >
                                <div className="flex items-center gap-1.5 mb-1">
                                  <Badge
                                    variant="outline"
                                    className={
                                      w.status === "confirmed" ? "border-emerald-500/40 text-emerald-300"
                                      : w.status === "contradicted" ? "border-rose-500/40 text-rose-300"
                                      : "border-muted-foreground/40 text-muted-foreground"
                                    }
                                  >
                                    {w.status === "confirmed" ? "подтверждено"
                                      : w.status === "contradicted" ? "опровергнуто"
                                      : "не найдено"}
                                  </Badge>
                                  <span className="font-mono text-[11px] truncate">{w.text}</span>
                                </div>
                                {w.why && <div className="text-[10px] text-muted-foreground mb-1">{w.why}</div>}
                                {Array.isArray(w.evidence) && w.evidence.length > 0 && (
                                  <ul className="space-y-0.5">
                                    {w.evidence.slice(0, 2).map((e, j) => (
                                      <li key={j} className="text-[10px] truncate">
                                        <a href={e.link} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                          {e.title || e.link}
                                        </a>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Competitive SERP */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2"><Search className="h-4 w-4" /> Топ выдачи по запросу</span>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
                        <Switch checked={serpOnlyVc} onCheckedChange={setSerpOnlyVc} /> только vc.ru
                      </label>
                      <Button size="sm" variant="outline" onClick={loadSerpTop} disabled={serpLoading}>
                        {serpLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Search className="h-3 w-3 mr-1" />}
                        Показать
                      </Button>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!serpTop && !serpLoading && (
                    <p className="text-xs text-muted-foreground">
                      Подгрузим топ-10 Google по {serpOnlyVc ? "vc.ru" : "всему вебу"} - чтобы увидеть конкурентов и подсмотреть углы подачи.
                    </p>
                  )}
                  {serpTop && serpTop.length === 0 && (
                    <p className="text-xs text-muted-foreground">Пусто. Поменяйте запрос или снимите фильтр «только vc.ru».</p>
                  )}
                  {serpTop && serpTop.length > 0 && (
                    <div className="space-y-2">
                      {serpTop.map((r) => (
                        <a
                          key={r.position + r.link}
                          href={r.link}
                          target="_blank"
                          rel="noreferrer"
                          className="block rounded-md border border-border p-2 hover:bg-muted/40 transition-colors"
                        >
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <Badge variant="outline" className="h-4 px-1.5 text-[9px]">#{r.position}</Badge>
                            <span className="truncate">{r.link}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </div>
                          <div className="text-sm font-medium text-foreground mt-0.5 line-clamp-2">{r.title}</div>
                          <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{r.snippet}</div>
                        </a>
                      ))}
                      {serpPaa.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <div className="text-[11px] text-muted-foreground mb-1.5">Люди также спрашивают:</div>
                          <ul className="space-y-1">
                            {serpPaa.map((q) => (
                              <li key={q} className="text-xs">- {q}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Markdown */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>Текст материала (markdown)</span>
                    <div className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                      <span>{result.stats?.chars ?? 0} знаков</span>
                      <Button size="sm" variant="outline" onClick={runHumanize} disabled={humanizing}>
                        {humanizing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
                        Humanize
                      </Button>
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
        )}
      </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}