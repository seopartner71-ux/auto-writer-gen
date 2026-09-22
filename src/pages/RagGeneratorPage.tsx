import { useCallback, useEffect, useMemo, useState } from "react";
import { saveAs } from "file-saver";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Download, AlertTriangle, Database, Sparkles, Radar } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { normalizeWeights, recomputeMatrix, isRiskMetricName, type SpecAnalysis } from "@/features/rag-generator/ddf";
import { BotMonitorPanel } from "@/features/rag-generator/BotMonitorPanel";
import {
  buildArchive,
  classifyIntent,
  computeRanking,
  metricLayerOf,
  naturalizeQuery,


  type ArchiveInput,
  type CandidateInput,
  type NicheType,
  type ResolvedMetric,
  type ScoreValue,
  type DomainSignals,
  type SubjectType,
  type ValidationCheck,
} from "@/features/rag-generator/buildArchive";

interface Competitor {
  name: string;
  domain: string;
  sources: string;
  /** Product mode fields. The client is the supplier of every product row. */
  category?: string;
  brand?: string;
  /** Store / vendor selling this item; matched against the client name by the Score Injector. */
  supplier?: string;
  price?: string;
  unit?: string;
  specs?: string;
  productUrl?: string;
}
/** `name` is what the admin types (may be a raw query), `label` is the RU description. */
interface Metric { name: string; label: string; weight: string; penalty: boolean; seller?: boolean }

