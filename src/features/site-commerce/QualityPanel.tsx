import { useCallback, useMemo, useState } from "react";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Play, Save, RefreshCw, Wand2 } from "lucide-react";

interface FactorResult {
  key: string; name: string; group: string;
  level: "required" | "recommended" | "optional"; weight: number; passed: boolean;
}

interface QualityRow {
  entity_id: string;
  entity_type?: string;
  title: string | null;
  url_path: string;
  page_type: string;
  intent: string | null;
  demand_score: number;
  quality_status: "PASS" | "REVIEW" | "FAIL";
  commercial_score: number;
  seo_quality_score: number;
  quality_errors: string[];
  quality_warnings: string[];
  missing_recommended: string[];
  quality_factors?: FactorResult[];
  // P13
  content_words?: number;
  content_min_words?: number;
  semantic_coverage?: number;
  content_sufficiency?: number;
  content_severity?: "critical_content" | "warning_content" | "acceptable";
  content_thin?: boolean;
  content_low_semantic?: boolean;
  content_intent_ok?: boolean;
  content_problems?: { code: string; severity: string; detail?: string }[];
  content_focus?: string[];
  missing_terms?: string[];
}

interface Summary {
  total: number; pass: number; review: number; fail: number;
  avg_commercial_score: number;
  by_type: Record<string, { total: number; pass: number; review: number; fail: number; avg_score: number }>;
  top_missing_required: [string, number][];
  top_problems?: { code: string; count: number }[];
  content?: {
    thin: number; low_semantic: number; intent_mismatch: number; no_content: number;
    critical: number; warning: number; acceptable: number;
    avg_sufficiency: number; avg_coverage: number;
  };
}

const STATUS_COLOR: Record<string, string> = {
  PASS: "text-green-500",
  REVIEW: "text-orange-500",
  FAIL: "text-destructive",
};

const PAGE_TYPES = ["all", "product", "category", "service", "informational", "local", "hub", "article"];

type ContentFilter = "all" | "thin" | "low_semantic" | "intent" | "critical";
type RegenMode = "only_fail" | "only_thin" | "only_low_semantic" | "only_missing_required";

const PROBLEM_LABEL: Record<string, { ru: string; en: string }> = {
  no_content: { ru: "Нет контента", en: "No content" },
  thin_for_type: { ru: "Мало текста для типа", en: "Thin for page type" },
  low_semantic_coverage: { ru: "Низкое смысловое покрытие", en: "Low semantic coverage" },
  few_semantic_terms: { ru: "Мало смысловых терминов", en: "Few semantic terms" },
  missing_entities: { ru: "Нет сущностей", en: "Missing entities" },
  missing_faq: { ru: "Нет FAQ", en: "Missing FAQ" },
  intent_mismatch: { ru: "Интент не раскрыт", en: "Intent mismatch" },
  template_content: { ru: "Шаблонные формулировки", en: "Template phrasing" },
  duplicated_blocks: { ru: "Дубли блоков", en: "Duplicated blocks" },
  missing_required_factor: { ru: "Нет обязательного фактора", en: "Missing required factor" },
};

