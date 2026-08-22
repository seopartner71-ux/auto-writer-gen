// P19 + P18.2 - Launch Readiness & Launch Automation.
//
// Read-only view over launch-readiness-engine plus two automation flows:
//   Auto Fix       - re-runs only the engines whose issues the report found,
//                    scoped to the affected registry / entity ids.
//   Prepare launch - full pipeline SEO -> Commercial -> Content -> Visual -> QA
//                    -> Launch Check.
// Nothing here changes PDE / Registry / SILO / Content / Commercial / SEO /
// Blog / Renderer / QA - it only calls their existing public actions.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, RefreshCw, Wand2, ArrowRight, Rocket, AlertTriangle, PlayCircle, Check } from "lucide-react";
import { invokeErrorMessage } from "@/shared/utils/invokeError";

type Group = "seo" | "content" | "commercial" | "visual" | "technical" | "blog" | "media";
type Verdict = "PREMIUM_READY" | "READY_WITH_WARNINGS" | "SITE_READY" | "SITE_NEEDS_FIX" | "BLOCKED";

interface ScoreRow { group: Group; score: number; passed: number; total: number }
interface Issue {
  group: Group; key: string; count: number; blocking: boolean; step: number;
  severity?: "BLOCKER" | "WARNING";
  label_ru: string; label_en: string; samples?: string[];
}
export interface LaunchReport {
  verdict: Verdict;
  overall: number;
  ready?: boolean;
  scores: ScoreRow[];
  issues: Issue[];
  affected?: { seo: string[]; commercial: string[]; content: string[]; visual: string[]; media?: string[] };
  stats: { pages: number; content_pages: number; products: number; articles: number; qa_critical: number; visual_score: number; media_score?: number; images?: number; placeholders?: number };
  site: { production_url: string | null; published_at: string | null; custom_domain: string | null; ssl_status: string | null };
}

interface StageState {
  key: string;
  label_ru: string;
  label_en: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  progress: number;
  note?: string;
}

const GROUP_RU: Record<Group, string> = {
  seo: "SEO", content: "Контент", commercial: "Коммерция", visual: "Дизайн", technical: "Техника", blog: "Блог", media: "Изображения",
};
const GROUP_EN: Record<Group, string> = {
  seo: "SEO", content: "Content", commercial: "Commercial", visual: "Visual", technical: "Technical", blog: "Blog", media: "Images",
};

const VERDICT: Record<Verdict, { ru: string; en: string; cls: string }> = {
  PREMIUM_READY: { ru: "Premium ready", en: "Premium ready", cls: "text-emerald-500 border-emerald-500/40" },
  READY_WITH_WARNINGS: { ru: "Готов, есть замечания", en: "Ready with warnings", cls: "text-emerald-500 border-emerald-500/40" },
  SITE_READY: { ru: "Готов к публикации", en: "Ready to launch", cls: "text-emerald-500 border-emerald-500/40" },
  SITE_NEEDS_FIX: { ru: "Нужны доработки", en: "Needs fixes", cls: "text-amber-500 border-amber-500/40" },
  BLOCKED: { ru: "Запуск заблокирован", en: "Launch blocked", cls: "text-red-500 border-red-500/40" },
};

const READY_VERDICTS: Verdict[] = ["PREMIUM_READY", "READY_WITH_WARNINGS", "SITE_READY"];

