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
  "Анализ AI-паттернов",
  "Гуманизация текста",
  "Проверка Тургенева",
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
  const stepTimerRef = useRef<number | null>(null);
  const finishWaitRef = useRef<((r: any) => void) | null>(null);

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
          if (finishWaitRef.current && r.quality_status && r.quality_status !== "checking") {
            finishWaitRef.current(r);
            finishWaitRef.current = null;
          }
        })
      .subscribe();
    channelRef.current = ch;
    return () => {
      cancelled = true;
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
      if (stepTimerRef.current) { clearInterval(stepTimerRef.current); stepTimerRef.current = null; }
    };
  }, [articleId]);

  // Notify other editor buttons to disable themselves
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent("quality-improving", { detail: running })); } catch {}
  }, [running]);

  async function runImprove() {
    if (!articleId) { toast.error("Сначала сохраните статью"); return; }
    setRunning(true);
    setStep(1);
    setAfter(null);
    const snap: Snapshot = {
      ai: row.ai_score ?? null,
      turg: row.turgenev_score ?? null,
      content: currentContent,
    };
    setBefore(snap);

    // step ticker
    if (stepTimerRef.current) clearInterval(stepTimerRef.current);
    stepTimerRef.current = window.setInterval(() => {
      setStep((s) => (s < 3 ? s + 1 : s));
    }, 7000);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Сессия истекла");

      // Wait for realtime quality_status to settle (with timeout)
      const finished = new Promise<any>((resolve) => {
        finishWaitRef.current = resolve;
        setTimeout(() => { if (finishWaitRef.current) { finishWaitRef.current(null); finishWaitRef.current = null; } }, 180_000);
      });

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/improve-article`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ article_id: articleId }),
      });
      const payload = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(payload?.error || "Ошибка улучшения");
      if (payload?.cooldown) {
        toast.warning(payload.message || "Подождите перед повторной доработкой");
        setRunning(false);
        if (stepTimerRef.current) { clearInterval(stepTimerRef.current); stepTimerRef.current = null; }
        return;
      }

      // Wait for re-check to finish
      const finalRow = await finished;
      setStep(3);
      // Pull fresh content + scores
      const { data: fresh } = await supabase.from("articles")
        .select("ai_score,turgenev_score,content").eq("id", articleId).maybeSingle();
      const ai = (fresh?.ai_score ?? finalRow?.ai_score ?? null) as number | null;
      const turg = (fresh?.turgenev_score ?? finalRow?.turgenev_score ?? null) as number | null;
      setAfter({ ai, turg });
      if (fresh?.content && fresh.content !== currentContent) onRevertContent(fresh.content);
      toast.success("Готово ✓ Текст улучшен");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось улучшить");
    } finally {
      setRunning(false);
      if (stepTimerRef.current) { clearInterval(stepTimerRef.current); stepTimerRef.current = null; }
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
          {mode === "expert" && showLog && (
            <div className="text-[11px] space-y-0.5 pt-1 border-t border-border">
              <div className="text-emerald-400">✅ Анализ завершен</div>
              <div className="text-emerald-400">✅ Гуманизация выполнена</div>
              <div className="text-emerald-400">
                ✅ Тургенев {before.turg != null && after.turg != null ? `${before.turg} → ${after.turg}` : "проверен"}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button size="sm" className="gap-1" onClick={accept}>
              <Check className="h-3.5 w-3.5" /> Принять
            </Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={revert}>
              <X className="h-3.5 w-3.5" /> Отменить правки
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