export function QualityPanel({ projectId, ru }: { projectId: string; ru: boolean }) {
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<QualityRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState<"all" | "PASS" | "REVIEW" | "FAIL">("all");
  const [type, setType] = useState("all");
  const [minScore, setMinScore] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [contentFilter, setContentFilter] = useState<ContentFilter>("all");
  const [regen, setRegen] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const run = useCallback(async (persist: boolean) => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("page-quality-engine", {
        body: { project_id: projectId, dry_run: !persist },
      });
      if (error) throw error;
      const res = data as { summary: Summary; rows?: QualityRow[] };
      setSummary(res.summary);
      if (res.rows) setRows(res.rows);
      toast.success(ru
        ? `Проверено ${res.summary.total}: PASS ${res.summary.pass}, REVIEW ${res.summary.review}, FAIL ${res.summary.fail}`
        : `Checked ${res.summary.total}: PASS ${res.summary.pass}, REVIEW ${res.summary.review}, FAIL ${res.summary.fail}`);
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "quality check failed"));
    } finally {
      setRunning(false);
    }
  }, [projectId, ru]);

  const filtered = useMemo(() => rows.filter((r) =>
    (status === "all" || r.quality_status === status)
    && (type === "all" || r.page_type === type)
    && (contentFilter === "all"
      || (contentFilter === "thin" && r.content_thin)
      || (contentFilter === "low_semantic" && r.content_low_semantic)
      || (contentFilter === "intent" && r.content_intent_ok === false)
      || (contentFilter === "critical" && r.content_severity === "critical_content"))
    && r.commercial_score >= minScore), [rows, status, type, minScore, contentFilter]);

  const worst = useMemo(
    () => [...rows].sort((a, b) => (a.content_sufficiency ?? 0) - (b.content_sufficiency ?? 0)).slice(0, 10),
    [rows],
  );

  const regenerate = useCallback(async (opts: { mode?: RegenMode; entityIds?: string[]; worstLimit?: number }) => {
    setRegen(opts.mode || "entity");
    try {
      const { data, error } = await supabase.functions.invoke("generate-commerce-content", {
        body: {
          project_id: projectId,
          use_registry: true,
          mode: opts.mode,
          entity_ids: opts.entityIds,
          worst_limit: opts.worstLimit,
          limit: opts.worstLimit || 20,
        },
      });
      if (error) throw error;
      const res = data as { generated?: number; failed?: number; avg_delta?: number; improvements?: { name: string; delta: number }[] };
      setLastRun(ru
        ? `Переписано ${res.generated ?? 0}, ошибок ${res.failed ?? 0}, средний прирост качества ${res.avg_delta ?? 0}`
        : `Rewritten ${res.generated ?? 0}, failed ${res.failed ?? 0}, avg quality delta ${res.avg_delta ?? 0}`);
      toast.success(ru ? "Регенерация завершена" : "Regeneration finished");
      await run(false);
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "regeneration failed"));
    } finally {
      setRegen(null);
    }
  }, [projectId, ru, run]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" />Page Quality
        </Badge>
        <Button size="sm" onClick={() => run(false)} disabled={running} className="ml-auto">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Play className="h-3.5 w-3.5 mr-2" />}
          {ru ? "Проверить качество" : "Check quality"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => run(true)} disabled={running}>
          <Save className="h-3.5 w-3.5 mr-2" />{ru ? "Сохранить в реестр" : "Persist to registry"}
        </Button>
      </div>

      {summary && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
          {[
            { label: ru ? "Всего" : "Total", value: summary.total, cls: "" },
            { label: "PASS", value: summary.pass, cls: STATUS_COLOR.PASS },
            { label: "REVIEW", value: summary.review, cls: STATUS_COLOR.REVIEW },
            { label: "FAIL", value: summary.fail, cls: STATUS_COLOR.FAIL },
            { label: ru ? "Средний score" : "Avg score", value: summary.avg_commercial_score, cls: "" },
          ].map((t) => (
            <div key={t.label} className="rounded border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">{t.label}</div>
              <div className={`text-xl font-semibold mt-1 tabular-nums ${t.cls}`}>{t.value}</div>
            </div>
          ))}
        </div>
      )}

      {summary && (
        <div className="rounded border border-border/60 p-3 text-xs space-y-1">
          <div className="text-muted-foreground mb-1">{ru ? "Чаще всего отсутствует" : "Most missing required"}</div>
          <div className="flex flex-wrap gap-1.5">
            {summary.top_missing_required.map(([k, n]) => (
              <Badge key={k} variant="secondary" className="font-mono">{k} - {n}</Badge>
            ))}
          </div>
        </div>
      )}

      {summary?.content && (
        <div className="rounded border border-border/60 p-3 text-xs space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground mr-1">{ru ? "Контент" : "Content"}</span>
            <Badge variant="destructive">{ru ? "критично" : "critical"} {summary.content.critical}</Badge>
            <Badge variant="secondary">thin {summary.content.thin}</Badge>
            <Badge variant="secondary">low semantic {summary.content.low_semantic}</Badge>
            <Badge variant="outline">intent {summary.content.intent_mismatch}</Badge>
            <Badge variant="outline">{ru ? "достаточность" : "sufficiency"} {summary.content.avg_sufficiency}</Badge>
            <Badge variant="outline">{ru ? "покрытие" : "coverage"} {summary.content.avg_coverage}%</Badge>
          </div>

          {!!summary.top_problems?.length && (
            <div>
              <div className="text-muted-foreground mb-1">Top problems</div>
              <div className="flex flex-wrap gap-1.5">
                {summary.top_problems.slice(0, 8).map((p) => (
                  <Badge key={p.code} variant="secondary">
                    {(PROBLEM_LABEL[p.code]?.[ru ? "ru" : "en"]) || p.code} - {p.count}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {([
              { mode: "only_fail" as RegenMode, label: ru ? "Переписать FAIL" : "Fix FAIL" },
              { mode: "only_thin" as RegenMode, label: ru ? "Переписать тонкие" : "Fix thin" },
              { mode: "only_low_semantic" as RegenMode, label: ru ? "Добрать смыслы" : "Fix semantics" },
              { mode: "only_missing_required" as RegenMode, label: ru ? "Закрыть обязательные" : "Fix required" },
            ]).map((b) => (
              <Button key={b.mode} size="sm" variant="outline" disabled={!!regen}
                onClick={() => regenerate({ mode: b.mode, worstLimit: 10 })}>
                {regen === b.mode ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Wand2 className="h-3.5 w-3.5 mr-2" />}
                {b.label}
              </Button>
            ))}
          </div>
          {lastRun && <div className="text-muted-foreground">{lastRun}</div>}

          {worst.length > 0 && (
            <div className="space-y-1">
              <div className="text-muted-foreground">{ru ? "10 худших страниц" : "10 worst pages"}</div>
              {worst.map((r) => (
                <div key={`w-${r.entity_id}`} className="flex items-center gap-2">
                  <span className="truncate flex-1">{r.title || r.url_path}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {r.content_words ?? 0}/{r.content_min_words ?? 0} {ru ? "слов" : "words"}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{r.semantic_coverage ?? 0}%</span>
                  <span className="tabular-nums">{r.content_sufficiency ?? 0}</span>
                  <Button size="sm" variant="ghost" disabled={!!regen}
                    onClick={() => regenerate({ entityIds: [r.entity_id] })}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {(["all", "FAIL", "REVIEW", "PASS"] as const).map((st) => (
              <Button key={st} size="sm" variant={status === st ? "default" : "outline"}
                onClick={() => setStatus(st)}>{st}</Button>
            ))}
            <select className="h-8 rounded border border-border bg-background px-2"
              value={type} onChange={(e) => setType(e.target.value)}>
              {PAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="h-8 rounded border border-border bg-background px-2"
              value={contentFilter} onChange={(e) => setContentFilter(e.target.value as ContentFilter)}>
              <option value="all">{ru ? "весь контент" : "all content"}</option>
              <option value="critical">{ru ? "критичный контент" : "critical content"}</option>
              <option value="thin">thin</option>
              <option value="low_semantic">low semantic</option>
              <option value="intent">intent mismatch</option>
            </select>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">{ru ? "score от" : "score ≥"}</span>
              <Input type="number" className="h-8 w-20" value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value) || 0)} />
            </div>
          </div>

          <div className="rounded border border-border/60 overflow-auto max-h-[560px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="text-muted-foreground">
                  <th className="text-left p-2">{ru ? "Страница" : "Page"}</th>
                  <th className="text-left p-2">{ru ? "Тип" : "Type"}</th>
                  <th className="text-left p-2">Intent</th>
                  <th className="text-right p-2">Demand</th>
                  <th className="text-right p-2">Score</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">{ru ? "Нет обязательных" : "Missing required"}</th>
                  <th className="text-left p-2">Warnings</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <>
                    <tr key={r.entity_id} className="border-t border-border/40 cursor-pointer hover:bg-muted/40"
                      onClick={() => setOpen(open === r.entity_id ? null : r.entity_id)}>
                      <td className="p-2 max-w-[240px]">
                        <div className="truncate">{r.title || r.url_path}</div>
                        <div className="text-muted-foreground truncate">{r.url_path}</div>
                      </td>
                      <td className="p-2">{r.page_type}</td>
                      <td className="p-2">{r.intent}</td>
                      <td className="p-2 text-right">{r.demand_score}</td>
                      <td className="p-2 text-right tabular-nums">{r.commercial_score}</td>
                      <td className={`p-2 font-semibold ${STATUS_COLOR[r.quality_status]}`}>{r.quality_status}</td>
                      <td className="p-2 text-muted-foreground max-w-[200px] truncate">{r.quality_errors.join(", ") || "-"}</td>
                      <td className="p-2 text-muted-foreground max-w-[160px] truncate">{r.quality_warnings.join(", ") || "-"}</td>
                    </tr>
                    {open === r.entity_id && (
                      <tr key={`${r.entity_id}-d`} className="bg-muted/20">
                        <td colSpan={8} className="p-3">
                          <div className="mb-2 flex items-center gap-2">
                            <div className="h-2 w-40 rounded bg-muted overflow-hidden">
                              <div className="h-full bg-primary" style={{ width: `${r.commercial_score}%` }} />
                            </div>
                            <span className="tabular-nums">{r.commercial_score}/100</span>
                            <span className="text-muted-foreground">SEO {r.seo_quality_score}/100</span>
                          </div>
                          <div className="grid gap-1 sm:grid-cols-3">
                            <div>
                              <div className="text-muted-foreground mb-1">Required</div>
                              {(r.quality_factors || []).filter((f) => f.level === "required").map((f) => (
                                <div key={f.key} className={f.passed ? "text-green-500" : "text-destructive"}>
                                  {f.passed ? "✓" : "✗"} {f.name}
                                </div>
                              ))}
                            </div>
                            <div>
                              <div className="text-muted-foreground mb-1">Recommended</div>
                              {(r.quality_factors || []).filter((f) => f.level === "recommended").map((f) => (
                                <div key={f.key} className={f.passed ? "text-green-500" : "text-orange-500"}>
                                  {f.passed ? "✓" : "✗"} {f.name}
                                </div>
                              ))}
                            </div>
                            <div>
                              <div className="text-muted-foreground mb-1">Optional</div>
                              {(r.quality_factors || []).filter((f) => f.level === "optional").map((f) => (
                                <div key={f.key} className={f.passed ? "text-green-500" : "text-muted-foreground"}>
                                  {f.passed ? "✓" : "-"} {f.name}
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className={`mt-2 font-semibold ${STATUS_COLOR[r.quality_status]}`}>
                            Status: {r.quality_status}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!summary && (
        <p className="text-sm text-muted-foreground">
          {ru
            ? "Запустите проверку - слой качества считает, что должно быть на странице каждого типа и насколько она готова к публикации."
            : "Run the check - the quality layer scores what each page type must contain before publishing."}
        </p>
      )}
    </div>
  );
}
