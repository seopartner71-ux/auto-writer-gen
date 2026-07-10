import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Sparkles, ShieldCheck, BrainCircuit, AlertTriangle, Trophy, ThumbsUp, Share2, Info, Rocket, Target, CheckCircle2, Circle, XCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";

export interface QualityResult {
  turgenev_score: number | null;
  uniqueness_percent: number | null;
  ai_human_score: number | null;
  cluster_fitness_score?: number | null;
  serp_cluster_pipeline?: boolean | null;
  quality_badge: "excellent" | "good" | "needs_work" | null;
  details?: any;
  checked_at?: string | null;
}

interface Props {
  articleId: string | null;
  content: string;
  initial?: QualityResult;
  onUpdate?: (r: QualityResult) => void;
  // Triggers Humanize Fix in parent (regenerates content). Should resolve when done.
  onHumanize?: () => Promise<void>;
  // Optional: optimize against TOP-10 benchmark before Humanize. Resolves when done.
  onBenchmarkOptimize?: () => Promise<void>;
  // Whether benchmark data is already loaded (TOP-10 parsed).
  benchmarkReady?: boolean;
}

type Status = "ok" | "warn" | "bad" | "none";

function statusOf(value: number | null, kind: "turgenev" | "uniq" | "ai"): Status {
  if (value === null || value === undefined) return "none";
  if (kind === "turgenev") {
    if (value <= 4) return "ok";
    if (value <= 6) return "warn";
    return "bad";
  }
  if (kind === "uniq") {
    if (value >= 85) return "ok";
    if (value >= 70) return "warn";
    return "bad";
  }
  // ai (human-likeness)
  if (value >= 80) return "ok";
  if (value >= 60) return "warn";
  return "bad";
}

const STATUS_STYLE: Record<Status, { ring: string; bg: string; text: string; dot: string }> = {
  ok:   { ring: "ring-emerald-500/30", bg: "bg-emerald-500/10",  text: "text-emerald-400", dot: "bg-emerald-400" },
  warn: { ring: "ring-amber-500/30",   bg: "bg-amber-500/10",    text: "text-amber-400",   dot: "bg-amber-400" },
  bad:  { ring: "ring-rose-500/30",    bg: "bg-rose-500/10",     text: "text-rose-400",    dot: "bg-rose-400" },
  none: { ring: "ring-border/40",      bg: "bg-muted/30",        text: "text-muted-foreground", dot: "bg-muted-foreground/40" },
};

