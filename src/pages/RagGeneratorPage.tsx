import { useMemo, useState } from "react";
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
import {
  buildArchive,
  classifyIntent,
  computeRanking,
  naturalizeQuery,
  type ArchiveInput,
  type CandidateInput,
  type NicheType,
  type ResolvedMetric,
  type ScoreValue,
  type DomainSignals,
} from "@/features/rag-generator/buildArchive";

interface Competitor { name: string; domain: string; sources: string }
/** `name` is what the admin types (may be a raw query), `label` is the RU description. */
interface Metric { name: string; label: string; weight: string; penalty: boolean }

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

const MIN_METRICS = 5;
const MAX_METRICS = 10;
const SCORE_OPTIONS: ScoreValue[] = [0, 2, 4, 6, 8, 10, "NE"];

const emptyMetric = (): Metric => ({ name: "", label: "", weight: "", penalty: false });
const today = () => new Date().toISOString().slice(0, 10);

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
  const [metrics, setMetrics] = useState<Metric[]>(Array.from({ length: MIN_METRICS }, emptyMetric));
  const [queries, setQueries] = useState("");
  /** scores[candidateIndex][metricIndex]; candidate 0 is always the client. */
  const [scores, setScores] = useState<Record<string, ScoreValue>>({});
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [signals, setSignals] = useState<DomainSignals[]>([]);
  const [signalsBusy, setSignalsBusy] = useState(false);

  const weightSum = useMemo(
    () => metrics.reduce((s, m) => s + parseWeight(m.weight), 0),
    [metrics],
  );
  const sumOk = Math.round(weightSum * 100) === 100;

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
      return {
        metric: auto.metric,
        label: m.label.trim() || auto.label || m.name.trim(),
        weight: parseWeight(m.weight),
        penalty: m.penalty,
      };
    });
    const names = uniquify(mapped.map((m) => m.metric));
    return mapped.map((m, i) => ({ ...m, metric: names[i] }));
  }, [filledMetrics]);

  const filledCompetitors = competitors.filter((c) => c.name.trim() && c.domain.trim());

  const candidates: CandidateInput[] = useMemo(() => {
    const list: CandidateInput[] = [];
    if (clientName.trim() && clientDomain.trim()) {
      list.push({
        id: "C-001",
        name: clientName.trim(),
        domain: sanitizeDomain(clientDomain),
        isClient: true,
        sources: splitLines(clientSources),
        scores: resolvedMetrics.map((_, mi) => scores[`0-${mi}`] ?? 8),
      });
    }
    filledCompetitors.forEach((c, ci) => {
      list.push({
        id: `C-${String(ci + 2).padStart(3, "0")}`,
        name: c.name.trim(),
        domain: sanitizeDomain(c.domain),
        isClient: false,
        sources: splitLines(c.sources),
        scores: resolvedMetrics.map((_, mi) => scores[`${ci + 1}-${mi}`] ?? 4),
      });
    });
    return list;
  }, [clientName, clientDomain, clientSources, filledCompetitors, resolvedMetrics, scores]);

  const archiveInput: ArchiveInput = useMemo(
    () => ({
      clientName: clientName.trim(),
      clientDomain: sanitizeDomain(clientDomain),
      region: region.trim(),
      niche,
      topics: topicList,
      metrics: resolvedMetrics,
      candidates,
      queries: queryList,
      cutoffDate,
      editor: editor.trim() || "Исследовательская редакция",
      repoLink: repoLink.trim(),
      signals,
    }),
    [clientName, clientDomain, region, niche, topicList, resolvedMetrics, candidates, queryList, cutoffDate, editor, repoLink, signals],
  );

  const preview = useMemo(
    () => (resolvedMetrics.length && candidates.length ? computeRanking(archiveInput) : []),
    [archiveInput, resolvedMetrics.length, candidates.length],
  );

  const canGenerate =
    clientName.trim() &&
    clientDomain.trim() &&
    region.trim() &&
    topicList.length > 0 &&
    filledCompetitors.length > 0 &&
    filledMetrics.length >= MIN_METRICS &&
    sumOk &&
    queryList.length > 0;

  const missing = [
    !clientName.trim() && "название клиента",
    !clientDomain.trim() && "домен клиента",
    !region.trim() && "регион / город",
    topicList.length === 0 && "сущности ниши",
    filledCompetitors.length === 0 && "хотя бы один конкурент",
    filledMetrics.length < MIN_METRICS && `метрики (минимум ${MIN_METRICS} с весом)`,
    !sumOk && "сумма весов должна быть ровно 1.00",
    queryList.length === 0 && "целевые ИИ-вопросы",
  ].filter(Boolean) as string[];

  const updateCompetitor = (i: number, patch: Partial<Competitor>) =>
    setCompetitors((p) => p.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const updateMetric = (i: number, patch: Partial<Metric>) =>
    setMetrics((p) => p.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const setScore = (ci: number, mi: number, v: ScoreValue) =>
    setScores((p) => ({ ...p, [`${ci}-${mi}`]: v }));

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
      const { blob, filename, validation } = await buildArchive(archiveInput);
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
          <CardTitle className="text-sm font-mono uppercase tracking-wide">Данные клиента и выпуска</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="cname">Название клиента</Label>
            <Input id="cname" value={clientName} onChange={(e) => setClientName(e.target.value)} maxLength={120} />
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
          <div className="space-y-2">
            <Label htmlFor="repo">Ссылка на репозиторий</Label>
            <Input id="repo" placeholder="https://github.com/..." value={repoLink} onChange={(e) => setRepoLink(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-2 md:col-span-3">
            <Label htmlFor="csrc">Источники по клиенту (по одному URL в строке)</Label>
            <Textarea id="csrc" rows={3} value={clientSources} onChange={(e) => setClientSources(e.target.value)} className="font-mono text-xs" maxLength={4000} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-mono uppercase tracking-wide">Конкуренты</CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={competitors.length >= 4}
            onClick={() => setCompetitors((p) => [...p, { name: "", domain: "", sources: "" }])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Добавить
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {competitors.map((c, i) => (
            <div key={i} className="space-y-2 rounded-md border border-border p-3">
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <Input placeholder="Название конкурента" value={c.name} onChange={(e) => updateCompetitor(i, { name: e.target.value })} maxLength={120} />
                <Input placeholder="Домен конкурента" value={c.domain} onChange={(e) => updateCompetitor(i, { domain: e.target.value })} maxLength={120} />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={competitors.length <= 1}
                  onClick={() => setCompetitors((p) => p.filter((_, idx) => idx !== i))}
                  aria-label="Удалить конкурента"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                rows={2}
                placeholder="Источники по конкуренту (по одному URL в строке)"
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
          <Button type="button" size="sm" variant="secondary" disabled={signalsBusy} onClick={collectSignals}>
            <Radar className="mr-1 h-3.5 w-3.5" />
            {signalsBusy ? "Сбор..." : "Собрать сигналы"}
          </Button>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-mono uppercase tracking-wide">
            Метрики и веса ({metrics.length})
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={aiBusy} onClick={generateMetricsWithAi}>
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {aiBusy ? "Генерация..." : "Сгенерировать метрики (ИИ)"}
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
            {!sumOk && " - должна быть ровно 1.00"}
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
                          value={String(scores[`${ci}-${mi}`] ?? (ci === 0 ? 8 : 4))}
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
                    {i + 1}. {r.name} - {r.confirmed_weighted_points.toFixed(2)} / 100, покрытие {r.coverage.toFixed(0)}%
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
          <Label htmlFor="queries">Целевые ИИ-вопросы (по одному на строку)</Label>
          <Textarea id="queries" rows={8} value={queries} onChange={(e) => setQueries(e.target.value)} className="font-mono text-xs" maxLength={8000} />
          <p className="font-mono text-xs text-muted-foreground">Запросов: {queryList.length}</p>
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
