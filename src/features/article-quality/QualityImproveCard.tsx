import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, Check, X, ChevronDown, ChevronUp } from "lucide-react";
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

const STEPS = [
  "Гуманизация (AI Score)",
  "Тургенев-фикс",
  "Финальная проверка",
];

function fmtAi(v: number | null) { return v == null ? "—" : `${Math.round(v)}%`; }
function fmtTurg(v: number | null) { return v == null ? "—" : `${v}`; }
function aiOk(v: number | null) { return v != null && v >= 70; }
function turgOk(v: number | null) { return v != null && v <= 5; }

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

  // Quality compare: lower AI is better, lower Turgenev is better.
  function isWorse(after: { ai: number | null; turg: number | null }, before: { ai: number | null; turg: number | null }, metric: "ai" | "turg"): boolean {
    const a = after[metric]; const b = before[metric];
    if (a == null || b == null) return false;
    if (metric === "ai") return a > b + 3; // tolerance
    return a > b; // turg
  }

  async function runImprove() {
    if (!articleId) { toast.error("Сначала сохраните статью"); return; }
    setRunning(true);
    setAfter(null);
    setWarning(null);
    setLogLines([]);
    setStep(0);

    try {
      // Snapshot ORIGINAL
      const origScores = await fetchScores();
      const origSnap: Snapshot = { ai: origScores.ai, turg: origScores.turg, content: origScores.content || currentContent };
      setBefore(origSnap);
      setBestSnapshot({ content: origSnap.content, ai: origSnap.ai, turg: origSnap.turg });
      log(`▶ Старт: AI ${fmtAi(origSnap.ai)}, Тургенев ${fmtTurg(origSnap.turg)}`);

      // ---- STEP 1: Humanize (Stealth Pass) ----
      setStep(1);
      log("Шаг 1/3: Гуманизация (Stealth Pass)...");
      const preStep1 = await fetchScores();
      const r1 = await callImprove("humanize");
      if (r1.cooldown) { toast.warning(r1.error || "Подождите"); throw new Error("cooldown"); }
      if (!r1.ok) { log(`✘ Гуманизация не выполнена: ${r1.error}`); }
      else {
        await waitForIdle();
        await runQualityCheck();
        const post1 = await fetchScores();
        if (isWorse(post1, preStep1, "ai")) {
          log(`⚠ Шаг 1 ухудшил AI (${fmtAi(preStep1.ai)} → ${fmtAi(post1.ai)}). Откат.`);
          await rollbackTo(preStep1.content);
        } else {
          log(`✅ Шаг 1: AI ${fmtAi(preStep1.ai)} → ${fmtAi(post1.ai)}`);
          // update best
          setBestSnapshot({ content: post1.content, ai: post1.ai, turg: post1.turg });
        }
      }

      // ---- STEP 2: Turgenev fix ----
      setStep(2);
      log("Шаг 2/3: Тургенев-фикс...");
      const preStep2 = await fetchScores();
      const r2 = await callImprove("turgenev");
      if (!r2.ok && !r2.cooldown) { log(`✘ Тургенев-фикс не выполнен: ${r2.error}`); }
      else if (r2.cooldown) { log("⚠ Тургенев-фикс пропущен (cooldown)"); }
      else {
        await waitForIdle();
        await runQualityCheck();
        const post2 = await fetchScores();
        const aiWorse = isWorse(post2, preStep2, "ai");
        const turgWorse = isWorse(post2, preStep2, "turg");
        if (aiWorse || turgWorse) {
          log(`⚠ Шаг 2 ухудшил результат - пропущен. Откат к тексту до Тургенев-фикса.`);
          setWarning("Шаг 2 ухудшил результат - пропущен");
          await rollbackTo(preStep2.content);
        } else {
          log(`✅ Шаг 2: Тургенев ${fmtTurg(preStep2.turg)} → ${fmtTurg(post2.turg)}, AI ${fmtAi(preStep2.ai)} → ${fmtAi(post2.ai)}`);
          setBestSnapshot({ content: post2.content, ai: post2.ai, turg: post2.turg });
        }
      }

      // ---- STEP 3: Final check ----
      setStep(3);
      log("Шаг 3/3: Финальная проверка...");
      await runQualityCheck();
      const finalScores = await fetchScores();
      setAfter({ ai: finalScores.ai, turg: finalScores.turg });
      if (finalScores.content && finalScores.content !== currentContent) onRevertContent(finalScores.content);

      const aiBetter = (finalScores.ai ?? 100) <= (origSnap.ai ?? 100);
      const turgBetter = (finalScores.turg ?? 99) <= (origSnap.turg ?? 99);
      if (aiBetter && turgBetter) {
        log(`✅ Готово: AI ${fmtAi(origSnap.ai)} → ${fmtAi(finalScores.ai)}, Тургенев ${fmtTurg(origSnap.turg)} → ${fmtTurg(finalScores.turg)}`);
        toast.success("Готово ✓ Текст улучшен");
      } else {
        const msg = `Один из показателей ухудшился. AI ${fmtAi(origSnap.ai)} → ${fmtAi(finalScores.ai)}, Тургенев ${fmtTurg(origSnap.turg)} → ${fmtTurg(finalScores.turg)}.`;
        log(`⚠ ${msg}`);
        setWarning(msg);
        toast.warning("Часть метрик ухудшилась - выберите вариант");
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
              : `Шаг ${step}/3 — ${STEPS[Math.max(0, step - 1)]}... ⏳`}
          </div>
          <Progress value={progressPct} className="h-2" />
          {mode === "expert" && (
            <div className="text-[11px] space-y-0.5 mt-2">
              {STEPS.map((s, i) => (
                <div key={i} className={i + 1 <= step ? (i + 1 < step ? "text-emerald-400" : "text-amber-300") : "text-muted-foreground"}>
                  {i + 1 < step ? "✅" : i + 1 === step ? "⏳" : "·"} {s}
                </div>
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

      {/* Idle state — improve button */}
      {!running && !(before && after) && (
        <Button
          className="w-full gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white"
          disabled={!articleId || !currentContent}
          onClick={runImprove}
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {mode === "quick" ? "Улучшить автоматически" : "Улучшить качество текста"}
        </Button>
      )}
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