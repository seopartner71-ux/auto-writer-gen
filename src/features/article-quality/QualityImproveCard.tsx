import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, Check, X, ChevronDown, ChevronUp, ShieldCheck, Info, StopCircle } from "lucide-react";
import { toast } from "sonner";
import { ImprovingTipsLoader } from "./ImprovingTipsLoader";

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

function actionLabel(a: CycleProgress["action"]): string {
  if (a === "humanize") return "Гуманизация";
  if (a === "turgenev") return "Тургенев-фикс";
  return "Подготовка";
}

function finalStatusLabel(s: CycleProgress["final_status"]): string {
  switch (s) {
    case "targets_met":  return "Оба показателя в норме";
    case "balanced":     return "Достигнут баланс - дальнейшее улучшение ухудшает другой показатель";
    case "no_progress":  return "Прогресса нет два прохода подряд";
    case "max_passes":   return `Достигнут лимит в ${MAX_PASSES} прохода`;
    case "stopped":      return "Остановлено пользователем";
    case "error":        return "Ошибка выполнения";
    case "turgenev_unavailable": return "Тургенев временно недоступен, улучшение по этой метрике отложено";
    default:             return "";
  }
}

function fmtDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function QualityImproveCard({ mode, articleId, currentContent, onRevertContent }: Props) {
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
      toast.message("Остановка запрошена - цикл завершится после текущего шага");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось остановить");
      setStopping(false);
    }
  }

  // Kick off the server-side cycle. Returns immediately (202); realtime + poll
  // pick up progress from articles.quality_details.cycle_progress.
  async function runImprove() {
    if (!articleId) { toast.error("Сначала сохраните статью"); return; }
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
      if (!token) throw new Error("Сессия истекла");
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
        toast.error(payload?.error || `Ошибка ${resp.status}`);
        return;
      }
      if (payload?.cooldown) {
        setStarting(false);
        startingSinceRef.current = null;
        if (startingTimerRef.current) { window.clearTimeout(startingTimerRef.current); startingTimerRef.current = null; }
        toast.message(payload?.message || "Подождите перед повторной доработкой");
        return;
      }
      toast.message("Цикл запущен. Можно закрыть или обновить страницу - работа продолжится на сервере.");
    } catch (e: any) {
      setStarting(false);
      startingSinceRef.current = null;
      if (startingTimerRef.current) { window.clearTimeout(startingTimerRef.current); startingTimerRef.current = null; }
      toast.error(e?.message || "Не удалось запустить");
    }
  }

  // Toast on cycle completion (one-shot per finished cycle).
  const lastNotifiedFinishRef = useRef<string | null>(null);
  useEffect(() => {
    if (!cycleFinished || !cycle) return;
    const key = cycle.finished_at || `${cycle.status}:${cycle.final_status}`;
    if (lastNotifiedFinishRef.current === key) return;
    lastNotifiedFinishRef.current = key;
    if (cycle.final_status === "targets_met") toast.success("Готово ✓ Оба показателя в норме");
    else if (cycle.final_status === "stopped") toast.message("Цикл остановлен");
    else if (cycle.final_status === "error") toast.error(cycle.error || "Ошибка выполнения цикла");
    else toast.warning("Достигнут баланс");
    // Sync editor content with server-applied best content.
    if (cycle.best?.content && cycle.best.content !== currentContent) {
      onRevertContent(cycle.best.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleFinished, cycle?.finished_at]);

  async function acceptBest() {
    // Server has already applied best content. Just close the card.
    setDismissed(true);
    toast.success("Принят лучший вариант");
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
      toast.success("Правки отменены");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось отменить");
    }
  }

  // Status indicator (expert)
  const ai = row.ai_score ?? null;
  const turg = row.turgenev_score ?? null;
  const isOk = aiOk(ai) && turgOk(turg);
  const hasAny = ai != null || turg != null;
  const statusBlock = (() => {
    if (running) return { dot: "🟡", text: "Проверяется...", cls: "text-amber-300" };
    if (!hasAny) return { dot: "⚪", text: "Нет данных", cls: "text-muted-foreground" };
    if (isOk) return { dot: "🟢", text: `Готово к публикации (AI ${fmtAi(ai)}, Тургенев ${fmtTurg(turg)})`, cls: "text-emerald-300" };
    return { dot: "🔴", text: `Требует улучшения (AI ${fmtAi(ai)}, Тургенев ${fmtTurg(turg)})`, cls: "text-rose-300" };
  })();

  const currentPass = Math.max(1, cycle?.pass || 1);
  const totalPasses = cycle?.of || MAX_PASSES;
  const progressPct = !running ? 0 : Math.min(99, (currentPass / (totalPasses + 1)) * 95);
  const elapsedMs = cycle?.started_at ? Math.max(0, nowTick - Date.parse(cycle.started_at)) : 0;
  const elapsedLabel = cycle?.started_at ? fmtDuration(elapsedMs) : "0:00";
  const subStepLabel = cycle?.sub_step && cycle.sub_step.trim().length > 0 ? cycle.sub_step : null;
  const passLine = cycle
    ? `Проход ${Math.min(currentPass, totalPasses)}/${totalPasses} · ${subStepLabel ?? actionLabel(cycle.action)}${cycle.rolled_back ? " (откат)" : ""} · ${elapsedLabel}`
    : "Запуск цикла...";
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
        <div className="text-sm font-semibold">Качество текста</div>
        {mode === "expert" && (
          <span className={`text-[11px] ${statusBlock.cls}`}>{statusBlock.dot} {statusBlock.text}</span>
        )}
      </div>

      {/* Running state */}
      {running && (
        <div className="space-y-2">
          {mode === "quick" ? (
            <div className="flex flex-col items-center gap-1.5 py-1">
              <ImprovingTipsLoader />
              {cycle?.started_at && (
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {elapsedLabel} · обычно 2-6 минут
                </div>
              )}
              {escalationLevel === "long" && (
                <div className="text-[11px] text-amber-300 text-center">
                  ⏱ Дольше обычного - можно остановить и забрать лучшее.
                </div>
              )}
              {escalationLevel === "stuck" && (
                <div className="text-[11px] text-rose-200 text-center">
                  ⚠ Похоже, цикл завис. Остановите и сохраните лучший результат.
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
                Обычно 2-6 минут. Работа идёт на сервере - F5 её не прервёт.
              </div>
              {escalationLevel === "long" && (
                <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
                  ⏱ Дольше обычного. Можно подождать ещё пару минут - или остановить и забрать лучший результат.
                </div>
              )}
              {escalationLevel === "stuck" && (
                <div className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/40 rounded px-2 py-1.5">
                  ⚠ Похоже, цикл завис. Остановите и сохраните лучшее - при следующем запуске мы автоматически сбросим зависший цикл.
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
            {stopping ? "Останавливаем..." : "Остановить"}
          </Button>
        </div>
      )}

      {/* Before/After card */}
      {!running && showBeforeAfter && cycle?.initial && cycle?.best && (
        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <Row label="AI Score" before={fmtAi(cycle.initial.ai ?? null)} after={fmtAi(cycle.best.ai ?? null)} ok={aiOk(cycle.best.ai ?? null)} />
          <Row label="Тургенев"  before={fmtTurg(cycle.initial.turg ?? null)} after={fmtTurg(cycle.best.turg ?? null)} ok={turgOk(cycle.best.turg ?? null)} />
          {finalMsg && (
            <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
              ⚠️ {finalMsg}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button size="sm" className="gap-1" onClick={acceptBest}>
              <Check className="h-3.5 w-3.5" /> Принять лучший
            </Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={revertAll} disabled={!cycle.initial.content}>
              <X className="h-3.5 w-3.5" /> Откатить все
            </Button>
          </div>
        </div>
      )}

      {/* Idle state */}
      {!running && !showBeforeAfter && (() => {
        const ready = articleId && currentContent && aiOk(ai) && turgOk(turg);
        if (ready) {
          return (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
              <div className="text-xs text-emerald-100">
                Статья готова. AI {fmtAi(ai)} (цель ≥{AI_TARGET}%), Тургенев {fmtTurg(turg)} (цель ≤{TURG_TARGET}).
              </div>
            </div>
          );
        }
        return (
          <div className="space-y-2">
            {mode === "expert" && (
              <div className="grid grid-cols-3 gap-1 text-[11px]">
                <button type="button" onClick={() => setPriority("auto")}
                  className={`rounded border px-2 py-1 ${priority === "auto" ? "border-violet-500 bg-violet-500/15 text-violet-100" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  Авто
                </button>
                <button type="button" onClick={() => setPriority("ai")}
                  className={`rounded border px-2 py-1 ${priority === "ai" ? "border-violet-500 bg-violet-500/15 text-violet-100" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  Меньше AI
                </button>
                <button type="button" onClick={() => setPriority("turgenev")}
                  className={`rounded border px-2 py-1 ${priority === "turgenev" ? "border-violet-500 bg-violet-500/15 text-violet-100" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  Тургенев
                </button>
              </div>
            )}
            <Button
              className="w-full gap-2"
              disabled={!articleId || !currentContent || starting}
              onClick={runImprove}
            >
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {mode === "quick" ? "Улучшить автоматически" : "Улучшить качество текста"}
            </Button>
            <button
              type="button"
              onClick={() => setShowSteps(s => !s)}
              className="w-full inline-flex items-center justify-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Info className="h-3 w-3" />
              {showSteps ? "Скрыть что делают шаги" : "Что произойдёт при нажатии?"}
              {showSteps ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {showSteps && (
              <div className="rounded-md border border-border bg-muted/20 p-2 text-[11px] space-y-1.5">
                <Step n="1" name="Гуманизация (Stealth Pass)" what="Чередует длину предложений, добавляет разговорные вставки. Снижает AI Score." />
                <Step n="2" name="Тургенев-фикс" what="Убирает канцеляризмы, разбивает длинные фразы, перефразирует повторы. Снижает балл Тургенева." />
                <Step n="3" name="Финальная проверка" what="Перепроверяет AI Score и Тургенев. Если шаг ухудшил метрики - откат." />
                <div className="pt-1.5 border-t border-border/60 text-muted-foreground/80 leading-snug">
                  Цель: AI ≥ {AI_TARGET}% (человечно), Тургенев ≤ {TURG_TARGET}. Максимум {MAX_PASSES} прохода. Цикл идёт на сервере - обновление страницы не прервёт его.
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