const scoreColor = (n: number) => (n >= 80 ? "text-emerald-500" : n >= 60 ? "text-amber-500" : "text-red-500");
const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export function LaunchPanel({
  projectId, ru, onGoToStep, onReport,
}: {
  projectId: string; ru: boolean; onGoToStep?: (step: number) => void; onReport?: (r: LaunchReport | null) => void;
}) {
  const [report, setReport] = useState<LaunchReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stages, setStages] = useState<StageState[]>([]);
  const [fixed, setFixed] = useState<{ done: number; total: number } | null>(null);
  const cancelled = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy("load");
    try {
      const { data, error } = await supabase.functions.invoke("launch-readiness-engine", {
        body: { project_id: projectId },
      });
      if (error) throw new Error(await invokeErrorMessage(error, ru ? "Не удалось проверить готовность" : "Readiness check failed"));
      const r = data as LaunchReport;
      setReport(r);
      onReport?.(r);
      return r;
    } catch (e) {
      setReport(null);
      onReport?.(null);
      toast.error(e instanceof Error ? e.message : "Readiness failed");
      return null;
    } finally {
      if (!silent) setBusy(null);
    }
  }, [projectId, ru, onReport]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { cancelled.current = true; }, []);

  const setStage = (key: string, patch: Partial<StageState>) =>
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  /** Runs one engine over id chunks, reporting progress 0-100. */
  const runChunked = async (
    key: string,
    fn: string,
    ids: string[],
    bodyFor: (slice: string[]) => Record<string, unknown>,
    size = 40,
  ) => {
    setStage(key, { status: "running", progress: 0 });
    const parts = ids.length ? chunk(ids, size) : [[]];
    let done = 0;
    let failed = 0;
    for (const part of parts) {
      const { error } = await supabase.functions.invoke(fn, { body: bodyFor(part) });
      if (error) failed++;
      done++;
      setStage(key, { progress: Math.round((done / parts.length) * 100) });
      setFixed((f) => (f ? { ...f, done: Math.min(f.total, f.done + part.length) } : f));
    }
    setStage(key, {
      status: failed === parts.length && parts.length > 0 ? "failed" : "done",
      progress: 100,
      note: ids.length ? `${ids.length}` : undefined,
    });
  };

  /** Auto Fix - only the engines the report actually flagged. */
  const autoFix = async () => {
    if (!report) return;
    const groups = new Set(report.issues.map((i) => i.group));
    const aff = { media: [] as string[], ...(report.affected || { seo: [], commercial: [], content: [], visual: [] }) };

    const plan: StageState[] = [];
    const wantSeo = groups.has("seo") || aff.seo.length > 0;
    const wantCommercial = groups.has("commercial") && aff.commercial.length > 0;
    const wantContent = groups.has("content") || groups.has("blog");
    const wantVisual = groups.has("visual") || aff.visual.length > 0;
    const wantMedia = groups.has("media");
    if (wantSeo) plan.push({ key: "seo", label_ru: "SEO Engine", label_en: "SEO Engine", status: "pending", progress: 0 });
    if (wantCommercial) plan.push({ key: "commercial", label_ru: "Коммерция", label_en: "Commercial", status: "pending", progress: 0 });
    if (wantContent) plan.push({ key: "content", label_ru: "Контент", label_en: "Content", status: "pending", progress: 0 });
    if (wantVisual) plan.push({ key: "visual", label_ru: "Дизайн", label_en: "Visual", status: "pending", progress: 0 });
    if (wantMedia) plan.push({ key: "media", label_ru: "Изображения", label_en: "Images", status: "pending", progress: 0 });
    if (!plan.length) {
      toast.info(ru ? "Автоматически исправлять нечего" : "Nothing to auto-fix");
      return;
    }
    plan.push({ key: "recheck", label_ru: "Проверка готовности", label_en: "Readiness check", status: "pending", progress: 0 });

    const totalTargets = (wantSeo ? aff.seo.length : 0) + (wantCommercial ? aff.commercial.length : 0)
      + (wantContent ? aff.content.length : 0) + (wantVisual ? aff.visual.length : 0);
    setFixed({ done: 0, total: totalTargets });
    setStages(plan);
    setBusy("fix");
    try {
      if (wantSeo) {
        await runChunked("seo", "seo-engine", aff.seo,
          (ids) => ids.length
            ? { project_id: projectId, mode: "selected", registry_ids: ids, limit: ids.length }
            : { project_id: projectId, mode: "missing", limit: 60 });
      }
      if (wantCommercial) {
        await runChunked("commercial", "commercial-engine", aff.commercial,
          (ids) => ({ project_id: projectId, mode: "selected", registry_ids: ids, limit: Math.max(1, ids.length) }), 25);
      }
      if (wantContent) {
        await runChunked("content", "generate-commerce-content", aff.content,
          (ids) => ids.length
            ? { project_id: projectId, entity_ids: ids, limit: ids.length, include_thin: true }
            : { project_id: projectId, mode: "only_fail", limit: 40 }, 20);
      }
      if (wantVisual) {
        setStage("visual", { status: "running", progress: 20 });
        await supabase.functions.invoke("visual-engine", { body: { project_id: projectId, action: "apply", mode: "missing" } });
        setStage("visual", { progress: 70 });
        await supabase.functions.invoke("visual-renderer", { body: { project_id: projectId, action: "qa" } });
        setStage("visual", { status: "done", progress: 100 });
      }
      if (wantMedia) {
        setStage("media", { status: "running", progress: 20 });
        // Media Engine works in chunks: keep calling until the queue is empty.
        let remaining = 1;
        let guard = 0;
        while (remaining > 0 && guard < 30) {
          const { data } = await supabase.functions.invoke("media-engine", {
            body: (aff.media || []).length
              ? { project_id: projectId, mode: "generate_selected", entity_ids: aff.media }
              : { project_id: projectId, mode: "generate_missing" },
          });
          remaining = Number((data as { remaining?: number } | null)?.remaining || 0);
          guard++;
          setStage("media", { progress: Math.min(90, 20 + guard * 10) });
        }
        setStage("media", { status: "done", progress: 100 });
      }
      setStage("recheck", { status: "running", progress: 50 });
      const fresh = await load(true);
      setStage("recheck", { status: fresh ? "done" : "failed", progress: 100 });
      toast.success(ru ? "Автоисправление завершено" : "Auto-fix finished");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auto-fix failed");
    } finally {
      setBusy(null);
    }
  };

  /** Prepare for launch - full pipeline, regardless of the current report. */
  const prepare = async () => {
    const plan: StageState[] = [
      { key: "seo", label_ru: "SEO Engine", label_en: "SEO Engine", status: "pending", progress: 0 },
      { key: "commercial", label_ru: "Коммерческие блоки", label_en: "Commercial blocks", status: "pending", progress: 0 },
      { key: "content", label_ru: "Контент", label_en: "Content", status: "pending", progress: 0 },
      { key: "visual", label_ru: "Дизайн", label_en: "Visual", status: "pending", progress: 0 },
      { key: "media", label_ru: "Изображения", label_en: "Images", status: "pending", progress: 0 },
      { key: "qa", label_ru: "QA", label_en: "QA", status: "pending", progress: 0 },
      { key: "recheck", label_ru: "Проверка готовности", label_en: "Readiness check", status: "pending", progress: 0 },
    ];
    setStages(plan);
    setFixed(null);
    setBusy("prepare");
    const step = async (key: string, fn: () => Promise<unknown>) => {
      setStage(key, { status: "running", progress: 40 });
      try {
        await fn();
        setStage(key, { status: "done", progress: 100 });
      } catch (e) {
        setStage(key, { status: "failed", progress: 100, note: e instanceof Error ? e.message.slice(0, 80) : "error" });
      }
    };
    try {
      await step("seo", () => supabase.functions.invoke("seo-engine", { body: { project_id: projectId, mode: "missing", limit: 120 } }));
      await step("commercial", () => supabase.functions.invoke("commercial-engine", { body: { project_id: projectId, mode: "missing", limit: 60 } }));
      await step("content", () => supabase.functions.invoke("generate-commerce-content", { body: { project_id: projectId, mode: "only_fail", limit: 40, include_thin: true } }));
      await step("visual", async () => {
        await supabase.functions.invoke("visual-engine", { body: { project_id: projectId, action: "apply", mode: "missing" } });
        await supabase.functions.invoke("visual-renderer", { body: { project_id: projectId, action: "qa" } });
      });
      await step("media", async () => {
        let remaining = 1;
        let guard = 0;
        while (remaining > 0 && guard < 30) {
          const { data } = await supabase.functions.invoke("media-engine", {
            body: { project_id: projectId, mode: "generate_missing" },
          });
          remaining = Number((data as { remaining?: number } | null)?.remaining || 0);
          guard++;
        }
      });
      await step("qa", () => supabase.functions.invoke("site-qa-check", { body: { project_id: projectId } }));
      setStage("recheck", { status: "running", progress: 50 });
      const fresh = await load(true);
      setStage("recheck", { status: fresh ? "done" : "failed", progress: 100 });
      if (fresh && READY_VERDICTS.includes(fresh.verdict)) {
        toast.success(ru ? "Сайт готов к публикации" : "Site is ready to launch");
      } else {
        toast.info(ru ? "Пайплайн выполнен - остались замечания" : "Pipeline finished - issues remain");
      }
    } finally {
      setBusy(null);
    }
  };

  const blockers = report?.issues.filter((i) => i.blocking) || [];
  const warnings = report?.issues.filter((i) => !i.blocking) || [];
  const v = report ? VERDICT[report.verdict] ?? VERDICT.SITE_NEEDS_FIX : null;
  const isReady = !!report && READY_VERDICTS.includes(report.verdict);

  return (
    <div className="space-y-4">
      <div className="rounded border border-border/60 p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{ru ? "Готовность сайта" : "Site readiness"}</span>
          {v && <Badge variant="outline" className={v.cls}>{ru ? v.ru : v.en}</Badge>}
          {report && <span className={`text-xs ${scoreColor(report.overall)}`}>{report.overall}/100</span>}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => load()} disabled={!!busy}>
            {busy === "load" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {!report && busy === "load" && (
          <div className="text-xs text-muted-foreground">{ru ? "Проверяю..." : "Checking..."}</div>
        )}

        {report?.scores.map((s) => (
          <div key={s.group} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span>{ru ? GROUP_RU[s.group] : GROUP_EN[s.group]}</span>
              <span className={scoreColor(s.score)}>{s.score}/100</span>
            </div>
            <Progress value={s.score} className="h-1.5" />
          </div>
        ))}

        {report && (
          <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
            <span>{ru ? "Страниц" : "Pages"}: {report.stats.pages}</span>
            <span>{ru ? "Товаров" : "Products"}: {report.stats.products}</span>
            <span>{ru ? "Статей" : "Articles"}: {report.stats.articles}</span>
            <span>QA critical: {report.stats.qa_critical < 0 ? "-" : report.stats.qa_critical}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={prepare} disabled={!!busy}>
            {busy === "prepare" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PlayCircle className="h-4 w-4 mr-2" />}
            {ru ? "Подготовить к запуску" : "Prepare for launch"}
          </Button>
          <Button size="sm" variant="outline" onClick={autoFix} disabled={!!busy || !report}>
            {busy === "fix" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wand2 className="h-4 w-4 mr-2" />}
            {ru ? "Исправить автоматически" : "Auto-fix"}
          </Button>
        </div>
      </div>

      {stages.length > 0 && (
        <div className="rounded border border-border/60 p-3 space-y-2">
          <div className="flex items-center justify-between text-sm font-medium">
            <span>{ru ? "Пайплайн подготовки" : "Preparation pipeline"}</span>
            {fixed && fixed.total > 0 && (
              <span className="text-xs text-muted-foreground">
                {ru ? "Исправлено" : "Fixed"}: {fixed.done} / {fixed.total}
              </span>
            )}
          </div>
          {stages.map((s) => (
            <div key={s.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  {s.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                  {s.status === "done" && <Check className="h-3 w-3 text-emerald-500" />}
                  {s.status === "failed" && <AlertTriangle className="h-3 w-3 text-red-500" />}
                  {ru ? s.label_ru : s.label_en}
                  {s.note && <span className="text-muted-foreground">({s.note})</span>}
                </span>
                <span className={s.status === "failed" ? "text-red-500" : "text-muted-foreground"}>
                  {s.status === "pending" ? "-" : `${s.progress}%`}
                </span>
              </div>
              <Progress value={s.progress} className="h-1" />
            </div>
          ))}
        </div>
      )}

      {report && (blockers.length > 0 || warnings.length > 0) && (
        <div className="rounded border border-border/60 p-3 space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {blockers.length > 0
              ? (ru ? "Блокирует запуск" : "Blocking the launch")
              : (ru ? "Рекомендации" : "Recommendations")}
          </div>
          {[...blockers, ...warnings].map((i) => (
            <div key={i.key} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline" className={`text-[10px] ${i.blocking ? "text-red-500 border-red-500/40" : "text-muted-foreground"}`}>
                {i.blocking ? "BLOCKER" : "WARNING"}
              </Badge>
              <span className={i.blocking ? "text-red-500" : "text-muted-foreground"}>
                {ru ? i.label_ru : i.label_en}
              </span>
              {i.count > 1 && <Badge variant="outline" className="text-xs">{i.count}</Badge>}
              {i.samples?.length ? (
                <span className="text-xs text-muted-foreground">{i.samples.slice(0, 3).join(", ")}</span>
              ) : null}
              {onGoToStep && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                  onClick={() => onGoToStep(i.step)}>
                  {ru ? "Перейти" : "Open"}<ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {isReady && (
        <div className="rounded border border-emerald-500/40 p-3 text-sm text-emerald-500 flex items-center gap-2">
          <Rocket className="h-4 w-4" />
          {ru ? "Сайт готов к публикации - выберите площадку ниже" : "Site is ready - pick a target below"}
        </div>
      )}
    </div>
  );
}
