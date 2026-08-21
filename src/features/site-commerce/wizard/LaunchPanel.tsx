// P19 - Launch Readiness: five scores, verdict and actionable blockers.
// Read-only view over launch-readiness-engine; auto-fix simply re-runs the
// existing engines (SEO / Commercial / Visual) for the missing pages.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, RefreshCw, Wand2, ArrowRight, Rocket, AlertTriangle } from "lucide-react";
import { invokeErrorMessage } from "@/shared/utils/invokeError";

type Group = "seo" | "content" | "commercial" | "visual" | "technical" | "blog";

interface ScoreRow { group: Group; score: number; passed: number; total: number }
interface Issue {
  group: Group; key: string; count: number; blocking: boolean; step: number;
  label_ru: string; label_en: string; samples?: string[];
}
export interface LaunchReport {
  verdict: "SITE_READY" | "SITE_NEEDS_FIX" | "BLOCKED";
  overall: number;
  scores: ScoreRow[];
  issues: Issue[];
  stats: { pages: number; content_pages: number; products: number; articles: number; qa_critical: number; visual_score: number };
  site: { production_url: string | null; published_at: string | null; custom_domain: string | null; ssl_status: string | null };
}

const GROUP_RU: Record<Group, string> = {
  seo: "SEO", content: "Контент", commercial: "Коммерция", visual: "Дизайн", technical: "Техника", blog: "Блог",
};
const GROUP_EN: Record<Group, string> = {
  seo: "SEO", content: "Content", commercial: "Commercial", visual: "Visual", technical: "Technical", blog: "Blog",
};

const VERDICT: Record<string, { ru: string; en: string; cls: string }> = {
  SITE_READY: { ru: "Готов к публикации", en: "Ready to launch", cls: "text-emerald-500 border-emerald-500/40" },
  SITE_NEEDS_FIX: { ru: "Нужны доработки", en: "Needs fixes", cls: "text-amber-500 border-amber-500/40" },
  BLOCKED: { ru: "Запуск заблокирован", en: "Launch blocked", cls: "text-red-500 border-red-500/40" },
};

const scoreColor = (n: number) => (n >= 70 ? "text-emerald-500" : n >= 30 ? "text-amber-500" : "text-red-500");

export function LaunchPanel({
  projectId, ru, onGoToStep, onReport,
}: {
  projectId: string; ru: boolean; onGoToStep?: (step: number) => void; onReport?: (r: LaunchReport | null) => void;
}) {
  const [report, setReport] = useState<LaunchReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy("load");
    try {
      const { data, error } = await supabase.functions.invoke("launch-readiness-engine", {
        body: { project_id: projectId },
      });
      if (error) throw new Error(await invokeErrorMessage(error, ru ? "Не удалось проверить готовность" : "Readiness check failed"));
      const r = data as LaunchReport;
      setReport(r);
      onReport?.(r);
    } catch (e) {
      setReport(null);
      onReport?.(null);
      toast.error(e instanceof Error ? e.message : "Readiness failed");
    } finally {
      setBusy(null);
    }
  }, [projectId, ru, onReport]);

  useEffect(() => { void load(); }, [load]);

  const autoFix = async () => {
    if (!report) return;
    const groups = new Set(report.issues.map((i) => i.group));
    setBusy("fix");
    try {
      const jobs: Promise<unknown>[] = [];
      if (groups.has("seo")) {
        jobs.push(supabase.functions.invoke("seo-engine", { body: { project_id: projectId, mode: "missing", limit: 60 } }));
      }
      if (groups.has("commercial")) {
        jobs.push(supabase.functions.invoke("commercial-engine", { body: { project_id: projectId, mode: "missing", limit: 40 } }));
      }
      if (groups.has("visual")) {
        jobs.push(supabase.functions.invoke("visual-engine", { body: { project_id: projectId, action: "apply", mode: "missing" } }));
      }
      if (!jobs.length) {
        toast.info(ru ? "Автоматически исправлять нечего" : "Nothing to auto-fix");
        return;
      }
      await Promise.allSettled(jobs);
      toast.success(ru ? "Движки перезапущены - обновляю отчет" : "Engines re-run - refreshing report");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auto-fix failed");
    } finally {
      setBusy(null);
    }
  };

  const blockers = report?.issues.filter((i) => i.blocking) || [];
  const warnings = report?.issues.filter((i) => !i.blocking) || [];
  const v = report ? VERDICT[report.verdict] : null;

  return (
    <div className="space-y-4">
      <div className="rounded border border-border/60 p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{ru ? "Готовность сайта" : "Site readiness"}</span>
          {v && <Badge variant="outline" className={v.cls}>{ru ? v.ru : v.en}</Badge>}
          {report && <span className="text-xs text-muted-foreground">{report.overall}/100</span>}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={load} disabled={!!busy}>
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
      </div>

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
              <span className={i.blocking ? "text-red-500" : "text-muted-foreground"}>
                {i.blocking ? "x" : "-"} {ru ? i.label_ru : i.label_en}
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
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={autoFix} disabled={!!busy}>
              {busy === "fix" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wand2 className="h-4 w-4 mr-2" />}
              {ru ? "Исправить автоматически" : "Auto-fix"}
            </Button>
            {onGoToStep && blockers[0] && (
              <Button size="sm" variant="outline" onClick={() => onGoToStep(blockers[0].step)}>
                {ru ? "Перейти к проблемам" : "Go to issues"}
              </Button>
            )}
          </div>
        </div>
      )}

      {report?.verdict === "SITE_READY" && (
        <div className="rounded border border-emerald-500/40 p-3 text-sm text-emerald-500 flex items-center gap-2">
          <Rocket className="h-4 w-4" />
          {ru ? "Сайт готов к публикации - выберите площадку ниже" : "Site is ready - pick a target below"}
        </div>
      )}
    </div>
  );
}