function MetricRow({
  icon: Icon, title, hint, value, suffix, status, progress,
}: {
  icon: any; title: string; hint: string; value: string;
  suffix?: string; status: Status; progress: number; // 0..100
}) {
  const st = STATUS_STYLE[status];
  return (
    <div className={`group rounded-lg border border-border/50 bg-card/40 p-3 transition-all hover:border-border ${status !== "none" ? "hover:" + st.ring.replace("ring-", "ring-1 ring-") : ""}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`flex h-7 w-7 items-center justify-center rounded-md ${st.bg} ${st.text} shrink-0`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium leading-tight truncate">{title}</div>
            <div className="text-[10px] text-muted-foreground leading-tight truncate">{hint}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`font-mono text-sm font-semibold tabular-nums ${st.text}`}>{value}</div>
          {suffix && <div className="text-[10px] text-muted-foreground -mt-0.5">{suffix}</div>}
        </div>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted/40">
        <div
          className={`h-full transition-all duration-500 ${status === "none" ? "bg-muted-foreground/20" : status === "ok" ? "bg-emerald-400" : status === "warn" ? "bg-amber-400" : "bg-rose-400"}`}
          style={{ width: `${Math.max(2, Math.min(100, progress))}%` }}
        />
      </div>
    </div>
  );
}

export function QualityCheckPanel({ articleId, content, initial, onUpdate, onHumanize, onBenchmarkOptimize, benchmarkReady }: Props) {
  const { t, lang } = useI18n();
  const [result, setResult] = useState<QualityResult>(initial || {
    turgenev_score: null, uniqueness_percent: null, ai_human_score: null, quality_badge: null,
  });
  const [loadingSet, setLoadingSet] = useState<Set<string>>(new Set());
  const [autoImproving, setAutoImproving] = useState(false);
  const [autoDialogOpen, setAutoDialogOpen] = useState(false);
  const [uniqPending, setUniqPending] = useState(false);
  const [useBenchmark, setUseBenchmark] = useState(false);
  type StepKey = "benchmark" | "humanize" | "score" | "uniqueness";
  type StepState = "pending" | "running" | "done" | "error";
  const [stepStates, setStepStates] = useState<Record<StepKey, StepState>>({
    benchmark: "pending", humanize: "pending", score: "pending", uniqueness: "pending",
  });
  // User can enable/disable each paid step
  const [stepEnabled, setStepEnabled] = useState<Record<StepKey, boolean>>({
    benchmark: false, humanize: true, score: true, uniqueness: true,
  });
  const totalCost =
    (stepEnabled.benchmark && useBenchmark && onBenchmarkOptimize && benchmarkReady ? 1 : 0) +
    (stepEnabled.humanize ? 1 : 0) +
    0 +
    (stepEnabled.uniqueness ? 1 : 0);

  // Load existing quality data when article changes
  useEffect(() => {
    if (!articleId) {
      setResult({ turgenev_score: null, uniqueness_percent: null, ai_human_score: null, quality_badge: null });
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("articles")
        .select("turgenev_score,uniqueness_percent,ai_human_score,quality_badge,quality_details,quality_checked_at,cluster_fitness_score,serp_cluster_pipeline")
        .eq("id", articleId)
        .maybeSingle();
      if (data) {
        setResult({
          turgenev_score: data.turgenev_score ?? null,
          uniqueness_percent: data.uniqueness_percent ?? null,
          ai_human_score: data.ai_human_score ?? null,
          cluster_fitness_score: (data as any).cluster_fitness_score ?? null,
          serp_cluster_pipeline: (data as any).serp_cluster_pipeline ?? null,
          quality_badge: (data.quality_badge as any) ?? null,
          details: data.quality_details,
          checked_at: data.quality_checked_at,
        });
        setUniqPending(Boolean((data.quality_details as any)?.uniqueness_pending));
      }
    })();
  }, [articleId]);

  // Poll for background uniqueness result (Text.ru runs in background up to ~2 min)
  useEffect(() => {
    if (!articleId || !uniqPending) return;
    let stopped = false;
    let attempts = 0;
    const tick = async () => {
      if (stopped) return;
      attempts++;
      const { data } = await supabase
        .from("articles")
        .select("uniqueness_percent,quality_badge,quality_details,quality_checked_at")
        .eq("id", articleId)
        .maybeSingle();
      if (!data) return;
      const pending = Boolean((data.quality_details as any)?.uniqueness_pending);
      const errMsg = (data.quality_details as any)?.uniqueness_error;
      if (!pending) {
        setUniqPending(false);
        setResult((prev) => ({
          ...prev,
          uniqueness_percent: data.uniqueness_percent ?? prev.uniqueness_percent,
          quality_badge: (data.quality_badge as any) ?? prev.quality_badge,
          details: data.quality_details ?? prev.details,
          checked_at: data.quality_checked_at ?? prev.checked_at,
        }));
        if (errMsg) toast.error(String(errMsg), { duration: 9000 });
        else if (data.uniqueness_percent !== null) toast.success(t("qcp.uniqPercent", { v: data.uniqueness_percent }));
        return;
      }
      if (attempts > 36) { setUniqPending(false); return; } // ~3 min
      setTimeout(tick, 5000);
    };
    const timer = setTimeout(tick, 5000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [articleId, uniqPending]);

  const isLoading = (k: string) => loadingSet.has(k);

  async function runChecks(checks: string[], opts?: { confirmCredit?: boolean }) {
    if (!articleId) {
      toast.error(t("qcp.saveFirst"));
      return;
    }
    if (!content || content.replace(/<[^>]+>/g, "").trim().length < 200) {
      toast.error(t("qcp.tooShort"));
      return;
    }
    // confirmation handled via AlertDialog at the call site
    const next = new Set(loadingSet);
    checks.forEach((c) => next.add(c));
    setLoadingSet(next);
    try {
      const { data, error } = await supabase.functions.invoke("quality-check", {
        body: { article_id: articleId, content, checks },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.uniqueness_error) {
        const msg = String(data.uniqueness_error);
        const isBalance = /нейросимвол|баланс/i.test(msg);
        const isKey = /ключ|key|TEXTRU/i.test(msg);
        toast.error(msg + (data.credit_refunded ? t("qcp.creditRefunded") : ""), {
          duration: 10000,
          action: (isBalance || isKey)
            ? {
                label: isBalance ? t("qcp.action.topup") : t("qcp.action.support"),
                onClick: () => {
                  if (isBalance) {
                    window.open("https://text.ru/account/balance", "_blank", "noopener");
                  } else {
                    window.location.href = "/support";
                  }
                },
              }
            : undefined,
          description: isBalance
            ? t("qcp.descBalance")
            : isKey
            ? t("qcp.descKey")
            : undefined,
        });
      }
      const updated: QualityResult = {
        turgenev_score: data.turgenev_score,
        uniqueness_percent: data.uniqueness_percent,
        ai_human_score: data.ai_human_score,
        quality_badge: data.quality_badge,
        details: data.details,
        checked_at: data.checked_at,
      };
      setResult(updated);
      onUpdate?.(updated);
      if (data?.uniqueness_pending) {
        setUniqPending(true);
        toast.info(t("qcp.uniqPending"), { duration: 6000 });
      } else if (!data?.uniqueness_error) {
        toast.success(t("qcp.done"));
      }
    } catch (e: any) {
      toast.error(e?.message || t("qcp.error"));
    } finally {
      const after = new Set(loadingSet);
      checks.forEach((c) => after.delete(c));
      setLoadingSet(after);
    }
  }

  async function shareCard() {
    const lines = [
      t("qcp.share.title"),
      "",
      result.turgenev_score !== null ? t("qcp.share.quality", { v: result.turgenev_score }) : null,
      result.uniqueness_percent !== null ? t("qcp.share.uniq", { v: result.uniqueness_percent }) : null,
      result.ai_human_score !== null ? t("qcp.share.ai", { v: result.ai_human_score }) : null,
      "",
      t("qcp.share.footer"),
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(lines);
      toast.success(t("qcp.share.copied"));
    } catch {
      toast.error(t("qcp.share.copyFailed"));
    }
  }

  const sScore = statusOf(result.turgenev_score, "turgenev");
  const sUniq = statusOf(result.uniqueness_percent, "uniq");
  const sAi = statusOf(result.ai_human_score, "ai");

  const badgeMeta = result.quality_badge === "excellent"
    ? { icon: Trophy,        label: t("qcp.badge.excellent"), cls: "text-emerald-400", bg: "from-emerald-500/15 to-emerald-500/5", border: "border-emerald-500/30" }
    : result.quality_badge === "good"
    ? { icon: ThumbsUp,      label: t("qcp.badge.good"),    cls: "text-amber-400",   bg: "from-amber-500/15 to-amber-500/5",     border: "border-amber-500/30" }
    : result.quality_badge === "needs_work"
    ? { icon: AlertTriangle, label: t("qcp.badge.needsWork"),             cls: "text-rose-400",    bg: "from-rose-500/15 to-rose-500/5",       border: "border-rose-500/30" }
    : null;

  // progress mappings
  const scoreProgress = result.turgenev_score !== null ? Math.max(0, 100 - result.turgenev_score * 10) : 0;
  const uniqProgress  = result.uniqueness_percent ?? 0;
  const aiProgress    = result.ai_human_score ?? 0;

  const loadingFree = isLoading("score") || isLoading("ai");
  const loadingUniq = isLoading("uniqueness");

  async function autoImproveToTop() {
    if (!articleId) {
      toast.error(t("qcp.saveFirst"));
      return;
    }
    if (!onHumanize) {
      toast.error(t("qcp.humanizeUnavailable"));
      return;
    }
    if (!content || content.replace(/<[^>]+>/g, "").trim().length < 200) {
      toast.error(t("qcp.tooShort2"));
      return;
    }
    setAutoImproving(true);
    setStepStates({
      benchmark: useBenchmark && onBenchmarkOptimize && benchmarkReady ? "pending" : "done",
      humanize: "pending", score: "pending", uniqueness: "pending",
    });
    try {
      if (stepEnabled.benchmark && useBenchmark && onBenchmarkOptimize && benchmarkReady) {
        setStepStates(s => ({ ...s, benchmark: "running" }));
        try { await onBenchmarkOptimize(); setStepStates(s => ({ ...s, benchmark: "done" })); }
        catch (e) { setStepStates(s => ({ ...s, benchmark: "error" })); throw e; }
      }
      if (stepEnabled.humanize) {
        setStepStates(s => ({ ...s, humanize: "running" }));
        try { await onHumanize(); setStepStates(s => ({ ...s, humanize: "done" })); }
        catch (e) { setStepStates(s => ({ ...s, humanize: "error" })); throw e; }
      } else {
        setStepStates(s => ({ ...s, humanize: "done" }));
      }
      if (stepEnabled.score) {
        setStepStates(s => ({ ...s, score: "running" }));
        try { await runChecks(["score", "ai"]); setStepStates(s => ({ ...s, score: "done" })); }
        catch (e) { setStepStates(s => ({ ...s, score: "error" })); throw e; }
      } else {
        setStepStates(s => ({ ...s, score: "done" }));
      }
      if (stepEnabled.uniqueness) {
        setStepStates(s => ({ ...s, uniqueness: "running" }));
        try { await runChecks(["uniqueness"]); setStepStates(s => ({ ...s, uniqueness: "done" })); }
        catch (e) { setStepStates(s => ({ ...s, uniqueness: "error" })); throw e; }
      } else {
        setStepStates(s => ({ ...s, uniqueness: "done" }));
      }
      toast.success(t("qcp.autoDone"));
      setTimeout(() => setAutoDialogOpen(false), 800);
    } catch (e: any) {
      toast.error(e?.message || t("qcp.autoError"));
    } finally {
      setAutoImproving(false);
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Card className="overflow-hidden border-border/60 bg-gradient-to-b from-card/80 to-card/40 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">{t("qcp.title")}</div>
              <div className="text-[10px] text-muted-foreground leading-tight">
                {result.checked_at
                  ? t("qcp.updated", { date: new Date(result.checked_at).toLocaleString(lang === "ru" ? "ru-RU" : "en-US", { dateStyle: "short", timeStyle: "short" }) })
                  : t("qcp.runHint")}
              </div>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground transition-colors">
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <div className="text-xs">{t("qcp.infoTip")}</div>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Verdict banner */}
        {badgeMeta && (
          <div className={`flex items-center gap-2 border-b ${badgeMeta.border} bg-gradient-to-r ${badgeMeta.bg} px-4 py-2.5`}>
            <badgeMeta.icon className={`h-4 w-4 ${badgeMeta.cls}`} />
            <div className={`text-sm font-medium ${badgeMeta.cls}`}>{badgeMeta.label}</div>
          </div>
        )}

        {/* Metrics */}
        <div className="space-y-2 p-4">
          <MetricRow
            icon={Sparkles}
            title={t("qcp.metric.score")}
            hint={result.details?.score_details ? t("qcp.metric.score.hintDetail", { stylistics: result.details.score_details.stylistics, water: result.details.score_details.water }) : t("qcp.metric.score.hint")}
            value={result.turgenev_score !== null ? String(result.turgenev_score) : "-"}
            suffix={result.turgenev_score !== null ? t("qcp.metric.score.suffix") : undefined}
            status={sScore}
            progress={scoreProgress}
          />
          <MetricRow
            icon={ShieldCheck}
            title={t("qcp.metric.uniq")}
            hint={uniqPending ? t("qcp.metric.uniq.pending") : (result.details?.uniqueness_details?.words ? t("qcp.metric.uniq.words", { words: result.details.uniqueness_details.words }) : t("qcp.metric.uniq.hint"))}
            value={uniqPending ? "..." : (result.uniqueness_percent !== null ? `${result.uniqueness_percent}%` : "-")}
            status={sUniq}
            progress={uniqProgress}
          />
          <MetricRow
            icon={BrainCircuit}
            title={t("qcp.metric.ai")}
            hint={result.details?.ai_details?.verdict ? t("qcp.metric.ai.verdict", { verdict: result.details.ai_details.verdict }) : t("qcp.metric.ai.hint")}
            value={result.ai_human_score !== null ? `${result.ai_human_score}%` : "-"}
            suffix={result.ai_human_score !== null ? t("qcp.metric.ai.suffix") : undefined}
            status={sAi}
            progress={aiProgress}
          />
          <MetricRow
            icon={Target}
            title={result.serp_cluster_pipeline ? t("qcp.metric.cluster.newPipe") : t("qcp.metric.cluster.oldPipe")}
            hint={
              result.cluster_fitness_score !== null && result.cluster_fitness_score !== undefined
                ? t("qcp.metric.cluster.details", { in: (result.details as any)?.cluster_fitness_details?.in_cluster ?? "?", total: (result.details as any)?.cluster_fitness_details?.total_paragraphs ?? "?" })
                : t("qcp.metric.cluster.hint")
            }
            value={result.cluster_fitness_score !== null && result.cluster_fitness_score !== undefined ? `${result.cluster_fitness_score}%` : "-"}
            suffix={result.cluster_fitness_score !== null && result.cluster_fitness_score !== undefined ? t("qcp.metric.cluster.suffix") : undefined}
            status={
              result.cluster_fitness_score === null || result.cluster_fitness_score === undefined ? "none"
                : result.cluster_fitness_score >= 70 ? "ok"
                : result.cluster_fitness_score >= 30 ? "warn"
                : "bad"
            }
            progress={Math.max(0, Math.min(100, result.cluster_fitness_score ?? 0))}
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 border-t border-border/40 bg-muted/10 p-3">
          {/* "Довести до ТОПа" скрыта - улучшение делает единый оркестратор "Улучшить качество текста" в правой панели. Не удаляем, чтобы можно было вернуть. */}
          {false && onHumanize ? (
            <Button
              size="sm"
              disabled={autoImproving || loadingFree || loadingUniq || uniqPending}
              onClick={() => setAutoDialogOpen(true)}
              className="h-11 font-semibold text-white bg-gradient-to-r from-purple-600 via-fuchsia-600 to-blue-600 hover:from-purple-700 hover:via-fuchsia-700 hover:to-blue-700 hover:scale-[1.01] transition-all shadow-[0_0_24px_-8px_hsl(var(--primary)/0.6)]"
            >
              {autoImproving
                ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> {t("qcp.toTop.running")}</>
                : <><Rocket className="h-4 w-4 mr-1.5" /> {t("qcp.toTop.btn")} <span className="ml-1.5 text-[10px] opacity-80">~2 ₵</span></>}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={loadingFree || loadingUniq || uniqPending}
              onClick={() => runChecks(["score", "ai", "uniqueness"]) }
              className="h-11 font-semibold text-white bg-gradient-to-r from-purple-600 via-fuchsia-600 to-blue-600 hover:from-purple-700 hover:via-fuchsia-700 hover:to-blue-700 hover:scale-[1.01] transition-all"
            >
              {loadingFree || loadingUniq
                ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> {t("qcp.checking")}</>
                : <><Sparkles className="h-4 w-4 mr-1.5" /> {t("qcp.runCheck")} <span className="ml-1.5 text-[10px] opacity-80">1 ₵</span></>}
            </Button>
          )}
          <div className="flex items-center justify-between text-[11px]">
            <button
              type="button"
              disabled={loadingFree}
              onClick={() => runChecks(["score", "ai"])}
              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {loadingFree ? t("qcp.freeOnly.running") : t("qcp.freeOnly")}
            </button>
            {badgeMeta && (
              <button
                type="button"
                onClick={shareCard}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Share2 className="h-3 w-3" /> {t("qcp.share.btn")}
              </button>
            )}
          </div>
        </div>
      </Card>

      <AlertDialog open={autoDialogOpen} onOpenChange={(v) => {
        setAutoDialogOpen(v);
        if (v && !autoImproving) setStepStates({ benchmark: "pending", humanize: "pending", score: "pending", uniqueness: "pending" });
      }}>
        <AlertDialogContent className="border-border/60 bg-gradient-to-b from-card to-card/80 backdrop-blur-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-purple-500/20 to-blue-500/20 text-purple-400">
                <Rocket className="h-3.5 w-3.5" />
              </div>
              {t("qcp.dlg.title")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="pt-2 space-y-3">
                <div className="text-sm text-muted-foreground">
                  {t("qcp.dlg.intro")}
                </div>
                <div className="space-y-2">
                  {([
                    { key: "benchmark" as const, title: t("qcp.dlg.step.benchmark.title"), desc: t("qcp.dlg.step.benchmark.desc"), cost: "1 ₵", show: useBenchmark && !!onBenchmarkOptimize && !!benchmarkReady },
                    { key: "humanize" as const, title: t("qcp.dlg.step.humanize.title"), desc: t("qcp.dlg.step.humanize.desc"), cost: "1 ₵", show: true },
                    { key: "score" as const, title: t("qcp.dlg.step.score.title"), desc: t("qcp.dlg.step.score.desc"), cost: t("qcp.dlg.free"), show: true },
                    { key: "uniqueness" as const, title: t("qcp.dlg.step.uniqueness.title"), desc: t("qcp.dlg.step.uniqueness.desc"), cost: "1 ₵", show: true },
                  ]).filter(s => s.show).map((step, idx) => {
                    const state = stepStates[step.key];
                    const enabled = stepEnabled[step.key];
                    const ring = state === "running" ? "border-primary/50 bg-primary/5"
                      : state === "done" ? "border-emerald-500/30 bg-emerald-500/5"
                      : state === "error" ? "border-destructive/40 bg-destructive/5"
                      : enabled ? "border-primary/40 bg-primary/5"
                      : "border-border/40 bg-muted/20";
                    const StatusIcon = state === "done" ? CheckCircle2 : state === "running" ? Loader2 : state === "error" ? XCircle : null;
                    const statusColor = state === "done" ? "text-emerald-400" : state === "running" ? "text-primary" : state === "error" ? "text-destructive" : "";
                    return (
                      <label key={step.key} className={`flex items-start gap-3 rounded-lg border p-2.5 transition-colors cursor-pointer ${ring}`}>
                        <Checkbox
                          checked={enabled}
                          disabled={autoImproving}
                          onCheckedChange={(v) => setStepEnabled(s => ({ ...s, [step.key]: Boolean(v) }))}
                          className="mt-0.5"
                        />
                        <div className="flex-1 text-xs">
                          <div className="font-medium text-foreground flex items-center gap-1.5">
                            {idx + 1}. {step.title}
                            {StatusIcon && <StatusIcon className={`h-3.5 w-3.5 ${statusColor} ${state === "running" ? "animate-spin" : ""}`} />}
                          </div>
                          <div className="text-muted-foreground">{step.desc}</div>
                        </div>
                         <span className={`text-[10px] ${step.cost === t("qcp.dlg.free") ? "text-emerald-400" : "text-muted-foreground"}`}>{step.cost}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                  <span className="text-xs text-muted-foreground">{t("qcp.dlg.total")}</span>
                  <span className="text-sm font-semibold text-foreground">{totalCost} ₵</span>
                </div>

                {onBenchmarkOptimize && (
                  <label className={`flex items-start gap-3 rounded-lg border p-2.5 cursor-pointer transition-colors ${
                    benchmarkReady
                      ? (useBenchmark ? "border-primary/50 bg-primary/10" : "border-border/40 bg-muted/20 hover:bg-muted/30")
                      : "border-border/30 bg-muted/10 opacity-60 cursor-not-allowed"
                  }`}>
                    <Checkbox
                      checked={useBenchmark && benchmarkReady}
                      disabled={!benchmarkReady}
                      onCheckedChange={(v) => setUseBenchmark(Boolean(v))}
                      className="mt-0.5"
                    />
                    <div className="flex-1 text-xs">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <Target className="h-3.5 w-3.5 text-primary" />
                        {t("qcp.dlg.bench.on")}
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        {benchmarkReady
                          ? t("qcp.dlg.bench.readyDesc")
                          : t("qcp.dlg.bench.notReadyDesc")}
                      </div>
                    </div>
                  </label>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("qcp.dlg.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={autoImproveToTop}
              disabled={autoImproving}
              className="bg-gradient-to-r from-purple-600 via-fuchsia-600 to-blue-600 text-white hover:from-purple-700 hover:via-fuchsia-700 hover:to-blue-700"
            >
              {autoImproving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5 mr-1.5" />}
              {autoImproving ? t("qcp.dlg.running") : t("qcp.dlg.run", { v: totalCost })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}

// Compact badge for article list rows.
export function QualityBadgeIcon({ badge }: { badge: string | null | undefined }) {
  const { t } = useI18n();
  if (badge === "excellent") return (
    <Tooltip>
      <TooltipTrigger><Trophy className="h-4 w-4 text-success" /></TooltipTrigger>
      <TooltipContent>{t("qcp.badgeIcon.excellent")}</TooltipContent>
    </Tooltip>
  );
  if (badge === "good") return (
    <Tooltip>
      <TooltipTrigger><ThumbsUp className="h-4 w-4 text-warning" /></TooltipTrigger>
      <TooltipContent>{t("qcp.badgeIcon.good")}</TooltipContent>
    </Tooltip>
  );
  if (badge === "needs_work") return (
    <Tooltip>
      <TooltipTrigger><AlertTriangle className="h-4 w-4 text-destructive" /></TooltipTrigger>
      <TooltipContent>{t("qcp.badgeIcon.needsWork")}</TooltipContent>
    </Tooltip>
  );
  return (
    <Tooltip>
      <TooltipTrigger><span className="inline-block h-3 w-3 rounded-full border border-muted-foreground/40" /></TooltipTrigger>
      <TooltipContent>{t("qcp.badgeIcon.none")}</TooltipContent>
    </Tooltip>
  );
}