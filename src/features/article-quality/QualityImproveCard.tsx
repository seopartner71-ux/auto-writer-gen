import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, Check, X, ChevronDown, ChevronUp, ShieldCheck, Info } from "lucide-react";
import { toast } from "sonner";

type Mode = "quick" | "expert";

interface Snapshot {
  ai: number | null;
  turg: number | null;
  content: string;
}
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

function fmtAi(v: number | null) { return v == null ? "—" : `${Math.round(v)}%`; }
function fmtTurg(v: number | null) { return v == null ? "—" : `${v}`; }
function aiOk(v: number | null) { return v != null && v >= AI_TARGET; }
function turgOk(v: number | null) { return v != null && v <= TURG_TARGET; }

export function QualityImproveCard({ mode, articleId, currentContent, onRevertContent }: Props) {
  const [row, setRow] = useState<any>({});
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0); // 0-3
  const [before, setBefore] = useState<Snapshot | null>(null);
  const [after, setAfter] = useState<{ ai: number | null; turg: number | null } | null>(null);
  const [showLog, setShowLog] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [bestSnapshot, setBestSnapshot] = useState<{ content: string; ai: number | null; turg: number | null } | null>(null);
  const [priority, setPriority] = useState<Priority>("auto");
  const [showSteps, setShowSteps] = useState(false);

  // Initial fetch + realtime
  useEffect(() => {
    setRow({}); setAfter(null); setBefore(null); setStep(0);
    if (!articleId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("articles")
        .select("ai_score,turgenev_score,quality_status,content")
        .eq("id", articleId).maybeSingle();
      if (!cancelled && data) setRow(data);
    })();
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
            content: r.content,
          }));
        })
      .subscribe();
    channelRef.current = ch;
    return () => {
      cancelled = true;
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    };
  }, [articleId]);

  // Notify other editor buttons to disable themselves
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent("quality-improving", { detail: running })); } catch {}
  }, [running]);

  function log(line: string) {
    setLogLines((l) => [...l, line]);
  }

  async function fetchScores(): Promise<{ ai: number | null; turg: number | null; content: string }> {
    const { data } = await supabase.from("articles")
      .select("ai_score,turgenev_score,content").eq("id", articleId!).maybeSingle();
    return {
      ai: (data?.ai_score ?? null) as number | null,
      turg: (data?.turgenev_score ?? null) as number | null,
      content: (data?.content ?? "") as string,
    };
  }

  async function waitForIdle(maxMs = 60_000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const { data } = await supabase.from("articles")
        .select("quality_status").eq("id", articleId!).maybeSingle();
      if ((data as any)?.quality_status !== "checking") return;
      await new Promise(r => setTimeout(r, 2500));
    }
  }

  async function runQualityCheck(): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Сессия истекла");
    const cur = await fetchScores();
    if (!cur.content) return;
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quality-check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ article_id: articleId, content: cur.content, mode: "auto" }),
    });
    await waitForIdle();
  }

  async function callImprove(fixType: "humanize" | "turgenev"): Promise<{ ok: boolean; cooldown?: boolean; error?: string }> {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { ok: false, error: "Сессия истекла" };
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/improve-article`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ article_id: articleId, fix_type: fixType }),
    });
    const payload = await resp.json().catch(() => null);
    if (!resp.ok) return { ok: false, error: payload?.error || `Ошибка ${resp.status}` };
    if (payload?.cooldown) return { ok: false, cooldown: true, error: payload?.message };
    return { ok: true };
  }

  async function rollbackTo(content: string) {
    await supabase.from("articles")
      .update({ content, updated_at: new Date().toISOString() })
      .eq("id", articleId!);
    onRevertContent(content);
  }

  // Higher ai_score = better (more human). Lower turgenev = better.
  // Returns true if `after` is meaningfully worse than `before` for the given metric.
  function isWorse(after: { ai: number | null; turg: number | null }, before: { ai: number | null; turg: number | null }, metric: "ai" | "turg", tol = 0): boolean {
    const a = after[metric]; const b = before[metric];
    if (a == null || b == null) return false;
    if (metric === "ai") return a < b - 3;            // human-likeness dropped >3pp
    return a > b + tol;                               // turgenev rose
  }

  function decideFix(scores: { ai: number | null; turg: number | null }, prio: Priority): "humanize" | "turgenev" | null {
    const aiBad = !aiOk(scores.ai);
    const turgBad = !turgOk(scores.turg);
    if (!aiBad && !turgBad) return null;
    if (prio === "ai") return aiBad ? "humanize" : null;
    if (prio === "turgenev") return turgBad ? "turgenev" : null;
    // auto: only critical one; if both bad — humanize first
    if (aiBad && !turgBad) return "humanize";
    if (turgBad && !aiBad) return "turgenev";
    return "humanize";
  }

  async function runOnePass(fix: "humanize" | "turgenev", passIdx: number): Promise<{ improved: boolean; rolledBack: boolean; scores: { ai: number | null; turg: number | null; content: string } }> {
    const pre = await fetchScores();
    log(`Проход ${passIdx}: ${fix === "humanize" ? "Гуманизация" : "Тургенев-фикс"}...`);
    const r = await callImprove(fix);
    if (r.cooldown) { log("⚠ Cooldown - подождите"); throw new Error("cooldown"); }
    if (!r.ok) { log(`✘ ${r.error}`); return { improved: false, rolledBack: false, scores: pre }; }
    await waitForIdle();
    await runQualityCheck();
    const post = await fetchScores();

    // Rollback rule: humanize must not raise turgenev > +2; turgenev must not drop ai > 3pp
    const turgWorseBig = fix === "humanize" && post.turg != null && pre.turg != null && post.turg > pre.turg + 2;
    const aiWorseBig = fix === "turgenev" && isWorse(post, pre, "ai");

    if (turgWorseBig || aiWorseBig) {
      log(`⚠ Проход ${passIdx} ухудшил противоположный показатель - откат.`);
      await rollbackTo(pre.content);
      return { improved: false, rolledBack: true, scores: pre };
    }

    // Track if the targeted metric actually improved
    const targetImproved = fix === "humanize"
      ? (post.ai != null && pre.ai != null && post.ai > pre.ai)
      : (post.turg != null && pre.turg != null && post.turg < pre.turg);
    log(`${targetImproved ? "✅" : "·"} Проход ${passIdx}: AI ${fmtAi(pre.ai)} → ${fmtAi(post.ai)}, Тургенев ${fmtTurg(pre.turg)} → ${fmtTurg(post.turg)}`);
    return { improved: targetImproved, rolledBack: false, scores: post };
  }

  async function runImprove() {
    if (!articleId) { toast.error("Сначала сохраните статью"); return; }
    setRunning(true);
    setAfter(null);
    setWarning(null);
    setLogLines([]);
    setStep(0);

    try {
      const origScores = await fetchScores();
      const origSnap: Snapshot = { ai: origScores.ai, turg: origScores.turg, content: origScores.content || currentContent };
      setBefore(origSnap);
      setBestSnapshot({ content: origSnap.content, ai: origSnap.ai, turg: origSnap.turg });
      log(`▶ Старт: AI ${fmtAi(origSnap.ai)}, Тургенев ${fmtTurg(origSnap.turg)}. Цель: AI ≥ ${AI_TARGET}%, Тургенев ≤ ${TURG_TARGET}.`);

      let cur = { ai: origSnap.ai, turg: origSnap.turg, content: origSnap.content };
      let stoppedReason = "";

      for (let pass = 1; pass <= MAX_PASSES; pass++) {
        setStep(pass);
        const fix = decideFix(cur, priority);
        if (!fix) { stoppedReason = "targets-met"; log("✅ Цели достигнуты - дальнейшие проходы не нужны."); break; }
        const res = await runOnePass(fix, pass);
        cur = res.scores;
        if (aiOk(cur.ai) && turgOk(cur.turg)) { stoppedReason = "targets-met"; log("✅ Оба показателя в норме."); break; }
        if (res.rolledBack) { stoppedReason = "balanced"; log("⚖ Достигнут баланс - дальнейшее улучшение ухудшает другой показатель."); break; }
        if (!res.improved) { stoppedReason = "no-progress"; log("· Прогресса нет - останавливаем."); break; }
      }
      if (!stoppedReason) { stoppedReason = "max-passes"; log(`⏹ Достигнут лимит в ${MAX_PASSES} прохода.`); }

      setStep(MAX_PASSES + 1);
      setAfter({ ai: cur.ai, turg: cur.turg });
      setBestSnapshot({ content: cur.content, ai: cur.ai, turg: cur.turg });
      if (cur.content && cur.content !== currentContent) onRevertContent(cur.content);

      const finalAiOk = aiOk(cur.ai);
      const finalTurgOk = turgOk(cur.turg);
      if (finalAiOk && finalTurgOk) {
        toast.success("Готово ✓ Оба показателя в норме");
      } else if (stoppedReason === "balanced" || stoppedReason === "no-progress" || stoppedReason === "max-passes") {
        const msg = `Достигнут оптимальный баланс. AI ${fmtAi(cur.ai)}, Тургенев ${fmtTurg(cur.turg)}. Дальнейшее улучшение одного будет ухудшать другой.`;
        setWarning(msg);
        toast.warning("Достигнут баланс");
      }
    } catch (e: any) {
      if (e?.message !== "cooldown") {
        toast.error(e?.message || "Не удалось улучшить");
        log(`✘ Ошибка: ${e?.message}`);
      }
    } finally {
      setRunning(false);
    }
  }

  async function acceptBest() {
    if (!articleId || !bestSnapshot) { setBefore(null); setAfter(null); setWarning(null); return; }
    try {
      await supabase.from("articles")
        .update({ content: bestSnapshot.content, updated_at: new Date().toISOString() })
        .eq("id", articleId);
      onRevertContent(bestSnapshot.content);
      setBefore(null); setAfter(null); setWarning(null);
      toast.success("Принят лучший вариант");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось применить");
    }
  }

  async function accept() {
    setBefore(null); setAfter(null);
    toast.success("Изменения приняты");
  }

  async function revert() {
    if (!before || !articleId) return;
    try {
      const { error } = await supabase.from("articles")
        .update({ content: before.content, updated_at: new Date().toISOString() })
        .eq("id", articleId);
      if (error) throw error;
      onRevertContent(before.content);
      setBefore(null); setAfter(null);
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
  const checking = row.quality_status === "checking" || running;
  const statusBlock = (() => {
    if (checking) return { dot: "🟡", text: "Проверяется...", cls: "text-amber-300" };
    if (!hasAny) return { dot: "⚪", text: "Нет данных", cls: "text-muted-foreground" };
    if (isOk) return { dot: "🟢", text: `Готово к публикации (AI ${fmtAi(ai)}, Тургенев ${fmtTurg(turg)})`, cls: "text-emerald-300" };
    return { dot: "🔴", text: `Требует улучшения (AI ${fmtAi(ai)}, Тургенев ${fmtTurg(turg)})`, cls: "text-rose-300" };
  })();

  const progressPct = !running ? 0 : Math.min(99, (step / 3) * 95);

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
          <div className="text-xs text-muted-foreground">
            {mode === "quick"
              ? "⏳ Улучшаем текст... подождите"
              : `Проход ${Math.min(step, MAX_PASSES)}/${MAX_PASSES} ⏳`}
          </div>
          <Progress value={progressPct} className="h-2" />
          {/* Always show what's happening right now */}
          {logLines.length > 0 && (
            <div className="text-[11px] text-muted-foreground italic">
              {logLines[logLines.length - 1]}
            </div>
          )}
          {mode === "expert" && logLines.length > 0 && (
            <div className="text-[11px] space-y-0.5 mt-2 max-h-32 overflow-y-auto font-mono">
              {logLines.slice(-6).map((l, i) => (
                <div key={i} className={
                  l.startsWith("✅") ? "text-emerald-400" :
                  l.startsWith("⚠") || l.startsWith("⚖") ? "text-amber-300" :
                  l.startsWith("✘") ? "text-rose-400" : "text-muted-foreground"
                }>{l}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Before/After card */}
      {!running && before && after && (
        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <Row label="AI Score" before={fmtAi(before.ai)} after={fmtAi(after.ai)} ok={aiOk(after.ai)} />
          <Row label="Тургенев"  before={fmtTurg(before.turg)} after={fmtTurg(after.turg)} ok={turgOk(after.turg)} />
          {warning && (
            <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
              ⚠️ {warning}
            </div>
          )}
          {mode === "expert" && (
            <button
              type="button"
              onClick={() => setShowLog(s => !s)}
              className="w-full mt-1 inline-flex items-center justify-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {showLog ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showLog ? "Скрыть детали" : "Детали"}
            </button>
          )}
          {mode === "expert" && showLog && logLines.length > 0 && (
            <div className="text-[11px] space-y-0.5 pt-1 border-t border-border max-h-40 overflow-y-auto font-mono">
              {logLines.map((l, i) => (
                <div key={i} className={
                  l.startsWith("✅") ? "text-emerald-400" :
                  l.startsWith("⚠") ? "text-amber-300" :
                  l.startsWith("✘") ? "text-rose-400" : "text-muted-foreground"
                }>{l}</div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button size="sm" className="gap-1" onClick={warning ? acceptBest : accept}>
              <Check className="h-3.5 w-3.5" /> {warning ? "Принять лучший" : "Принять"}
            </Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={revert}>
              <X className="h-3.5 w-3.5" /> {warning ? "Откатить все" : "Отменить правки"}
            </Button>
          </div>
        </div>
      )}

      {/* Idle state */}
      {!running && !(before && after) && (() => {
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
              className="w-full gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white"
              disabled={!articleId || !currentContent}
              onClick={runImprove}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {mode === "quick" ? "Улучшить автоматически" : "Улучшить качество текста"}
            </Button>
          </div>
        );
      })()}
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