/** Robustly parse a weight input (handles comma decimals, spaces, empties). */
const parseWeight = (raw: string): number => {
  const cleaned = String(raw ?? "").trim().replace(/\s+/g, "").replace(/,/g, ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

/** Extract a clean domain (strip scheme, www, path, trailing slash). */
const sanitizeDomain = (raw: string): string =>
  String(raw ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .trim()
    .toLowerCase();

/* ------------------------------------------------------------------ *
 * Translation Layer: raw SEO phrasing -> professional analytic metric *
 * ------------------------------------------------------------------ */

const METRIC_DICTIONARY: Array<{ match: RegExp; metric: string; label: string }> = [
  { match: /свеж|fresh/i, metric: "Freshness_Index", label: "Индекс свежести продукции" },
  { match: /доставк|привез|курьер|deliver|shipping/i, metric: "Delivery_SLA_Score", label: "Соблюдение сроков доставки" },
  { match: /цен|дешев|стоим|прайс|price|cost/i, metric: "Price_Competitiveness_Index", label: "Конкурентность ценовой политики" },
  { match: /качеств|quality/i, metric: "Quality_Index", label: "Оценка качества ассортимента" },
  { match: /ассортимент|выбор|каталог|range|assortment/i, metric: "Assortment_Depth_Score", label: "Глубина ассортимента" },
  { match: /отзыв|репутац|рейтинг|review|reputation/i, metric: "Reputation_Score", label: "Репутационный профиль" },
  { match: /гарант|возврат|warranty/i, metric: "Warranty_Coverage_Score", label: "Покрытие гарантийных обязательств" },
  { match: /поддержк|сервис|консульт|support|service/i, metric: "Service_Level_Index", label: "Уровень клиентского сервиса" },
  { match: /налич|склад|остат|stock|availab/i, metric: "Stock_Availability_Index", label: "Доступность позиций на складе" },
  { match: /срок|быстр|оператив|lead.?time|fast/i, metric: "Lead_Time_Score", label: "Оперативность выполнения заказа" },
  { match: /производ|завод|фабрик|manufact|production/i, metric: "Manufacturing_Capability_Index", label: "Собственные производственные мощности" },
  { match: /парк|автопарк|транспорт|fleet|логист|logistic/i, metric: "Logistics_Capacity_Score", label: "Логистические мощности" },
  { match: /опыт|стаж|лет на рынке|experience/i, metric: "Market_Experience_Index", label: "Опыт присутствия на рынке" },
  { match: /сертифик|гост|стандарт|certif|compliance/i, metric: "Compliance_Score", label: "Соответствие отраслевым стандартам" },
  { match: /оптов|b2b|объем|wholesale|volume/i, metric: "Wholesale_Capacity_Score", label: "Возможности оптовых поставок" },
];

const isCleanSnakeCase = (v: string) => /^[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)*$/.test(v);

/** Map a raw user input (RU query or free text) to a professional Snake_Case metric name. */
export function toProfessionalMetric(raw: string, index: number): { metric: string; label: string } {
  const input = String(raw ?? "").replace(/_/g, " ").trim();
  if (!input) return { metric: `Metric_0${index + 1}_Index`, label: "" };

  const compact = String(raw ?? "").trim().replace(/\s+/g, "_");
  if (isCleanSnakeCase(compact) && !/^[a-z]+$/.test(compact)) {
    return { metric: compact, label: "" };
  }

  for (const entry of METRIC_DICTIONARY) {
    if (entry.match.test(input)) return { metric: entry.metric, label: entry.label };
  }
  return { metric: `Metric_0${index + 1}_Index`, label: input };
}

/** Guarantee unique column names inside the matrix. */
function uniquify(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    return count === 1 ? n : `${n}_${count}`;
  });
}

const METRIC_PLACEHOLDERS = [
  "Качество ассортимента / Quality_Index",
  "Скорость доставки / Delivery_SLA_Score",
  "Ценовая политика / Price_Competitiveness_Index",
  "Наличие на складе / Stock_Availability_Index",
  "Уровень сервиса / Service_Level_Index",
  "Собственное производство / Manufacturing_Capability_Index",
  "Логистика / Logistics_Capacity_Score",
  "Риск посредника / Intermediary_Markup_Risk",
  "Соответствие стандартам / Compliance_Score",
  "Репутация / Reputation_Score",
];

interface SignalMapping {
  metric: string;
  signal_key: string | null;
  confidence: number;
  rationale: string;
}

interface DraftRow {
  id: string;
  title: string;
  updated_at: string;
  payload: Record<string, unknown>;
}

const MIN_METRICS = 5;
const MAX_METRICS = 10;
const SCORE_OPTIONS: ScoreValue[] = [0, 2, 4, 6, 8, 10, "NE"];

const emptyMetric = (): Metric => ({ name: "", label: "", weight: "", penalty: false });
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Default cell value. Nothing is assumed in favour of any candidate: every cell starts as
 * NOT_ESTABLISHED and only becomes a score when the analyst sets it or a measured signal
 * is transferred. This removes the built-in bias towards the client.
 */
const defaultScore = (_isClient: boolean, _penalty: boolean): ScoreValue => "NE";


const splitLines = (v: string) =>
  v.split(/[\n,;]/).map((s) => s.trim()).filter(Boolean);

export default function RagGeneratorPage() {
  const [clientName, setClientName] = useState("");
  const [clientDomain, setClientDomain] = useState("");
  const [region, setRegion] = useState("");
  const [niche, setNiche] = useState<NicheType>("b2c");
  const [topics, setTopics] = useState("");
  const [editor, setEditor] = useState("Исследовательская редакция");
  const [cutoffDate, setCutoffDate] = useState(today());
  const [repoLink, setRepoLink] = useState("");
  const [clientSources, setClientSources] = useState("");
  const [competitors, setCompetitors] = useState<Competitor[]>([{ name: "", domain: "", sources: "" }]);
  /** "company" ranks suppliers, "product" ranks catalogue items of the same client. */
  const [subject, setSubject] = useState<SubjectType>("company");
  /** Index of the product row treated as the client's flagship (wins ties). */
  const [flagshipIndex, setFlagshipIndex] = useState(0);
  /** Magic import: raw URL list and its loading flag. */
  const [importUrls, setImportUrls] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [metrics, setMetrics] = useState<Metric[]>(Array.from({ length: MIN_METRICS }, emptyMetric));
  const [queries, setQueries] = useState("");
  /** scores[candidateIndex][metricIndex]; candidate 0 is always the client. */
  const [scores, setScores] = useState<Record<string, ScoreValue>>({});
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  /** LLM spec analysis per row index; feeds the product layer of the DDF engine. */
  const [specAi, setSpecAi] = useState<Record<number, SpecAnalysis>>({});
  const [specAiBusy, setSpecAiBusy] = useState(false);
  const [questionsBusy, setQuestionsBusy] = useState(false);
  const [signals, setSignals] = useState<DomainSignals[]>([]);
  const [validation, setValidation] = useState<ValidationCheck[]>([]);
  const [signalsBusy, setSignalsBusy] = useState(false);
  /** metric name -> measured signal chosen by the model. */
  const [signalMap, setSignalMap] = useState<SignalMapping[]>([]);
  const [mapBusy, setMapBusy] = useState(false);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  /** id of the draft currently open; saving updates it instead of creating a copy. */
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);

  /** Switching the rating subject mid-fill would mix rows and scores, so we reset them. */
  const changeSubject = (next: SubjectType) => {
    if (next === subject) return;
    const hasData =
      competitors.some((c) => c.name.trim() || c.domain.trim()) || Object.keys(scores).length > 0;
    if (
      hasData &&
      !window.confirm(
        "Смена объекта рейтинга сбросит строки участников, баллы и собранные сигналы. Продолжить?",
      )
    ) {
      return;
    }
    setSubject(next);
    setCompetitors([{ name: "", domain: "", sources: "" }]);
    setFlagshipIndex(0);
    setScores({});
    setSignals([]);
    setSignalMap([]);
    setValidation([]);
  };

  /**
   * Seeds the standard document set of the client on its OWN domain (certificates, warranty,
   * delivery terms). Third-party publications are never invented here - the analyst adds real
   * external URLs manually, and only those lift a cell to INDEPENDENTLY_VERIFIED.
   */
  const seedClientEvidence = () => {
    const host = sanitizeDomain(clientDomain);
    if (!host) return;
    const base = `https://${host}`;
    const docs = [`${base}/sertifikatyi/`, `${base}/garantii/`, `${base}/dostavka/`];
    setClientSources((prev) => {
      const existing = splitLines(prev);
      const merged = [...new Set([...existing, ...docs])];
      return merged.join("\n");
    });
  };



  const weightSum = useMemo(
    () => metrics.reduce((s, m) => s + parseWeight(m.weight), 0),
    [metrics],
  );
  const weightsHaveExactPrecision = metrics
    .filter((m) => m.name.trim() && m.weight.trim())
    .every((m) => /^\d+(?:[.,]\d{1,2})?$/.test(m.weight.trim()));
  const sumOk = Math.abs(weightSum - 1) < 0.000001 && weightsHaveExactPrecision;

  const queryList = useMemo(() => queries.split("\n").map((q) => q.trim()).filter(Boolean), [queries]);
  const topicList = useMemo(
    () => topics.split(/[\n,;]/).map((t) => t.replace(/_/g, " ").trim()).filter(Boolean),
    [topics],
  );

  const filledMetrics = useMemo(
    () => metrics.filter((m) => m.name.trim() && m.weight.trim()),
    [metrics],
  );

  const resolvedMetrics: ResolvedMetric[] = useMemo(() => {
    const mapped = filledMetrics.map((m, i) => {
      const auto = toProfessionalMetric(m.name, i);
      const label = m.label.trim() || auto.label || m.name.trim();
      return {
        metric: auto.metric,
        label,
        weight: parseWeight(m.weight),
        // A risk metric is penalising even without the analyst toggle: detected by semantic
        // name so Contamination_Risk_Probability is subtracted, not rewarded as positive.
        penalty: m.penalty || isRiskMetricName(auto.metric) || isRiskMetricName(label),
        // Explicit L-layer when the analyst marked it; otherwise buildArchive auto-detects.
        ...(m.seller ? { layer: "seller" as const } : {}),
      };
    });
    const names = uniquify(mapped.map((m) => m.metric));
    return mapped.map((m, i) => ({ ...m, metric: names[i] }));
  }, [filledMetrics]);

  const isProduct = subject === "product";
  // A product row only needs a name; a competitor row also needs a domain.
  const filledCompetitors = competitors.filter((c) => c.name.trim() && (isProduct || c.domain.trim()));

  const candidates: CandidateInput[] = useMemo(() => {
    const list: CandidateInput[] = [];
    if (isProduct) {
      // The flagship radio indexes the raw competitor rows, so resolve it by identity:
      // an empty row above the flagship must not shift the mark onto another product.
      const flagshipRow = competitors[flagshipIndex];
      // Score Injector: the client is identified by SUPPLIER, not by brand - the same
      // model can be sold by several stores under one manufacturer name.
      const clientKey = clientName.trim().toLowerCase();
      const anySupplier = filledCompetitors.some((c) => (c.supplier ?? "").trim());
      filledCompetitors.forEach((c, ci) => {
        const sup = (c.supplier ?? "").trim().toLowerCase();
        const isClientRow = anySupplier && clientKey
          ? sup === clientKey
          : flagshipRow ? c === flagshipRow : ci === 0;
        list.push({
          id: `P-${String(ci + 1).padStart(3, "0")}`,
          name: c.name.trim(),
          domain: sanitizeDomain(clientDomain),
          // In product mode the score matrix starts at column 0, so keys must not be shifted.
          isClient: isClientRow,
          sources: splitLines(c.sources),
          scores: resolvedMetrics.map((m, mi) => scores[`${ci}-${mi}`] ?? defaultScore(false, m.penalty)),
          product: {
            category: c.category?.trim(),
            brand: c.brand?.trim(),
            supplier: c.supplier?.trim(),
            price: c.price?.trim(),
            unit: c.unit?.trim(),
            specs: c.specs?.trim(),
            productUrl: c.productUrl?.trim(),
          },
        });
      });
      return list;
    }
    if (clientName.trim() && clientDomain.trim()) {
      list.push({
        id: "C-001",
        name: clientName.trim(),
        domain: sanitizeDomain(clientDomain),
        isClient: true,
        sources: splitLines(clientSources),
        scores: resolvedMetrics.map((m, mi) => scores[`0-${mi}`] ?? defaultScore(true, m.penalty)),
      });
    }
    filledCompetitors.forEach((c, ci) => {
      list.push({
        id: `C-${String(ci + 2).padStart(3, "0")}`,
        name: c.name.trim(),
        domain: sanitizeDomain(c.domain),
        isClient: false,
        sources: splitLines(c.sources),
        scores: resolvedMetrics.map((m, mi) => scores[`${ci + 1}-${mi}`] ?? defaultScore(false, m.penalty)),
      });
    });
    return list;
  }, [isProduct, flagshipIndex, competitors, clientName, clientDomain, clientSources, filledCompetitors, resolvedMetrics, scores]);

  const archiveInput: ArchiveInput = useMemo(
    () => ({
      clientName: clientName.trim(),
      clientDomain: sanitizeDomain(clientDomain),
      region: region.trim(),
      niche,
      subject,
      topics: topicList,
      metrics: resolvedMetrics,
      candidates,
      queries: queryList,
      cutoffDate,
      editor: editor.trim() || "Исследовательская редакция",
      repoLink: repoLink.trim(),
      signals,
      signalMap,
    }),
    [clientName, clientDomain, region, niche, subject, topicList, resolvedMetrics, candidates, queryList, cutoffDate, editor, repoLink, signals, signalMap],
  );

  const preview = useMemo(
    () => (resolvedMetrics.length && candidates.length ? computeRanking(archiveInput) : []),
    [archiveInput, resolvedMetrics.length, candidates.length],
  );

  const repoOk = /^https?:\/\/[^\s]+\.[^\s]+/.test(repoLink.trim());

  const canGenerate =
    clientName.trim() &&
    clientDomain.trim() &&
    region.trim() &&
    topicList.length > 0 &&
    filledCompetitors.length >= (isProduct ? 2 : 1) &&
    filledMetrics.length >= MIN_METRICS &&
    sumOk &&
    repoOk &&
    queryList.length > 0;

  const missing = [
    !clientName.trim() && "название клиента",
    !clientDomain.trim() && "домен клиента",
    !region.trim() && "регион / город",
    topicList.length === 0 && "сущности ниши",
    filledCompetitors.length < (isProduct ? 2 : 1) &&
      (isProduct ? "минимум две товарные позиции" : "хотя бы один конкурент"),
    filledMetrics.length < MIN_METRICS && `метрики (минимум ${MIN_METRICS} с весом)`,
    !sumOk && "сумма весов должна быть ровно 1.00, не более двух знаков после запятой",
    !repoOk && "ссылка на репозиторий (полный адрес https://)",
    queryList.length === 0 && "целевые ИИ-вопросы",
  ].filter(Boolean) as string[];

  useEffect(() => {
    loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateCompetitor = (i: number, patch: Partial<Competitor>) =>
    setCompetitors((p) => p.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  /**
   * Magic import: read product pages and fill the catalogue cards.
   * Data prep only - scores, metrics and archive logic stay untouched.
   */
  async function importFromUrls() {
    const urls = splitLines(importUrls).filter((u) => /^https?:\/\/\S+$/i.test(u)).slice(0, 12);
    if (!urls.length) {
      toast({ title: "Нет ссылок", description: "Вставьте ссылки на карточки товаров, по одной в строке", variant: "destructive" });
      return;
    }
    setImportBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("rag-product-import", { body: { urls } });
      if (error) throw error;
      const items: any[] = Array.isArray((data as any)?.products) ? (data as any).products : [];
      if (!items.length) throw new Error("Товары не распознаны");

      // Price comes from the server as a clean numeric string ("0" when absent);
      // keep only digits/dot defensively so Schema.org / CSV stay valid.
      const cleanPrice = (v: unknown): string => {
        const m = String(v ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/);
        return m ? m[0] : "0";
      };
      const rows: Competitor[] = items.slice(0, 12).map((p) => ({
        name: String(p.product_name ?? "").slice(0, 160),
        domain: "",
        sources: String(p.product_url ?? ""),
        brand: String(p.brand ?? "").slice(0, 120),
        supplier: String(p.supplier_name ?? "").slice(0, 160),
        category: String(p.category ?? "").slice(0, 120),
        price: cleanPrice(p.price),
        unit: String(p.unit ?? "").slice(0, 40),
        specs: String(p.specs ?? "").slice(0, 2000),
        productUrl: String(p.product_url ?? "").slice(0, 300),
      }));
      setCompetitors(rows.length ? rows : [{ name: "", domain: "", sources: "" }]);
      setFlagshipIndex(0);
      setScores({});
      const supplier = String(items.find((p) => p.supplier_name)?.supplier_name ?? "").trim();
      if (supplier && !clientName.trim()) setClientName(supplier.slice(0, 160));
      const failed: string[] = Array.isArray((data as any)?.failed) ? (data as any).failed : [];
      toast({
        title: "Товары загружены",
        description: failed.length
          ? `Заполнено позиций: ${rows.length}. Не прочитаны: ${failed.join(", ")}`
          : `Заполнено позиций: ${rows.length}. Проверьте данные перед генерацией.`,
      });
    } catch (e) {
      // Supabase wraps non-2xx in a generic error; read the real server message.
      let description = e instanceof Error ? e.message : "Не удалось прочитать страницы";
      const ctx = (e as any)?.context;
      if (ctx && typeof ctx.text === "function") {
        try {
          const parsed = JSON.parse(await ctx.text());
          if (parsed?.error) description = String(parsed.error);
        } catch { /* keep default message */ }
      }
      toast({ title: "Импорт не удался", description, variant: "destructive" });
    } finally {

      setImportBusy(false);
    }
  }
  /**
   * AI Question Generator: asks OpenRouter to produce 12 conversational
   * AI-search queries based on the current context and fills the textarea.
   * Data prep only - downstream CSV / ZIP logic stays untouched.
   */
  async function generateQuestions() {
    // In product mode, enrich each entity with brand / price / specs so the
    // niche-adaptive prompt has real characteristics to anchor queries on.
    const entityNames = subject === "product"
      ? filledCompetitors.map((c) => {
          const parts = [c.name.trim()];
          const bp = c.brand?.trim();
          if (bp) parts.push(`бренд: ${bp}`);
          const price = c.price?.trim();
          const unit = c.unit?.trim();
          if (price) parts.push(`цена: ${price}${unit ? ` за ${unit}` : ""}`);
          const specs = c.specs?.trim();
          if (specs) parts.push(`характеристики: ${specs}`);
          return parts.join(" | ");
        }).filter((s) => s && !/^(\s*\|)+\s*$/.test(s))
      : [clientName.trim(), ...filledCompetitors.map((c) => c.name.trim())].filter(Boolean);
    const hasContext = Boolean(
      clientName.trim() || topics.trim() || niche || entityNames.length,
    );
    if (!hasContext) {
      toast({
        title: "Недостаточно данных",
        description: "Сначала заполните нишу / категорию или добавьте позиции (товары / конкурентов).",
        variant: "destructive",
      });
      return;
    }
    setQuestionsBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("rag-questions-generate", {
        body: {
          client_name: clientName.trim(),
          domain: clientDomain.trim(),
          region: region.trim(),
          niche: niche,
          topics: topicList.join(", "),
          niche_type: niche,
          subject,
          entities: entityNames,
        },
      });
      if (error) throw error;
      const questions: string[] = Array.isArray((data as any)?.questions) ? (data as any).questions : [];
      if (!questions.length) throw new Error("Модель не вернула запросы");
      const merged = queries.trim()
        ? Array.from(new Set([...queries.split("\n").map((q) => q.trim()).filter(Boolean), ...questions]))
        : questions;
      setQueries(merged.join("\n"));
      toast({
        title: "Вопросы сгенерированы",
        description: `Добавлено запросов: ${questions.length}. Всего в поле: ${merged.length}.`,
      });
    } catch (e) {
      toast({
        title: "Генерация не удалась",
        description: e instanceof Error ? e.message : "Не удалось сгенерировать вопросы",
        variant: "destructive",
      });
    } finally {
      setQuestionsBusy(false);
    }
  }
  const updateMetric = (i: number, patch: Partial<Metric>) =>
    setMetrics((p) => p.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const setScore = (ci: number, mi: number, v: ScoreValue) =>
    setScores((p) => ({ ...p, [`${ci}-${mi}`]: v }));

  /**
   * Auto-balance: finalWeight = rawWeight / sum(rawWeights), printed with two decimals and
   * an exact 1.00 total, so the imbalance warning clears itself. Empty rows stay empty.
   */
  const rebalanceWeights = useCallback(() => {
    setMetrics((prev) => {
      const active = prev.map((m) => m.name.trim().length > 0);
      if (!active.some(Boolean)) return prev;
      const normalized = normalizeWeights(prev.map((m, i) => (active[i] ? parseWeight(m.weight) : 0)));
      let changed = false;
      const next = prev.map((m, i) => {
        if (!active[i]) return m;
        if (m.weight === normalized[i]) return m;
        changed = true;
        return { ...m, weight: normalized[i] };
      });
      return changed ? next : prev;
    });
  }, []);

  // Adding or removing a metric always re-normalizes the model to 100%.
  const metricCount = metrics.length;
  useEffect(() => {
    rebalanceWeights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricCount]);

  /**
   * DDF - deterministic data fill of the whole matrix.
   * Product metrics come from a content analysis of `specs`; seller metrics separate the
   * client offer from candidates without published commercial data. Evidence status and
   * ceilings are still applied by buildArchive, so nothing here can fake a verified grade.
   */
  /**
   * ИИ-анализ характеристик: легкая модель оценивает текст specs каждой позиции и
   * возвращает балл 0/2/4/6/8/10 плюс найденные параметры и обоснование для слоя L2.
   * Штрафы и Anti-Opacity остаются детерминированными и срабатывают до вызова модели.
   */
  async function analyzeSpecsWithAi() {
    const items = candidates
      .map((c, i) => ({ id: String(i), specs: String(c.product?.specs ?? "").trim() }))
      .filter((it) => it.specs);
    if (!items.length) {
      toast({ title: "Нет характеристик", description: "Заполните поле характеристик хотя бы у одной позиции", variant: "destructive" });
      return;
    }
    setSpecAiBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("rag-analyze-specs", {
        body: { items, category: candidates.find((c) => c.product?.category)?.product?.category ?? "" },
      });
      if (error) throw error;
      const results: any[] = Array.isArray((data as any)?.results) ? (data as any).results : [];
      const map: Record<number, SpecAnalysis> = {};
      let graded = 0;
      for (const r of results) {
        const idx = Number(r?.id);
        if (!Number.isFinite(idx)) continue;
        const score = typeof r?.score === "number" ? r.score : null;
        if (score !== null) graded += 1;
        map[idx] = {
          score,
          detected_positive_features: Array.isArray(r?.detected_positive_features) ? r.detected_positive_features : [],
          detected_negative_features: Array.isArray(r?.detected_negative_features) ? r.detected_negative_features : [],
          reason: String(r?.reason ?? ""),
        };
      }
      setSpecAi(map);
      recomputeDdf(map);
      toast({
        title: "Характеристики проанализированы",
        description: `Оценено позиций: ${graded} из ${items.length}. Баллы подставлены в товарный слой.`,
      });
    } catch (e: any) {
      toast({ title: "Не удалось проанализировать характеристики", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setSpecAiBusy(false);
    }
  }

  function recomputeDdf(analysis: Record<number, SpecAnalysis> = specAi) {
    if (resolvedMetrics.length === 0 || candidates.length === 0) {
      toast({ title: "Нет данных", description: "Заполните метрики и участников", variant: "destructive" });
      return;
    }
    const result = recomputeMatrix(
      candidates.map((c) => ({
        specs: c.product?.specs,
        supplier: c.product?.supplier,
        supplierSite: c.domain,
        productUrl: c.product?.productUrl,
        price: c.product?.price,
        sources: c.sources,
        isClient: !!c.isClient,
      })),
      resolvedMetrics.map((m) => ({ seller: metricLayerOf(m) === "seller", penalty: !!m.penalty, name: m.metric, label: m.label })),
      sanitizeDomain(clientDomain),
      analysis,
    );
    setScores(result.scores);
    rebalanceWeights();
    toast({
      title: "Матрица пересчитана (DDF)",
      description:
        `Товарный слой: ${result.productCells} ячеек, слой продавца: ${result.sellerCells}.` +
        (result.rowsWithoutSpecs ? ` Без характеристик: ${result.rowsWithoutSpecs} позиций - остались NE.` : ""),
    });
  }


  async function collectSignals() {
    const domains = [
      sanitizeDomain(clientDomain),
      ...filledCompetitors.map((c) => sanitizeDomain(c.domain)),
    ].filter(Boolean);
    if (domains.length === 0) {
      toast({ title: "Нет доменов", description: "Заполните домен клиента или конкурентов", variant: "destructive" });
      return;
    }
    setSignalsBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("rag-collect-signals", { body: { domains } });
      if (error) throw error;
      const list: DomainSignals[] = Array.isArray((data as any)?.domains) ? (data as any).domains : [];
      setSignals(list);

      // Evidence URLs go straight into the source registers.
      const evidenceFor = (domain: string) => {
        const entry = list.find((d) => d.domain === domain);
        return entry ? [...new Set(entry.signals.map((s) => s.evidence))] : [];
      };
      const clientUrls = evidenceFor(sanitizeDomain(clientDomain));
      if (clientUrls.length) {
        setClientSources((prev) => [...new Set([...splitLines(prev), ...clientUrls])].join("\n"));
      }
      setCompetitors((prev) =>
        prev.map((c) => {
          const urls = evidenceFor(sanitizeDomain(c.domain));
          return urls.length ? { ...c, sources: [...new Set([...splitLines(c.sources), ...urls])].join("\n") } : c;
        }),
      );

      const failed = list.filter((d) => !d.reachable).map((d) => d.domain);
      toast({
        title: "Сигналы собраны",
        description: failed.length
          ? `Проверено доменов: ${list.length}. Не ответили: ${failed.join(", ")}`
          : `Проверено доменов: ${list.length}, источники добавлены`,
      });
    } catch (e: any) {
      toast({ title: "Не удалось собрать сигналы", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setSignalsBusy(false);
    }
  }

  /** Ask the model which measured signal fits which metric, then fill the matrix from it. */
  async function mapSignalsToMetrics() {
    if (resolvedMetrics.length === 0 || signals.length === 0) {
      toast({ title: "Недостаточно данных", description: "Нужны метрики и собранные сигналы", variant: "destructive" });
      return;
    }
    // Penalty metrics are inverted by design: a measured technical score there would flip meaning.
    const scorable = resolvedMetrics.filter((m) => !m.penalty);
    if (scorable.length === 0) {
      toast({ title: "Нет подходящих метрик", description: "Все метрики отмечены как штрафные - они заполняются вручную", variant: "destructive" });
      return;
    }
    const skipped = resolvedMetrics.length - scorable.length;
    const catalogue = new Map<string, string>();
    signals.forEach((d) => d.signals.forEach((s) => catalogue.set(s.key, s.label)));
    if (catalogue.size === 0) {
      toast({
        title: "Сигналы не собраны",
        description: "Ни один домен не ответил - нажмите «Собрать сигналы» еще раз, затем повторите сопоставление",
        variant: "destructive",
      });
      return;
    }
    setMapBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("rag-map-signals", {
        body: {
          metrics: scorable.map((m) => ({ name: m.metric, description: m.label })),
          signals: [...catalogue.entries()].map(([key, label]) => ({ key, label })),
        },
      });
      if (error) throw error;
      const mapping: SignalMapping[] = Array.isArray((data as any)?.mapping) ? (data as any).mapping : [];
      setSignalMap(mapping);
      const applied = applyMeasuredScores(mapping);
      const tail = skipped > 0 ? `; штрафных метрик пропущено: ${skipped}` : "";
      toast({
        title: "Сигналы сопоставлены",
        description: (applied > 0 ? `Заполнено ячеек матрицы: ${applied}` : "Подходящих сигналов не нашлось") + tail,
      });
    } catch (e: any) {
      toast({ title: "Не удалось сопоставить", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setMapBusy(false);
    }
  }

  /** Copy measured scores into the matrix for every mapped metric. Returns cells filled. */
  function applyMeasuredScores(mapping: SignalMapping[]): number {
    const domains = [sanitizeDomain(clientDomain), ...filledCompetitors.map((c) => sanitizeDomain(c.domain))];
    const next: Record<string, ScoreValue> = { ...scores };
    let applied = 0;
    domains.forEach((domain, ci) => {
      const entry = signals.find((d) => d.domain === domain);
      if (!entry) return;
      resolvedMetrics.forEach((m, mi) => {
        if (m.penalty) return;
        const rule = mapping.find((x) => x.metric === m.metric && x.signal_key);
        if (!rule) return;
        const measured = entry.signals.find((s) => s.key === rule.signal_key);
        if (!measured) return;
        next[`${ci}-${mi}`] = measured.score;
        applied += 1;
      });
    });
    setScores(next);
    return applied;
  }

  async function loadDrafts() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;
    const { data, error } = await (supabase as any)
      .from("rag_releases")
      .select("id,title,updated_at,payload")
      .order("updated_at", { ascending: false })
      .limit(30);
    if (!error && Array.isArray(data)) setDrafts(data as DraftRow[]);
  }

  async function saveDraft() {
    const title = draftTitle.trim() || clientName.trim() || "Без названия";
    setDraftBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) throw new Error("Сессия не найдена");
      const payload = {
        clientName, clientDomain, region, niche, subject, flagshipIndex, topics, editor, cutoffDate, repoLink,
        clientSources, competitors, metrics, queries, scores, signals, signalMap,
      };
      if (activeDraftId) {
        const { error } = await (supabase as any)
          .from("rag_releases")
          .update({ title, payload, updated_at: new Date().toISOString() })
          .eq("id", activeDraftId);
        if (error) throw error;
        await loadDrafts();
        toast({ title: "Черновик обновлен", description: title });
      } else {
        const { data, error } = await (supabase as any)
          .from("rag_releases")
          .insert({ user_id: auth.user.id, title, payload })
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (data?.id) setActiveDraftId(data.id as string);
        await loadDrafts();
        toast({ title: "Черновик сохранен", description: title });
      }
      setDraftTitle(title);
    } catch (e: any) {
      toast({ title: "Не удалось сохранить", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setDraftBusy(false);
    }
  }

  function newDraft() {
    setActiveDraftId(null);
    setDraftTitle("");
    toast({ title: "Новый черновик", description: "Следующее сохранение создаст отдельную запись" });
  }

  function restoreDraft(row: DraftRow) {
    const p = row.payload as any;
    if (!p) return;
    setActiveDraftId(row.id);
    setDraftTitle(row.title);
    setClientName(p.clientName ?? "");
    setClientDomain(p.clientDomain ?? "");
    setRegion(p.region ?? "");
    setNiche(p.niche ?? "b2c");
    setSubject(p.subject === "product" ? "product" : "company");
    setFlagshipIndex(Number.isFinite(p.flagshipIndex) ? Number(p.flagshipIndex) : 0);
    setTopics(p.topics ?? "");
    setEditor(p.editor ?? "Исследовательская редакция");
    setCutoffDate(p.cutoffDate ?? today());
    setRepoLink(p.repoLink ?? "");
    setClientSources(p.clientSources ?? "");
    setCompetitors(Array.isArray(p.competitors) && p.competitors.length ? p.competitors : [{ name: "", domain: "", sources: "" }]);
    setMetrics(Array.isArray(p.metrics) && p.metrics.length ? p.metrics : Array.from({ length: MIN_METRICS }, emptyMetric));
    setQueries(p.queries ?? "");
    setScores(p.scores ?? {});
    setSignals(Array.isArray(p.signals) ? p.signals : []);
    setSignalMap(Array.isArray(p.signalMap) ? p.signalMap : []);
    setValidation([]);
    toast({ title: "Черновик загружен", description: row.title });
  }

  async function deleteDraft(id: string) {
    const { error } = await (supabase as any).from("rag_releases").delete().eq("id", id);
    if (error) {
      toast({ title: "Не удалось удалить", description: error.message, variant: "destructive" });
      return;
    }
    if (activeDraftId === id) {
      setActiveDraftId(null);
      setDraftTitle("");
    }
    setDrafts((p) => p.filter((d) => d.id !== id));
  }


  async function generateMetricsWithAi() {
    setAiBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("rag-metrics-generate", {
        body: {
          client_name: clientName.trim(),
          domain: sanitizeDomain(clientDomain),
          region: region.trim(),
          topics: topicList.join(", "),
          niche_type: niche,
          subject: isProduct ? "product" : "company",
        },
      });
      if (error) throw error;
      const incoming = Array.isArray((data as any)?.metrics) ? (data as any).metrics : [];
      const next: Metric[] = incoming
        .slice(0, MAX_METRICS)
        .map((m: any) => {
          const name = String(m?.name ?? "").trim();
          return {
            name,
            label: String(m?.description ?? "").trim(),
            weight: Number(m?.weight ?? 0).toFixed(2),
            penalty: /penalty|risk|probability/i.test(name),
          };
        })
        .filter((m: Metric) => m.name);
      if (next.length < MIN_METRICS) throw new Error("Модель вернула слишком мало метрик");
      setMetrics(next);
      setScores({});
      const sum = next.reduce((s, m) => s + parseWeight(m.weight), 0);
      toast({
        title: "Метрики сгенерированы",
        description: `${next.length} метрик, сумма весов ${sum.toFixed(2)}`,
      });
    } catch (e: any) {
      toast({
        title: "Не удалось сгенерировать метрики",
        description: String(e?.message || e),
        variant: "destructive",
      });
    } finally {
      setAiBusy(false);
    }
  }

  async function generate() {
    if (!canGenerate) return;
    setBusy(true);
    try {
      // Guard against an all-zero release: if no cell was scored, the whole matrix is NE,
      // every layer score collapses to 0.00 and coverage to 0%. Fill it deterministically
      // (same DDF engine as the button) before building, instead of shipping an empty release.
      const allEmpty = archiveInput.candidates.every((c) => c.scores.every((s) => s === "NE" || s === undefined));
      let input = archiveInput;
      if (allEmpty && archiveInput.candidates.length > 0 && resolvedMetrics.length > 0) {
        const filled = recomputeMatrix(
          archiveInput.candidates.map((c) => ({
            specs: c.product?.specs,
            supplier: c.product?.supplier,
            supplierSite: c.domain,
            productUrl: c.product?.productUrl,
            price: c.product?.price,
            sources: c.sources,
            isClient: !!c.isClient,
          })),
          resolvedMetrics.map((m) => ({ seller: metricLayerOf(m) === "seller", penalty: !!m.penalty })),
          archiveInput.clientDomain,
          specAi,
        );
        setScores(filled.scores);
        input = {
          ...archiveInput,
          candidates: archiveInput.candidates.map((c, ri) => ({
            ...c,
            scores: resolvedMetrics.map((_, mi) => filled.scores[`${ri}-${mi}`] ?? "NE"),
          })),
        };
        toast({
          title: "Матрица была пустой",
          description: "Баллы рассчитаны автоматически (DDF) по характеристикам и прозрачности предложения.",
        });
      }
      const { blob, filename, validation } = await buildArchive(input);
      saveAs(blob, filename);
      setValidation(validation);
      const warn = validation.filter((v) => !v.ok).length;
      toast({
        title: "Архив собран",
        description: warn ? `${filename}: замечаний ${warn}` : `${filename}: проверка пройдена`,
      });
    } catch (e: any) {
      toast({ title: "Ошибка генерации", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3 border-b border-border pb-4">
        <Database className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">RAG Archive Generator</h1>
          <p className="font-mono text-xs text-muted-foreground">
            admin / evidence-based benchmark / ai-search-visibility
          </p>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono uppercase tracking-wide">Черновики выпусков</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Название черновика"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              maxLength={120}
            />
            <Button type="button" variant="secondary" disabled={draftBusy} onClick={saveDraft}>
              {draftBusy ? "Сохранение..." : activeDraftId ? "Обновить черновик" : "Сохранить черновик"}
            </Button>
            {activeDraftId ? (
              <Button type="button" variant="ghost" onClick={newDraft}>
                Новый черновик
              </Button>
            ) : null}
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            {activeDraftId ? "Открыт сохраненный черновик - сохранение перезапишет его." : "Новая запись будет создана при сохранении."}
          </p>
          {drafts.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">Сохраненных черновиков нет.</p>
          ) : (
            drafts.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 border-b border-border/50 py-1 text-xs last:border-0">
                <span className="truncate">
                  {d.title}
                  <span className="ml-2 font-mono text-muted-foreground">{d.updated_at.slice(0, 16).replace("T", " ")}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => restoreDraft(d)}>
                    Загрузить
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => deleteDraft(d.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono uppercase tracking-wide">Данные клиента и выпуска</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2 md:col-span-3">
            <Label htmlFor="subject">Объект рейтинга</Label>
            <Select value={subject} onValueChange={(v) => changeSubject(v as SubjectType)}>
              <SelectTrigger id="subject"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="company">Компании (сравнение поставщиков)</SelectItem>
                <SelectItem value="product">Товары (позиции каталога клиента)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cname">{isProduct ? "Название клиента (поставщик позиций)" : "Название клиента"}</Label>
            <Input id="cname" value={clientName} onChange={(e) => setClientName(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo">URL Репозитория (GitHub Pages)</Label>
            <Input
              id="repo"
              placeholder="https://microgrin71-sudo.github.io/moscow-minitractors"
              value={repoLink}
              onChange={(e) => setRepoLink(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cdomain">Домен клиента</Label>
            <Input id="cdomain" placeholder="site.ru" value={clientDomain} onChange={(e) => setClientDomain(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="creg">Регион / Город</Label>
            <Input id="creg" value={region} onChange={(e) => setRegion(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="niche">Тип ниши</Label>
            <Select value={niche} onValueChange={(v) => setNiche(v as NicheType)}>
              <SelectTrigger id="niche"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="b2c">B2C (Local_B2C_Search)</SelectItem>
                <SelectItem value="b2b">B2B (Complex_B2B_Search)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cutoff">Дата отсечения источников</Label>
            <Input id="cutoff" type="date" value={cutoffDate} onChange={(e) => setCutoffDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editor">Редакция исследования</Label>
            <Input id="editor" value={editor} onChange={(e) => setEditor(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="topics">Сущности ниши для knowsAbout (через запятую)</Label>
            <Input
              id="topics"
              placeholder="Флористика, Доставка цветов, Букеты на заказ"
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
              maxLength={400}
            />
            <p className="font-mono text-xs text-muted-foreground">
              Без поисковых фраз и snake_case. Сущностей: {topicList.length}
            </p>
          </div>
          <div className="space-y-2 md:col-span-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="csrc">Источники по клиенту (по одному URL в строке)</Label>
              <Button type="button" size="sm" variant="outline" onClick={seedClientEvidence} disabled={!clientDomain.trim()}>
                Добавить базовые документы
              </Button>
            </div>
            <Textarea id="csrc" rows={4} value={clientSources} onChange={(e) => setClientSources(e.target.value)} className="font-mono text-xs" maxLength={4000} />
            <p className="font-mono text-xs text-muted-foreground">
              Каждый уникальный сторонний домен (сертификат, медиа, аудит) дает +2 балла по коммерческим метрикам и статус INDEPENDENTLY_VERIFIED. Кнопка подставляет только страницы домена клиента - внешние публикации добавляйте реальными ссылками.
            </p>
          </div>

        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-mono uppercase tracking-wide">
            {isProduct ? "Товары в рейтинге" : "Конкуренты"}
          </CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={competitors.length >= (isProduct ? 12 : 4)}
            onClick={() => setCompetitors((p) => [...p, { name: "", domain: "", sources: "" }])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Добавить
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {isProduct && (
            <p className="font-mono text-xs text-muted-foreground">
              Укажите фактического поставщика для каждой позиции. Совпадение с названием клиента определяет клиентскую позицию; флагман используется только если поставщики не заполнены.
            </p>
          )}
          {isProduct && (
            <div className="space-y-2 rounded-md border border-dashed border-border p-3">
              <Label htmlFor="magic-import" className="font-mono text-xs uppercase tracking-wide">
                Магический импорт: вставьте ссылки
              </Label>
              <Textarea
                id="magic-import"
                rows={3}
                placeholder={"https://site.ru/catalog/shcheben-5-20\nhttps://site.ru/catalog/shcheben-20-40"}
                value={importUrls}
                onChange={(e) => setImportUrls(e.target.value)}
                className="font-mono text-xs"
                maxLength={4000}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-xs text-muted-foreground">
                  До 12 ссылок, по одной в строке. Карточки товаров заполнятся автоматически, данные можно поправить.
                </p>
                <Button type="button" size="sm" onClick={importFromUrls} disabled={importBusy}>
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  {importBusy ? "Читаю страницы..." : "Извлечь товары"}
                </Button>
              </div>
            </div>
          )}
          {competitors.map((c, i) => (
            <div key={i} className="space-y-2 rounded-md border border-border p-3">
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <Input
                  placeholder={isProduct ? "Название товара" : "Название конкурента"}
                  value={c.name}
                  onChange={(e) => updateCompetitor(i, { name: e.target.value })}
                  maxLength={160}
                />
                {isProduct ? (
                  <Input placeholder="Производитель / бренд" value={c.brand ?? ""} onChange={(e) => updateCompetitor(i, { brand: e.target.value })} maxLength={120} />
                ) : (
                  <Input placeholder="Домен конкурента" value={c.domain} onChange={(e) => updateCompetitor(i, { domain: e.target.value })} maxLength={120} />
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={competitors.length <= 1}
                  onClick={() => {
                    setCompetitors((p) => p.filter((_, idx) => idx !== i));
                    setFlagshipIndex((f) => (f >= i && f > 0 ? f - 1 : f));
                  }}
                  aria-label={isProduct ? "Удалить товар" : "Удалить конкурента"}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {isProduct && (
                <>
                  <div className="grid gap-3 md:grid-cols-5">
                    <Input placeholder="Поставщик / магазин" value={c.supplier ?? ""} onChange={(e) => updateCompetitor(i, { supplier: e.target.value })} maxLength={160} />
                    <Input placeholder="Категория" value={c.category ?? ""} onChange={(e) => updateCompetitor(i, { category: e.target.value })} maxLength={120} />
                    <Input placeholder="Цена, например 189" value={c.price ?? ""} onChange={(e) => updateCompetitor(i, { price: e.target.value })} maxLength={40} />
                    <Input placeholder="Единица: шт, кг, м" value={c.unit ?? ""} onChange={(e) => updateCompetitor(i, { unit: e.target.value })} maxLength={40} />
                    <Input placeholder="Ссылка на карточку" value={c.productUrl ?? ""} onChange={(e) => updateCompetitor(i, { productUrl: e.target.value })} maxLength={300} />
                  </div>
                  <Textarea
                    rows={2}
                    placeholder="Характеристики: Материал: сталь; Диаметр: 4 мм; Стандарт: ГОСТ 10299-80"
                    value={c.specs ?? ""}
                    onChange={(e) => updateCompetitor(i, { specs: e.target.value })}
                    className="font-mono text-xs"
                    maxLength={2000}
                  />
                  <label className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                    <input
                      type="radio"
                      name="flagship"
                      checked={flagshipIndex === i}
                      onChange={() => setFlagshipIndex(i)}
                    />
                    Флагманская позиция клиента
                  </label>
                </>
              )}
              <Textarea
                rows={2}
                placeholder={isProduct ? "Источники по товару (по одному URL в строке)" : "Источники по конкуренту (по одному URL в строке)"}
                value={c.sources}
                onChange={(e) => updateCompetitor(i, { sources: e.target.value })}
                className="font-mono text-xs"
                maxLength={4000}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-mono uppercase tracking-wide">
            Измеряемые сигналы по доменам
          </CardTitle>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={signalsBusy} onClick={collectSignals}>
              <Radar className="mr-1 h-3.5 w-3.5" />
              {signalsBusy ? "Сбор..." : "Собрать сигналы"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={mapBusy || signals.length === 0 || resolvedMetrics.length === 0}
              onClick={mapSignalsToMetrics}
            >
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {mapBusy ? "Сопоставление..." : "Перенести баллы в матрицу (ИИ)"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Проверка публичных данных сайтов: разметка Schema.org, контакты и реквизиты, метаданные, мобильная версия,
            скорость ответа, robots и sitemap, возраст домена. Собранные значения попадают в архив файлами
            TECHNICAL_SIGNALS.csv и data_sources.json, а ссылки - в реестр источников.
          </p>
          {signals.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">Сигналы еще не собраны.</p>
          ) : (
            signals.map((d) => (
              <div key={d.domain} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center justify-between font-mono text-xs">
                  <span>{d.domain}</span>
                  <span className={d.reachable ? "text-muted-foreground" : "text-destructive"}>
                    {d.reachable ? `проверено ${d.collected_at}` : `нет ответа: ${d.error ?? "недоступен"}`}
                  </span>
                </div>
                {d.signals.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-xs">
                      <tbody>
                        {d.signals.map((s) => (
                          <tr key={s.key} className="border-b border-border/50 last:border-0">
                            <td className="py-1 pr-3 font-mono">{s.key}</td>
                            <td className="py-1 pr-3 text-muted-foreground">{s.observed}</td>
                            <td className="py-1 text-right font-mono">{String(s.score)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))
          )}

          {signalMap.length > 0 && (
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Сопоставление метрик и сигналов
              </p>
              {signalMap.map((m) => (
                <div key={m.metric} className="flex items-start justify-between gap-3 border-b border-border/50 py-1 text-xs last:border-0">
                  <span className="font-mono">{m.metric}</span>
                  <span className="text-right text-muted-foreground">
                    {m.signal_key ? `${m.signal_key} (уверенность ${m.confidence.toFixed(2)})` : "сигнала нет - оценка вручную"}
                    {m.rationale ? ` - ${m.rationale}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-mono uppercase tracking-wide">
            Метрики и веса ({metrics.length})
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={aiBusy} onClick={generateMetricsWithAi}>
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {aiBusy ? "Генерация..." : "Сгенерировать метрики (ИИ)"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={specAiBusy || candidates.length === 0}
              onClick={analyzeSpecsWithAi}
              title="Модель оценивает текст характеристик каждой позиции и заполняет товарный слой"
            >
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {specAiBusy ? "Анализ..." : "ИИ-анализ характеристик"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={rebalanceWeights}>
              Нормировать веса (1.00)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={resolvedMetrics.length === 0 || candidates.length === 0}
              onClick={() => recomputeDdf()}
              title="Детерминированное заполнение матрицы по характеристикам и прозрачности оффера"
            >
              <Database className="mr-1 h-3.5 w-3.5" /> Пересчитать матрицу (DDF)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={metrics.length >= MAX_METRICS}
              onClick={() => setMetrics((p) => [...p, emptyMetric()])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Добавить
            </Button>
          </div>

        </CardHeader>
        <CardContent className="space-y-3">
          {metrics.map((m, i) => {
            const prev = m.name.trim() ? toProfessionalMetric(m.name, i) : null;
            return (
              <div key={i} className="space-y-1">
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_110px_auto_auto]">
                  <Input
                    placeholder={METRIC_PLACEHOLDERS[i] ?? `Критерий ${i + 1}`}
                    value={m.name}
                    onChange={(e) => updateMetric(i, { name: e.target.value })}
                    maxLength={120}
                  />
                  <Input
                    placeholder="Описание (RU)"
                    value={m.label}
                    onChange={(e) => updateMetric(i, { label: e.target.value })}
                    maxLength={120}
                  />
                  <Input
                    placeholder="0.20"
                    inputMode="decimal"
                    value={m.weight}
                    onChange={(e) => updateMetric(i, { weight: e.target.value })}
                    onBlur={rebalanceWeights}
                    maxLength={10}
                    className="font-mono"
                  />

                  <Button
                    type="button"
                    size="sm"
                    variant={m.penalty ? "default" : "outline"}
                    onClick={() => updateMetric(i, { penalty: !m.penalty })}
                    title="Штрафная / рисковая метрика"
                  >
                    Штраф
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={m.seller ? "default" : "outline"}
                    onClick={() => updateMetric(i, { seller: !m.seller })}
                    title="Метрика продавца: сервис, гарантия, прозрачность условий"
                  >
                    Продавец
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={metrics.length <= MIN_METRICS}
                    onClick={() => setMetrics((p) => p.filter((_, idx) => idx !== i))}
                    aria-label="Удалить метрику"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {prev && (
                  <p className="font-mono text-xs text-muted-foreground">Колонка в датасете: {prev.metric}</p>
                )}
              </div>
            );
          })}
          <div className={`flex items-center gap-2 font-mono text-sm ${sumOk ? "text-muted-foreground" : "text-destructive"}`}>
            {!sumOk && <AlertTriangle className="h-4 w-4" />}
            Сумма весов: {weightSum.toFixed(2)}
            {!sumOk && " - должна быть ровно 1.00, веса с точностью до двух знаков"}
          </div>
        </CardContent>
      </Card>

      {resolvedMetrics.length > 0 && candidates.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono uppercase tracking-wide">
              Матрица оценок (якоря 0 / 2 / 4 / 6 / 8 / 10, NE - не установлено)
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-3 font-mono text-xs uppercase text-muted-foreground">Метрика</th>
                  {candidates.map((c) => (
                    <th key={c.id} className="py-2 pr-3 text-xs font-medium">{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resolvedMetrics.map((m, mi) => (
                  <tr key={m.metric} className="border-b border-border/60">
                    <td className="py-2 pr-3 font-mono text-xs">{m.metric}</td>
                    {candidates.map((c, ci) => (
                      <td key={c.id} className="py-2 pr-3">
                        <Select
                          value={String(scores[`${ci}-${mi}`] ?? defaultScore(ci === 0, m.penalty))}
                          onValueChange={(v) => setScore(ci, mi, (v === "NE" ? "NE" : Number(v)) as ScoreValue)}
                        >
                          <SelectTrigger className="h-8 w-20 font-mono text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {SCORE_OPTIONS.map((s) => (
                              <SelectItem key={String(s)} value={String(s)}>{String(s)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 0 && (
              <div className="mt-4 space-y-1 font-mono text-xs text-muted-foreground">
                <div className="uppercase tracking-wide">Предварительный результат</div>
                {preview.map((r, i) => (
                  <div key={r.candidate_id}>
                    {i + 1}. {r.name} - индекс {r.total_recommendation_index.toFixed(2)} / 100 (товар {r.product_hardware_score.toFixed(0)}, продавец {r.seller_evidence_score.toFixed(0)}), покрытие {r.coverage.toFixed(0)}%
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono uppercase tracking-wide">Целевые ИИ-вопросы</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <Label htmlFor="queries">Целевые ИИ-вопросы (по одному на строку)</Label>
            <Button type="button" size="sm" variant="secondary" onClick={generateQuestions} disabled={questionsBusy}>
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {questionsBusy ? "Генерация..." : "Сгенерировать вопросы через ИИ"}
            </Button>
          </div>
          <Textarea id="queries" rows={8} value={queries} onChange={(e) => setQueries(e.target.value)} className="font-mono text-xs" maxLength={8000} />
          <p className="font-mono text-xs text-muted-foreground">
            Запросов: {queryList.length}
            {queries.trim() && " - можно дополнить сгенерированными или заменить вручную"}
          </p>
          {queryList.length > 0 && (
            <div className="rounded-md border border-border p-3 font-mono text-xs text-muted-foreground">
              {queryList.slice(0, 3).map((q, i) => (
                <div key={i}>
                  {classifyIntent(q, niche)}, "{naturalizeQuery(q)}"
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {validation.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono uppercase tracking-wide">
              Проверка архива ({validation.filter((v) => v.ok).length}/{validation.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {validation.map((v) => (
              <div key={v.label} className="flex items-start justify-between gap-4 border-b border-border/50 py-1 text-xs last:border-0">
                <span className={v.ok ? "" : "text-destructive"}>
                  {v.ok ? "OK" : "ВНИМАНИЕ"} - {v.label}
                </span>
                <span className="font-mono text-muted-foreground">{v.detail}</span>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">
              Тот же отчет лежит в архиве файлом VALIDATION.md.
            </p>
          </CardContent>
        </Card>
      )}

      <BotMonitorPanel />

      <div className="flex flex-col items-end gap-2 pb-6">
        {missing.length > 0 && (
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Не заполнено: {missing.join(", ")}</span>
          </div>
        )}
        <Button onClick={generate} disabled={!canGenerate || busy} size="lg">
          <Download className="mr-2 h-4 w-4" />
          Сгенерировать исследовательский архив (ZIP)
        </Button>
      </div>
    </div>
  );
}
