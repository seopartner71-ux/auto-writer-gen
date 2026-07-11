import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, Wand2, RotateCcw, History, Sparkles, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";
import { edgeErrorMessage } from "@/shared/utils/edgeError";

/**
 * Unified quality badge - replaces AutoQualityBadge + LiveQualityBadge.
 * Compact icon button; popover shows AI score / burstiness / keyword density
 * with quick actions: improve, recheck, version history.
 * Subscribes to realtime updates on the article row.
 */
interface Props {
  articleId: string;
  initial?: {
    quality_status?: string | null;
    ai_score?: number | null;
    burstiness_score?: number | null;
    burstiness_status?: string | null;
    keyword_density?: number | null;
    keyword_density_status?: string | null;
    turgenev_score?: number | null;
    turgenev_status?: string | null;
    turgenev_details?: { repeats?: number; style?: number; spam?: number; water?: number; readability?: number } | null;
    uniqueness_percent?: number | null;
    uniqueness_checked_at?: string | null;
  };
  onOpenVersions?: () => void;
}

function bandFromScore(score: number): "ok" | "warning" | "fail" {
  if (score >= 70) return "ok";
  if (score >= 40) return "warning";
  return "fail";
}
const BAND_META: Record<"ok" | "warning" | "fail", { dot: string; pill: string; bar: string }> = {
  ok:      { dot: "🟢", pill: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", bar: "bg-emerald-500" },
  warning: { dot: "🟡", pill: "bg-amber-500/15 text-amber-300 border-amber-500/30",       bar: "bg-amber-500"   },
  fail:    { dot: "🔴", pill: "bg-rose-500/15 text-rose-300 border-rose-500/30",          bar: "bg-rose-500"    },
};

function aiBand(score: number | null | undefined): "ok" | "warning" | "fail" | null {
  if (score == null) return null;
  if (score >= 80) return "ok";
  if (score >= 60) return "ok";
  if (score >= 40) return "warning";
  return "fail";
}
function burstBand(sigma: number | null | undefined): "ok" | "warning" | "fail" | null {
  if (sigma == null) return null;
  if (sigma >= 10) return "ok";
  if (sigma >= 7) return "ok";
  if (sigma >= 5) return "warning";
  return "fail";
}
function densityBand(s: string | null | undefined): "ok" | "warning" | "fail" | null {
  if (!s) return null;
  if (s === "ok") return "ok";
  if (s === "underuse") return "warning";
  if (s === "overuse") return "fail";
  return null;
}
function turgBand(score: number | null | undefined): "ok" | "warning" | "fail" | null {
  if (score == null) return null;
  if (score <= 5) return "ok";
  if (score <= 10) return "warning";
  return "fail";
}
function bandToScore(b: "ok" | "warning" | "fail" | null): number | null {
  if (b === "ok") return 90;
  if (b === "warning") return 55;
  if (b === "fail") return 25;
  return null;
}

export function QualityBadge({ articleId, initial, onOpenVersions }: Props) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<any>(initial || {});
  const [improving, setImproving] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [checkingUniq, setCheckingUniq] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);

  const aiHint = (score: number): string => {
    const sim = String(Math.max(0, Math.min(100, 100 - score)));
    if (score >= 80) return t("qb.ai.excellent", { n: sim });
    if (score >= 60) return t("qb.ai.good", { n: sim });
    if (score >= 40) return t("qb.ai.mid", { n: sim });
    return t("qb.ai.bad", { n: sim });
  };
  const burstHint = (sigma: number): string => {
    if (sigma >= 10) return t("qb.burst.great");
    if (sigma >= 7) return t("qb.burst.good");
    if (sigma >= 5) return t("qb.burst.weak");
    return t("qb.burst.bad");
  };
  const densityHint = (pct: number | null | undefined, status: string | null | undefined): string => {
    const v = pct == null ? "-" : `${pct}%`;
    if (status === "overuse") return t("qb.dens.overuse", { v });
    if (status === "underuse") return t("qb.dens.underuse", { v });
    return t("qb.dens.ok", { v });
  };
  const turgHint = (score: number): string => {
    const n = String(score);
    if (score <= 5) return t("qb.turg.ok", { n });
    if (score <= 10) return t("qb.turg.warn", { n });
    return t("qb.turg.fail", { n });
  };

  function cleanupChannel() {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (fallbackTimerRef.current !== null) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }

  function startRealtime() {
    cleanupChannel();
    const ch = supabase
      .channel(`article-quality-${articleId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "articles", filter: `id=eq.${articleId}` },
        (payload: any) => {
          if (stoppedRef.current) return;
          const row = payload?.new || {};
          setData((d: any) => ({
            ...d,
            quality_status: row.quality_status,
            ai_score: row.ai_score,
            burstiness_score: row.burstiness_score,
            burstiness_status: row.burstiness_status,
            keyword_density: row.keyword_density,
            keyword_density_status: row.keyword_density_status,
            turgenev_score: row.turgenev_score,
            turgenev_status: row.turgenev_status,
            turgenev_details: row.turgenev_details,
            uniqueness_percent: row.uniqueness_percent,
            uniqueness_checked_at: row.uniqueness_checked_at,
          }));
          if (row.quality_status && row.quality_status !== "checking") {
            cleanupChannel();
          }
        }
      )
      .subscribe();
    channelRef.current = ch;

    fallbackTimerRef.current = window.setTimeout(() => {
      if (stoppedRef.current) return;
      setData((d: any) => (d.quality_status === "checking" ? { ...d, quality_status: "timeout" } : d));
      cleanupChannel();
    }, 180_000);
  }

  async function fetchOnce() {
    const { data: row } = await supabase.from("articles")
      .select("quality_status,ai_score,burstiness_score,burstiness_status,keyword_density,keyword_density_status,turgenev_score,turgenev_status,turgenev_details,uniqueness_percent,uniqueness_checked_at")
      .eq("id", articleId).maybeSingle();
    if (stoppedRef.current) return;
    if (row) setData((d: any) => ({ ...d, ...row }));
    if (!row || row.quality_status === "checking") startRealtime();
  }

  useEffect(() => {
    stoppedRef.current = false;
    if (!data.quality_status || data.quality_status === "checking") {
      if (data.quality_status === "checking") startRealtime();
      else fetchOnce();
    }
    return () => {
      stoppedRef.current = true;
      cleanupChannel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

  async function callEdge(fnName: string, body: Record<string, unknown>): Promise<any> {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error(t("qb.err.session"));

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(body),
    });
    let payload: any = null;
    try { payload = await resp.json(); } catch { /* non-JSON */ }
    if (!resp.ok) {
      throw new Error(edgeErrorMessage(payload, lang, t("qb.err.generic", { n: String(resp.status) })));
    }
    return payload;
  }

  async function runImprove() {
    setImproving(true);
    try {
      const res = await callEdge("improve-article", { article_id: articleId });
      if (res?.cooldown) {
        toast.warning(res.message || t("qb.toast.cooldown"));
        return;
      }
      toast.info(t("qb.toast.improveStart"));
      setData((d: any) => ({ ...d, quality_status: "improving" }));
      stoppedRef.current = false;
      startRealtime();
    } catch (e: any) {
      toast.error(e?.message || t("qb.err.request"));
    } finally {
      setImproving(false);
    }
  }

  async function runRecheck() {
    setRechecking(true);
    try {
      const { data: art } = await supabase.from("articles").select("content").eq("id", articleId).maybeSingle();
      if (!art?.content) { toast.error(t("qb.err.noContent")); return; }
      await callEdge("quality-check", { article_id: articleId, content: art.content, mode: "auto" });
      toast.success(t("qb.toast.recheckDone"));
      setData((d: any) => ({ ...d, quality_status: "checking" }));
      stoppedRef.current = false;
      startRealtime();
    } catch (e: any) {
      toast.error(e?.message || t("qb.err.request"));
    } finally {
      setRechecking(false);
    }
  }

  async function runUniqueness() {
    setCheckingUniq(true);
    try {
      const { data: art } = await supabase.from("articles").select("content").eq("id", articleId).maybeSingle();
      if (!art?.content) { toast.error(t("qb.err.noContent")); return; }
      toast.info(t("qb.toast.uniqStart"));
      const res = await callEdge("quality-check", {
        article_id: articleId,
        content: art.content,
        checks: ["uniqueness"],
      });
      if (res?.uniqueness_pending) {
        stoppedRef.current = false;
        startRealtime();
      } else if (res?.uniqueness_percent != null) {
        setData((d: any) => ({ ...d, uniqueness_percent: res.uniqueness_percent, uniqueness_checked_at: new Date().toISOString() }));
        toast.success(t("qb.toast.uniqResult", { n: String(res.uniqueness_percent) }));
      }
    } catch (e: any) {
      toast.error(e?.message || t("qb.err.uniq"));
    } finally {
      setCheckingUniq(false);
    }
  }

  const status = data.quality_status || "none";
  const isChecking = status === "checking";
  const isShort = status === "too_short";
  const isTimeout = status === "timeout";
  const noData = status === "none";

  const aiB = aiBand(data.ai_score);
  const burstB = burstBand(data.burstiness_score);
  const densB = densityBand(data.keyword_density_status);
  const turgB = turgBand(data.turgenev_score);

  // Overall score: average of available metric "scores"
  const overall = useMemo<number | null>(() => {
    const parts: number[] = [];
    if (data.ai_score != null) parts.push(Math.max(0, Math.min(100, Number(data.ai_score))));
    const bs = bandToScore(burstB); if (bs != null) parts.push(bs);
    const ds = bandToScore(densB);  if (ds != null) parts.push(ds);
    const ts = bandToScore(turgB);  if (ts != null) parts.push(ts);
    if (!parts.length) return null;
    return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  }, [data.ai_score, burstB, densB, turgB]);

  const overallBand = overall != null ? bandFromScore(overall) : null;
  const meta = overallBand ? BAND_META[overallBand] : null;
  const showImprove = overallBand === "warning" || overallBand === "fail" || status === "warning" || status === "fail";
  const showRetry = !isChecking;

  // Status-driven trigger pill (text + icon, fixed width, semantic colors)
  type TriggerKind = "ok" | "warning" | "fail" | "checking" | "timeout" | "none";
  const triggerKind: TriggerKind =
    isChecking ? "checking"
    : isTimeout ? "timeout"
    : status === "ok" ? "ok"
    : status === "warning" ? "warning"
    : status === "fail" ? "fail"
    : overallBand === "ok" ? "ok"
    : overallBand === "warning" ? "warning"
    : overallBand === "fail" ? "fail"
    : "none";
  const TRIGGER_META: Record<TriggerKind, { icon: string; cls: string }> = {
    ok:       { icon: "✓", cls: "bg-success/15 text-success border-success/30" },
    warning:  { icon: "!", cls: "bg-warning/15 text-warning border-warning/30" },
    fail:     { icon: "✗", cls: "bg-destructive/15 text-destructive border-destructive/30" },
    checking: { icon: "⏳", cls: "bg-muted/40 text-muted-foreground border-border" },
    timeout:  { icon: "!", cls: "bg-muted/40 text-muted-foreground border-border" },
    none:     { icon: "◎", cls: "bg-secondary text-secondary-foreground border-border" },
  };
  const trig = TRIGGER_META[triggerKind];
  const trigLabel = t(`qb.trig.${triggerKind}` as any);
  const overallLabel = overallBand === "ok" ? t("qb.excellent") : overallBand === "warning" ? t("qb.good") : overallBand === "fail" ? t("qb.weak") : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center justify-center gap-1.5 h-8 w-[120px] rounded-md border text-xs font-medium transition-colors hover:opacity-90 ${trig.cls}`}
          title={isShort ? t("qb.tooShortTitle") : trigLabel}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="leading-none">{trig.icon}</span>
          <span>{trigLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-4 text-xs space-y-3" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm">{t("qb.title")}</div>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${overallBand === "ok" ? "text-emerald-400" : overallBand === "warning" ? "text-amber-400" : overallBand === "fail" ? "text-rose-400" : "text-muted-foreground"}`}>
            {isChecking ? t("qb.state.checking") : isShort ? t("qb.state.short") : isTimeout ? t("qb.state.timeout") : overallLabel ?? t("qb.state.noData")}
          </span>
        </div>

        {/* Overall progress bar */}
        {overall != null && (
          <div className="space-y-1">
            <div className="h-2 w-full rounded-full bg-muted/40 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${meta?.bar ?? "bg-muted"}`}
                style={{ width: `${overall}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
              <span>{t("qb.overall")}</span>
              <span className="font-semibold text-foreground">{overall}/100</span>
            </div>
          </div>
        )}

        {isShort && (
          <div className="text-muted-foreground text-[11px] leading-snug">
            {t("qb.tooShortBody")}
          </div>
        )}

        {!isShort && !noData && (
          <div className="space-y-2.5">
            {/* AI detector */}
            {data.ai_score != null && aiB && (
              <MetricRow
                emoji={BAND_META[aiB].dot}
                title={t("qb.metric.human")}
                value={t("qb.metric.humanValue", { n: String(data.ai_score) })}
                hint={aiHint(data.ai_score)}
              />
            )}
            {/* Burstiness */}
            {data.burstiness_score != null && burstB && (
              <MetricRow
                emoji={BAND_META[burstB].dot}
                title={t("qb.metric.rhythm")}
                value={`σ=${data.burstiness_score}`}
                hint={burstHint(Number(data.burstiness_score))}
              />
            )}
            {/* Keyword density */}
            {data.keyword_density_status && densB && (
              <MetricRow
                emoji={BAND_META[densB].dot}
                title={t("qb.metric.density")}
                value={data.keyword_density != null ? `${data.keyword_density}%${data.keyword_density_status === "overuse" ? "↑" : data.keyword_density_status === "underuse" ? "↓" : ""}` : "-"}
                hint={densityHint(data.keyword_density, data.keyword_density_status)}
              />
            )}
            {/* Turgenev — RU-only feature, hidden for EN UI */}
            {lang === "ru" && data.turgenev_score != null && turgB && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="cursor-help">
                      <MetricRow
                        emoji={BAND_META[turgB].dot}
                        title={t("qb.metric.turgenev")}
                        value={t("qb.metric.turgenevValue", { n: String(data.turgenev_score) })}
                        hint={turgHint(Number(data.turgenev_score))}
                      />
                    </div>
                  </TooltipTrigger>
                  {data.turgenev_details && (
                    <TooltipContent side="left" className="max-w-[260px] text-[11px] leading-snug">
                      <div className="font-medium mb-1">{t("qb.turg.badenTitle")}</div>
                      <div className="space-y-0.5">
                        <div>{t("qb.turg.repeats", { n: String(data.turgenev_details.repeats ?? 0) })}</div>
                        <div>{t("qb.turg.style", { n: String(data.turgenev_details.style ?? 0) })}</div>
                        <div>{t("qb.turg.spam", { n: String(data.turgenev_details.spam ?? 0) })}</div>
                        <div>{t("qb.turg.water", { n: String(data.turgenev_details.water ?? 0) })}</div>
                        <div>{t("qb.turg.read", { n: String(data.turgenev_details.readability ?? 0) })}</div>
                      </div>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            )}
            {/* Uniqueness (text.ru antiplagiat) - manual only */}
            {data.uniqueness_percent != null && (
              <MetricRow
                emoji={data.uniqueness_percent >= 85 ? "🟢" : data.uniqueness_percent >= 70 ? "🟡" : "🔴"}
                title={t("qb.metric.uniq")}
                value={`${data.uniqueness_percent}%`}
                hint={
                  data.uniqueness_percent >= 85
                    ? t("qb.uniq.great")
                    : data.uniqueness_percent >= 70
                    ? t("qb.uniq.mid")
                    : t("qb.uniq.low")
                }
              />
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-1.5 pt-1">
          {showImprove && (
            <Button
              size="sm"
              className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white border-0 shadow-md shadow-violet-500/20"
              onClick={runImprove}
              disabled={improving || rechecking}
            >
              {improving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
              {improving ? t("qb.act.running") : t("qb.act.improve")}
            </Button>
          )}
          {showRetry && (
            <Button size="sm" variant="outline" className="w-full" onClick={runRecheck} disabled={rechecking || improving}>
              {rechecking ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
              {rechecking ? t("qb.act.running") : t("qb.act.recheck")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={runUniqueness}
            disabled={checkingUniq || rechecking || improving}
            title={t("qb.act.uniqTitle")}
          >
            {checkingUniq ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
            {checkingUniq ? t("qb.act.starting") : t("qb.act.uniq")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="w-full text-[11px] h-7"
            onClick={(e) => {
              e.stopPropagation();
              if (onOpenVersions) onOpenVersions();
              else window.dispatchEvent(new CustomEvent("open-article-versions", { detail: { articleId } }));
            }}
          >
            <History className="h-3 w-3 mr-1" />
            {t("qb.act.history")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MetricRow({ emoji, title, value, hint }: { emoji: string; title: string; value: string; hint: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] leading-none">{emoji}</span>
          <span className="font-medium">{title}</span>
        </span>
        <span className="font-mono text-[11px] text-foreground/80 tabular-nums">{value}</span>
      </div>
      <div className="text-[10.5px] text-muted-foreground leading-snug pl-5">{hint}</div>
    </div>
  );
}