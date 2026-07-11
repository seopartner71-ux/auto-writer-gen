import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, Check, X, ChevronDown, ChevronUp, Info, StopCircle } from "lucide-react";
import { toast } from "sonner";
import { ImprovingTipsLoader } from "./ImprovingTipsLoader";
import { useI18n } from "@/shared/hooks/useI18n";
import { edgeErrorMessage } from "@/shared/utils/edgeError";

type Mode = "quick" | "expert";

interface Props {
  mode: Mode;
  articleId: string | null;
  currentContent: string;
  onRevertContent: (content: string) => void;
}

// Goals: AI Score >= 70 (human-likeness, i.e. <30% AI) AND Turgenev <= 5
const AI_TARGET = 70;     // ai_score in DB = human-likeness %; higher = better
const TURG_TARGET = 5;    // lower = better
const MAX_PASSES = 2;

type Priority = "auto" | "ai" | "turgenev";

// Server writes cycle_progress into articles.quality_details.
// See runImproveCycle in supabase/functions/improve-article/index.ts.
interface CycleProgress {
  status?: "running" | "done" | "stopped" | "error";
  final_status?: "targets_met" | "stopped" | "balanced" | "no_progress" | "max_passes" | "error" | "turgenev_unavailable";
  pass?: number;
  of?: number;
  action?: "humanize" | "turgenev" | null;
  sub_step?: string | null;
  sub_step_key?: string | null;
  initial?: { ai: number | null; turg: number | null; content?: string };
  best?: { ai: number | null; turg: number | null; content?: string };
  rolled_back?: boolean;
  rollback_reason?: string;
  error?: string;
  started_at?: string;
  pass_started_at?: string;
  finished_at?: string;
  updated_at?: string;
  priority?: Priority;
}

function fmtAi(v: number | null) { return v == null ? "-" : `${Math.round(v)}%`; }
function fmtTurg(v: number | null) { return v == null ? "-" : `${v}`; }
function aiOk(v: number | null) { return v != null && v >= AI_TARGET; }
function turgOk(v: number | null) { return v != null && v <= TURG_TARGET; }

function fmtDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function QualityImproveCard({ mode, articleId, currentContent, onRevertContent }: Props) {
  const { t, lang } = useI18n();
  const isEn = lang === "en";
  const actionLabel = (a: CycleProgress["action"]): string => {
    if (a === "humanize") return t("qic.step.humanize");
    if (a === "turgenev") return t("qic.step.turgenev");
    return t("qic.step.prep");
  };
  const finalStatusLabel = (s: CycleProgress["final_status"]): string => {
    switch (s) {
      case "targets_met":  return t("qic.stop.targets_met");
      case "balanced":     return t("qic.stop.balanced");
      case "no_progress":  return t("qic.stop.no_progress");
      case "max_passes":   return t("qic.stop.max_passes", { n: String(MAX_PASSES) });
      case "stopped":      return t("qic.stop.stopped");
      case "error":        return t("qic.stop.error");
      case "turgenev_unavailable": return t("qic.stop.turgenev_unavailable");
      default:             return "";
    }
  };
  const [row, setRow] = useState<any>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pollRef = useRef<number | null>(null);
  const [priority, setPriority] = useState<Priority>("auto");
  const [showSteps, setShowSteps] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [dismissed, setDismissed] = useState(false); // hide before/after card after user acted
  const [starting, setStarting] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const startingSinceRef = useRef<number | null>(null);
  const startingTimerRef = useRef<number | null>(null);

  // 1s ticker while cycle is running, so the elapsed-time label updates.
  useEffect(() => {
    if (!articleId) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [articleId]);

  // Initial fetch + realtime + 5s polling fallback (server orchestrates the cycle;
  // this card just reads state from articles.quality_details.cycle_progress).
  useEffect(() => {
    setRow({}); setDismissed(false);
    if (!articleId) return;
    let cancelled = false;
    const fetchRow = async () => {
      const { data } = await supabase.from("articles")
        .select("ai_score,turgenev_score,quality_status,quality_details,content")
        .eq("id", articleId).maybeSingle();
      if (!cancelled && data) setRow(data);
    };
    fetchRow();
    const ch = supabase.channel(`improve-card-${articleId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "articles", filter: `id=eq.${articleId}` },
        (p: any) => {
          const r = p?.new || {};
          setRow((d: any) => ({
            ...d,
            ai_score: r.ai_score,
            turgenev_score: r.turgenev_score,
            quality_status: r.quality_status,
            quality_details: r.quality_details,
            content: r.content,
          }));
        })
      .subscribe();
    channelRef.current = ch;
    // Realtime can drop under load / RU-proxy; poll every 5s as a safety net.
    pollRef.current = window.setInterval(fetchRow, 5000);
    return () => {
      cancelled = true;
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
      if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [articleId]);

  const cycle: CycleProgress | null = (row.quality_details && typeof row.quality_details === "object")
    ? (row.quality_details.cycle_progress ?? null)
    : null;

  // Derive running/finished state entirely from server truth - survives F5.
  const running =
    starting ||
    row.quality_status === "improving" ||
    row.quality_status === "checking" ||
    cycle?.status === "running";

  // Auto-clear stuck `starting` state. If the server hasn't reflected a running
  // cycle within 20s of us kicking it off, the request either 404/timed out or
  // the server accepted but never wrote cycle_progress. Either way we must not
  // leave the overlay up forever. Also: if the DB shows a *finished* cycle
  // while `starting` is still true (e.g. stale realtime returning the old
  // "done" row after our POST), clear it so `running` collapses to server truth.
  useEffect(() => {
    if (!starting) return;
    const started = startingSinceRef.current ?? 0;
    const serverRunning =
      row.quality_status === "improving" ||
      row.quality_status === "checking" ||
      cycle?.status === "running";
    if (serverRunning) {
      // Server picked it up - no longer need the client-side flag.
      setStarting(false);
      startingSinceRef.current = null;
      return;
    }
    // If DB explicitly shows a terminal cycle newer than our start moment, drop it.
    const cycleUpdated = cycle?.updated_at ? Date.parse(cycle.updated_at) : 0;
    const terminal = cycle?.status === "done" || cycle?.status === "stopped" || cycle?.status === "error";
    if (terminal && cycleUpdated > 0 && cycleUpdated >= started) {
      setStarting(false);
      startingSinceRef.current = null;
    }
  }, [starting, row.quality_status, cycle?.status, cycle?.updated_at]);

  const cycleFinished = !running && cycle && (cycle.status === "done" || cycle.status === "stopped" || cycle.status === "error");

  // Notify other editor buttons to disable themselves
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent("quality-improving", { detail: running })); } catch {}
  }, [running]);

  // Reset stopping when the improve cycle ends
  useEffect(() => {
    if (!running) setStopping(false);
    if (!running) setStarting(false);
  }, [running]);

  async function requestStop() {
    if (!articleId) return;
    setStopping(true);
    try {
      await supabase
        .from("articles")
        .update({ improve_stop_requested: true } as any)
        .eq("id", articleId);
      toast.message(t("qic.stopRequested"));
    } catch (e: any) {
      toast.error(e?.message || t("qic.stopFailed"));
      setStopping(false);
    }
  }

  // Kick off the server-side cycle. Returns immediately (202); realtime + poll
  // pick up progress from articles.quality_details.cycle_progress.
  async function runImprove() {
    if (!articleId) { toast.error(t("qic.needSaveFirst")); return; }
    setStarting(true);
    startingSinceRef.current = Date.now();
    if (startingTimerRef.current) window.clearTimeout(startingTimerRef.current);
    // Hard safety: never keep the overlay up longer than 25s waiting for the
    // server to write cycle_progress. If we hit this, the cycle either failed
    // to start or the client lost visibility of the write.
    startingTimerRef.current = window.setTimeout(() => {
      setStarting(false);
      startingSinceRef.current = null;
    }, 25_000) as unknown as number;
    setDismissed(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error(t("qic.sessionExpired"));
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/improve-article`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ article_id: articleId, cycle: true, priority }),
      });
      const payload = await resp.json().catch(() => null);
      const httpOk = resp.ok || resp.status === 202;
      if (!httpOk) {
        setStarting(false);
        startingSinceRef.current = null;
        if (startingTimerRef.current) { window.clearTimeout(startingTimerRef.current); startingTimerRef.current = null; }
        toast.error(edgeErrorMessage(payload, lang, t("qic.errorN", { n: String(resp.status) })));
        return;
      }
      if (payload?.cooldown) {
        setStarting(false);
        startingSinceRef.current = null;
        if (startingTimerRef.current) { window.clearTimeout(startingTimerRef.current); startingTimerRef.current = null; }
        toast.message(payload?.message || t("qic.cooldown"));
        return;
      }
      toast.message(t("qic.started"));
    } catch (e: any) {
      setStarting(false);
      startingSinceRef.current = null;
      if (startingTimerRef.current) { window.clearTimeout(startingTimerRef.current); startingTimerRef.current = null; }
      toast.error(e?.message || t("qic.failedStart"));
    }
  }

  // Toast on cycle completion (one-shot per finished cycle).
  const lastNotifiedFinishRef = useRef<string | null>(null);
  useEffect(() => {
    if (!cycleFinished || !cycle) return;
    const key = cycle.finished_at || `${cycle.status}:${cycle.final_status}`;
    if (lastNotifiedFinishRef.current === key) return;
    lastNotifiedFinishRef.current = key;
    if (cycle.final_status === "targets_met") toast.success(t("qic.done.targets"));
    else if (cycle.final_status === "stopped") toast.message(t("qic.done.stopped"));
    else if (cycle.final_status === "error") toast.error(cycle.error || t("qic.done.error"));
    else toast.warning(t("qic.done.balance"));
    // Sync editor content with server-applied best content.
    if (cycle.best?.content && cycle.best.content !== currentContent) {
      onRevertContent(cycle.best.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleFinished, cycle?.finished_at]);

  async function acceptBest() {
    // Server has already applied best content. Just close the card.
    setDismissed(true);
    toast.success(t("qic.acceptBest"));
  }

  async function revertAll() {
    if (!articleId || !cycle?.initial?.content) { setDismissed(true); return; }
    try {
      const { error } = await supabase.from("articles")
        .update({ content: cycle.initial.content, updated_at: new Date().toISOString() })
        .eq("id", articleId);
      if (error) throw error;
      onRevertContent(cycle.initial.content);
      setDismissed(true);
      toast.success(t("qic.revertDone"));
    } catch (e: any) {
      toast.error(e?.message || t("qic.revertFailed"));
    }
  }

  // Status indicator (expert)
  const ai = row.ai_score ?? null;
  const turg = row.turgenev_score ?? null;
  const isOk = aiOk(ai) && turgOk(turg);
  const hasAny = ai != null || turg != null;
  const statusBlock = (() => {
    if (running) return { dotCls: "bg-amber-400", text: t("qic.status.checking"), cls: "text-amber-300" };
    if (!hasAny) return { dotCls: "bg-muted-foreground/50", text: t("qic.status.noData"), cls: "text-muted-foreground" };
    if (isOk) return { dotCls: "bg-emerald-400", text: t("qic.status.ready"), cls: "text-emerald-300" };
    return { dotCls: "bg-rose-400", text: t("qic.status.needImprove"), cls: "text-rose-300" };
  })();

  const currentPass = Math.max(1, cycle?.pass || 1);
  const totalPasses = cycle?.of || MAX_PASSES;
  const progressPct = !running ? 0 : Math.min(99, (currentPass / (totalPasses + 1)) * 95);
  const elapsedMs = cycle?.started_at ? Math.max(0, nowTick - Date.parse(cycle.started_at)) : 0;
  const elapsedLabel = cycle?.started_at ? fmtDuration(elapsedMs) : "0:00";
  const subStepKey = cycle?.sub_step_key && cycle.sub_step_key.trim().length > 0 ? cycle.sub_step_key : null;
  const translatedSubStep = subStepKey ? t(subStepKey) : null;
  const subStepLabel = translatedSubStep && translatedSubStep !== subStepKey
    ? translatedSubStep
    : (cycle?.sub_step && cycle.sub_step.trim().length > 0 ? cycle.sub_step : null);
  const passLine = cycle
    ? t("qic.passLine", {
        p: String(Math.min(currentPass, totalPasses)),
        t: String(totalPasses),
        step: subStepLabel ?? actionLabel(cycle.action),
        roll: cycle.rolled_back ? t("qic.rollback") : "",
        elapsed: elapsedLabel,
      })
    : t("qic.launching");
  const escalationLevel: "none" | "long" | "stuck" =
    running && elapsedMs >= 10 * 60 * 1000 ? "stuck"
    : running && elapsedMs >= 7 * 60 * 1000 ? "long"
    : "none";

  // Before/after card is derived from server truth
  const showBeforeAfter = !!(cycleFinished && cycle && !dismissed && cycle.initial);
  const finalMsg = cycle?.final_status && cycle.final_status !== "targets_met"
    ? finalStatusLabel(cycle.final_status)
    : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{t("qic.cardTitle")}</div>
        {mode === "expert" && (
          <span className={`inline-flex items-center gap-1.5 text-[11px] ${statusBlock.cls}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${statusBlock.dotCls}`} />
            {statusBlock.text}
          </span>
        )}
      </div>

      {/* Compact metric bars — visible whenever we have any score and not mid-cycle */}
      {!running && hasAny && (
        <div className={`grid ${isEn ? "grid-cols-1" : "grid-cols-2"} gap-2`}>
          <MetricBar
            label={t("qic.metric.human")}
            valueLabel={fmtAi(ai)}
            hint={t("qic.metric.aiTarget", { n: String(AI_TARGET) })}
            pct={ai == null ? 0 : Math.max(0, Math.min(100, ai))}
            ok={aiOk(ai)}
          />
          {!isEn && <MetricBar
            label={t("qic.metric.turgenev")}
            valueLabel={fmtTurg(turg)}
            hint={t("qic.metric.turgTarget", { n: String(TURG_TARGET) })}
            /* inverted scale: lower = better; render fill inversely */
            pct={turg == null ? 0 : Math.max(0, Math.min(100, 100 - Math.min(20, turg) * 5))}
            ok={turgOk(turg)}
          />}
        </div>
      )}

      {/* Running state */}
      {running && (
        <div className="space-y-2">
          {mode === "quick" ? (
            <div className="flex flex-col items-center gap-1.5 py-1">
              <ImprovingTipsLoader />
              {cycle?.started_at && (
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {elapsedLabel} · {t("qic.usual")}
                </div>
              )}
              {escalationLevel === "long" && (
                <div className="text-[11px] text-amber-300 text-center">
                  {t("qic.long")}
                </div>
              )}
              {escalationLevel === "stuck" && (
                <div className="text-[11px] text-rose-200 text-center">
                  {t("qic.stuck")}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">
                {passLine} ⏳
              </div>
              <Progress value={progressPct} className="h-2" />
              <div className="text-[11px] text-muted-foreground/80">
                {t("qic.serverNote")}
              </div>
              {escalationLevel === "long" && (
                <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
                  {t("qic.longBlock")}
                </div>
              )}
              {escalationLevel === "stuck" && (
                <div className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/40 rounded px-2 py-1.5">
                  {t("qic.stuckBlock")}
                </div>
              )}
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1.5 border-rose-500/40 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
            onClick={requestStop}
            disabled={stopping}
          >
            {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <StopCircle className="h-3.5 w-3.5" />}
            {stopping ? t("qic.stopping") : t("qic.stop")}
          </Button>
        </div>
      )}

      {/* Before/After card */}
      {!running && showBeforeAfter && cycle?.initial && cycle?.best && (
        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <Row label={t("qic.row.ai")} before={fmtAi(cycle.initial.ai ?? null)} after={fmtAi(cycle.best.ai ?? null)} ok={aiOk(cycle.best.ai ?? null)} />
          {!isEn && <Row label={t("qic.row.turg")}  before={fmtTurg(cycle.initial.turg ?? null)} after={fmtTurg(cycle.best.turg ?? null)} ok={turgOk(cycle.best.turg ?? null)} />}
          {finalMsg && (
            <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
              ⚠️ {finalMsg}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button size="sm" className="gap-1" onClick={acceptBest}>
              <Check className="h-3.5 w-3.5" /> {t("qic.acceptBtn")}
            </Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={revertAll} disabled={!cycle.initial.content}>
              <X className="h-3.5 w-3.5" /> {t("qic.revertBtn")}
            </Button>
          </div>
        </div>
      )}

      {/* Idle state */}
      {!running && !showBeforeAfter && (() => {
        const ready = articleId && currentContent && aiOk(ai) && turgOk(turg);
        if (ready) return null;
        return (
          <div className="space-y-2">
            {mode === "expert" && (
              <div className={`grid ${isEn ? "grid-cols-2" : "grid-cols-3"} gap-1 text-[11px]`}>
                <button type="button" onClick={() => setPriority("auto")}
                  className={`rounded border px-2 py-1 ${priority === "auto" ? "border-violet-500 bg-violet-500/15 text-violet-100" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  {t("qic.priority.auto")}
                </button>
                <button type="button" onClick={() => setPriority("ai")}
                  className={`rounded border px-2 py-1 ${priority === "ai" ? "border-violet-500 bg-violet-500/15 text-violet-100" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  {t("qic.priority.ai")}
                </button>
                {!isEn && <button type="button" onClick={() => setPriority("turgenev")}
                  className={`rounded border px-2 py-1 ${priority === "turgenev" ? "border-violet-500 bg-violet-500/15 text-violet-100" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  {t("qic.priority.turg")}
                </button>}
              </div>
            )}
            <Button
              className="w-full gap-2"
              disabled={!articleId || !currentContent || starting}
              onClick={runImprove}
            >
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {mode === "quick" ? t("qic.btn.quick") : t("qic.btn.expert")}
            </Button>
            <button
              type="button"
              onClick={() => setShowSteps(s => !s)}
              className="w-full inline-flex items-center justify-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Info className="h-3 w-3" />
              {showSteps ? t("qic.hideSteps") : t("qic.showSteps")}
              {showSteps ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {showSteps && (
              <div className="rounded-md border border-border bg-muted/20 p-2 text-[11px] space-y-1.5">
                <Step n="1" name={t("qic.step1.name")} what={t("qic.step1.what")} />
                {!isEn && <Step n="2" name={t("qic.step2.name")} what={t("qic.step2.what")} />}
                <Step n={isEn ? "2" : "3"} name={t("qic.step3.name")} what={t("qic.step3.what")} />
                <div className="pt-1.5 border-t border-border/60 text-muted-foreground/80 leading-snug">
                  {isEn
                    ? t("qic.goalEn", { ai: String(AI_TARGET), p: String(MAX_PASSES) })
                    : t("qic.goal", { ai: String(AI_TARGET), t: String(TURG_TARGET), p: String(MAX_PASSES) })}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function Step({ n, name, what }: { n: string; name: string; what: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-violet-300 font-mono shrink-0">{n}.</span>
      <div className="flex-1">
        <div className="text-foreground font-medium">{name}</div>
        <div className="text-muted-foreground leading-snug">{what}</div>
      </div>
    </div>
  );
}

function Row({ label, before, after, ok }: { label: string; before: string; after: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono tabular-nums">
        <span className="text-muted-foreground">{before}</span>
        <span className="mx-1.5">→</span>
        <span className={ok ? "text-emerald-400" : "text-amber-300"}>{after}</span>
        <span className="ml-1.5">{ok ? "✅" : "⚠️"}</span>
      </span>
    </div>
  );
}

function MetricBar({
  label, valueLabel, hint, pct, ok,
}: { label: string; valueLabel: string; hint: string; pct: number; ok: boolean }) {
  const barCls = ok ? "bg-emerald-500" : "bg-amber-500";
  const valueCls = ok ? "text-emerald-300" : "text-amber-300";
  return (
    <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className={`text-xs font-mono tabular-nums ${valueCls}`}>{valueLabel}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${barCls} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground/80">{hint}</div>
    </div>
  );
}