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

export interface QualityResult {
  turgenev_score: number | null;
  uniqueness_percent: number | null;
  ai_human_score: number | null;
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
  const totalCost = (useBenchmark && onBenchmarkOptimize && benchmarkReady ? 1 : 0) + 1 + 0 + 1;

  // Load existing quality data when article changes
  useEffect(() => {
    if (!articleId) {
      setResult({ turgenev_score: null, uniqueness_percent: null, ai_human_score: null, quality_badge: null });
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("articles")
        .select("turgenev_score,uniqueness_percent,ai_human_score,quality_badge,quality_details,quality_checked_at")
        .eq("id", articleId)
        .maybeSingle();
      if (data) {
        setResult({
          turgenev_score: data.turgenev_score ?? null,
          uniqueness_percent: data.uniqueness_percent ?? null,
          ai_human_score: data.ai_human_score ?? null,
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
        else if (data.uniqueness_percent !== null) toast.success(`Уникальность: ${data.uniqueness_percent}%`);
        return;
      }
      if (attempts > 36) { setUniqPending(false); return; } // ~3 min
      setTimeout(tick, 5000);
    };
    const t = setTimeout(tick, 5000);
    return () => { stopped = true; clearTimeout(t); };
  }, [articleId, uniqPending]);

  const isLoading = (k: string) => loadingSet.has(k);

  async function runChecks(checks: string[], opts?: { confirmCredit?: boolean }) {
    if (!articleId) {
      toast.error("Сначала сохраните статью");
      return;
    }
    if (!content || content.replace(/<[^>]+>/g, "").trim().length < 200) {
      toast.error("Текст слишком короткий для проверки (минимум 200 символов)");
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
        toast.error(msg + (data.credit_refunded ? " Кредит возвращён." : ""), {
          duration: 10000,
          action: (isBalance || isKey)
            ? {
                label: isBalance ? "Пополнить" : "В поддержку",
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
            ? "Проверка уникальности использует API Text.ru. Пополните баланс нейросимволов или напишите нам - поможем."
            : isKey
            ? "Откройте раздел Поддержка - мы быстро обновим ключ TEXTRU_API_KEY."
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
        toast.info("Уникальность проверяется через Text.ru (до 2 минут)...", { duration: 6000 });
      } else if (!data?.uniqueness_error) {
        toast.success("Проверка завершена");
      }
    } catch (e: any) {
      toast.error(e?.message || "Ошибка проверки");
    } finally {
      const after = new Set(loadingSet);
      checks.forEach((c) => after.delete(c));
      setLoadingSet(after);
    }
  }

  async function shareCard() {
    const lines = [
      "СЕО-Модуль - Проверка качества",
      "",
      result.turgenev_score !== null ? `Качество текста: ${result.turgenev_score}/10 баллов риска` : null,
      result.uniqueness_percent !== null ? `Уникальность: ${result.uniqueness_percent}%` : null,
      result.ai_human_score !== null ? `AI-детектор: ${result.ai_human_score}% человек` : null,
      "",
      "Создано на seo-modul.pro",
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(lines);
      toast.success("Результат скопирован в буфер");
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  const sScore = statusOf(result.turgenev_score, "turgenev");
  const sUniq = statusOf(result.uniqueness_percent, "uniq");
  const sAi = statusOf(result.ai_human_score, "ai");

  const badgeMeta = result.quality_badge === "excellent"
    ? { icon: Trophy,        label: "Отлично - готово к публикации", cls: "text-emerald-400", bg: "from-emerald-500/15 to-emerald-500/5", border: "border-emerald-500/30" }
    : result.quality_badge === "good"
    ? { icon: ThumbsUp,      label: "Хорошо - можно публиковать",    cls: "text-amber-400",   bg: "from-amber-500/15 to-amber-500/5",     border: "border-amber-500/30" }
    : result.quality_badge === "needs_work"
    ? { icon: AlertTriangle, label: "Требует доработки",             cls: "text-rose-400",    bg: "from-rose-500/15 to-rose-500/5",       border: "border-rose-500/30" }
    : null;

  // progress mappings
  const scoreProgress = result.turgenev_score !== null ? Math.max(0, 100 - result.turgenev_score * 10) : 0;
  const uniqProgress  = result.uniqueness_percent ?? 0;
  const aiProgress    = result.ai_human_score ?? 0;

  const loadingFree = isLoading("score") || isLoading("ai");
  const loadingUniq = isLoading("uniqueness");

  async function autoImproveToTop() {
    if (!articleId) {
      toast.error("Сначала сохраните статью");
      return;
    }
    if (!onHumanize) {
      toast.error("Гуманизация недоступна в этом контексте");
      return;
    }
    if (!content || content.replace(/<[^>]+>/g, "").trim().length < 200) {
      toast.error("Текст слишком короткий (минимум 200 символов)");
      return;
    }
    setAutoImproving(true);
    setStepStates({
      benchmark: useBenchmark && onBenchmarkOptimize && benchmarkReady ? "pending" : "done",
      humanize: "pending", score: "pending", uniqueness: "pending",
    });
    try {
      if (useBenchmark && onBenchmarkOptimize && benchmarkReady) {
        setStepStates(s => ({ ...s, benchmark: "running" }));
        try { await onBenchmarkOptimize(); setStepStates(s => ({ ...s, benchmark: "done" })); }
        catch (e) { setStepStates(s => ({ ...s, benchmark: "error" })); throw e; }
      }
      setStepStates(s => ({ ...s, humanize: "running" }));
      try { await onHumanize(); setStepStates(s => ({ ...s, humanize: "done" })); }
      catch (e) { setStepStates(s => ({ ...s, humanize: "error" })); throw e; }
      setStepStates(s => ({ ...s, score: "running" }));
      try { await runChecks(["score", "ai"]); setStepStates(s => ({ ...s, score: "done" })); }
      catch (e) { setStepStates(s => ({ ...s, score: "error" })); throw e; }
      setStepStates(s => ({ ...s, uniqueness: "running" }));
      try { await runChecks(["uniqueness"]); setStepStates(s => ({ ...s, uniqueness: "done" })); }
      catch (e) { setStepStates(s => ({ ...s, uniqueness: "error" })); throw e; }
      toast.success("Готово - текст доведен до ТОПа. Проверьте вердикт выше.");
      setTimeout(() => setAutoDialogOpen(false), 800);
    } catch (e: any) {
      toast.error(e?.message || "Ошибка Auto-Improve");
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
              <div className="text-sm font-semibold leading-tight">Проверка качества</div>
              <div className="text-[10px] text-muted-foreground leading-tight">
                {result.checked_at
                  ? `Обновлено ${new Date(result.checked_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}`
                  : "Запустите проверку для оценки текста"}
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
              <div className="text-xs">Score и AI-детектор бесплатны. Уникальность через Text.ru стоит 1 кредит.</div>
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
            title="СЕО-Модуль Score"
            hint={result.details?.score_details ? `Стилистика ${result.details.score_details.stylistics}/10 - Вода ${result.details.score_details.water}/10` : "Аналог Тургенева - меньше баллов лучше"}
            value={result.turgenev_score !== null ? String(result.turgenev_score) : "-"}
            suffix={result.turgenev_score !== null ? "из 10 баллов риска" : undefined}
            status={sScore}
            progress={scoreProgress}
          />
          <MetricRow
            icon={ShieldCheck}
            title="Уникальность"
            hint={uniqPending ? "Идет проверка через Text.ru..." : (result.details?.uniqueness_details?.words ? `${result.details.uniqueness_details.words} слов - Text.ru` : "Антиплагиат через Text.ru")}
            value={uniqPending ? "..." : (result.uniqueness_percent !== null ? `${result.uniqueness_percent}%` : "-")}
            status={sUniq}
            progress={uniqProgress}
          />
          <MetricRow
            icon={BrainCircuit}
            title="AI-детектор"
            hint={result.details?.ai_details?.verdict ? `Вердикт: ${result.details.ai_details.verdict}` : "Шкала человечности 0-100"}
            value={result.ai_human_score !== null ? `${result.ai_human_score}%` : "-"}
            suffix={result.ai_human_score !== null ? "человек" : undefined}
            status={sAi}
            progress={aiProgress}
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 border-t border-border/40 bg-muted/10 p-3">
          {onHumanize ? (
            <Button
              size="sm"
              disabled={autoImproving || loadingFree || loadingUniq || uniqPending}
              onClick={() => setAutoDialogOpen(true)}
              className="h-11 font-semibold text-white bg-gradient-to-r from-purple-600 via-fuchsia-600 to-blue-600 hover:from-purple-700 hover:via-fuchsia-700 hover:to-blue-700 hover:scale-[1.01] transition-all shadow-[0_0_24px_-8px_hsl(var(--primary)/0.6)]"
            >
              {autoImproving
                ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Доводим до ТОПа...</>
                : <><Rocket className="h-4 w-4 mr-1.5" /> Довести до ТОПа <span className="ml-1.5 text-[10px] opacity-80">~2 ₵</span></>}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={loadingFree || loadingUniq || uniqPending}
              onClick={() => runChecks(["score", "ai", "uniqueness"]) }
              className="h-11 font-semibold text-white bg-gradient-to-r from-purple-600 via-fuchsia-600 to-blue-600 hover:from-purple-700 hover:via-fuchsia-700 hover:to-blue-700 hover:scale-[1.01] transition-all"
            >
              {loadingFree || loadingUniq
                ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Проверяем...</>
                : <><Sparkles className="h-4 w-4 mr-1.5" /> Проверить качество <span className="ml-1.5 text-[10px] opacity-80">1 ₵</span></>}
            </Button>
          )}
          <div className="flex items-center justify-between text-[11px]">
            <button
              type="button"
              disabled={loadingFree}
              onClick={() => runChecks(["score", "ai"])}
              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {loadingFree ? "Анализ..." : "Только бесплатные (Score + AI)"}
            </button>
            {badgeMeta && (
              <button
                type="button"
                onClick={shareCard}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Share2 className="h-3 w-3" /> Поделиться
              </button>
            )}
          </div>
        </div>
      </Card>

      <AlertDialog open={autoDialogOpen} onOpenChange={setAutoDialogOpen}>
        <AlertDialogContent className="border-border/60 bg-gradient-to-b from-card to-card/80 backdrop-blur-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-purple-500/20 to-blue-500/20 text-purple-400">
                <Rocket className="h-3.5 w-3.5" />
              </div>
              Auto-Improve to TOP
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="pt-2 space-y-3">
                <div className="text-sm text-muted-foreground">
                  Запустим полный цикл доводки текста до уровня публикации:
                </div>
                <div className="space-y-2">
                  <div className="flex items-start gap-3 rounded-lg border border-border/40 bg-muted/20 p-2.5">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary">1</div>
                    <div className="flex-1 text-xs">
                      <div className="font-medium text-foreground">Humanize Fix</div>
                      <div className="text-muted-foreground">Перепишем AI-абзацы под живой стиль</div>
                    </div>
                    <span className="text-[10px] text-muted-foreground">1 ₵</span>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg border border-border/40 bg-muted/20 p-2.5">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary">2</div>
                    <div className="flex-1 text-xs">
                      <div className="font-medium text-foreground">Score + AI-детектор</div>
                      <div className="text-muted-foreground">Стилистика, вода, человечность</div>
                    </div>
                    <span className="text-[10px] text-emerald-400">free</span>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg border border-border/40 bg-muted/20 p-2.5">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary">3</div>
                    <div className="flex-1 text-xs">
                      <div className="font-medium text-foreground">Уникальность Text.ru</div>
                      <div className="text-muted-foreground">Антиплагиат - норма 85%+</div>
                    </div>
                    <span className="text-[10px] text-muted-foreground">1 ₵</span>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                  <span className="text-xs text-muted-foreground">Итого спишется</span>
                  <span className="text-sm font-semibold text-foreground">{useBenchmark && onBenchmarkOptimize && benchmarkReady ? "~3 кредита" : "~2 кредита"}</span>
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
                        Учесть конкурентов TOP-10
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        {benchmarkReady
                          ? "Перепишем под медианы TOP-10: объем, LSI, сущности. +1 ₵, +60 сек"
                          : "Сначала откройте вкладку Benchmark и нажмите 'Загрузить Benchmark'"}
                      </div>
                    </div>
                  </label>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={autoImproveToTop}
              className="bg-gradient-to-r from-purple-600 via-fuchsia-600 to-blue-600 text-white hover:from-purple-700 hover:via-fuchsia-700 hover:to-blue-700"
            >
              <Rocket className="h-3.5 w-3.5 mr-1.5" />
              Запустить (~2 ₵)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}

// Compact badge for article list rows.
export function QualityBadgeIcon({ badge }: { badge: string | null | undefined }) {
  if (badge === "excellent") return (
    <Tooltip>
      <TooltipTrigger><Trophy className="h-4 w-4 text-success" /></TooltipTrigger>
      <TooltipContent>Отлично - все проверки пройдены</TooltipContent>
    </Tooltip>
  );
  if (badge === "good") return (
    <Tooltip>
      <TooltipTrigger><ThumbsUp className="h-4 w-4 text-warning" /></TooltipTrigger>
      <TooltipContent>Хорошо - можно публиковать</TooltipContent>
    </Tooltip>
  );
  if (badge === "needs_work") return (
    <Tooltip>
      <TooltipTrigger><AlertTriangle className="h-4 w-4 text-destructive" /></TooltipTrigger>
      <TooltipContent>Требует доработки</TooltipContent>
    </Tooltip>
  );
  return (
    <Tooltip>
      <TooltipTrigger><span className="inline-block h-3 w-3 rounded-full border border-muted-foreground/40" /></TooltipTrigger>
      <TooltipContent>Не проверено</TooltipContent>
    </Tooltip>
  );
}