import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Sparkles, ShieldCheck, BrainCircuit, CheckCircle2, AlertTriangle, XCircle, Trophy, ThumbsUp, Share2, Info, Rocket, Zap } from "lucide-react";
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

export function QualityCheckPanel({ articleId, content, initial, onUpdate, onHumanize }: Props) {
  const [result, setResult] = useState<QualityResult>(initial || {
    turgenev_score: null, uniqueness_percent: null, ai_human_score: null, quality_badge: null,
  });
  const [loadingSet, setLoadingSet] = useState<Set<string>>(new Set());
  const [autoImproving, setAutoImproving] = useState(false);
  const [uniqDialogOpen, setUniqDialogOpen] = useState(false);
  const [autoDialogOpen, setAutoDialogOpen] = useState(false);

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
      }
    })();
  }, [articleId]);

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
      if (!data?.uniqueness_error) toast.success("Проверка завершена");
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
    if (!confirm(
      "Auto-Improve to TOP запустит:\n" +
      "1) Humanize Fix - перепишет AI-абзацы (1 кредит)\n" +
      "2) Score + AI-детектор - бесплатно\n" +
      "3) Уникальность через Text.ru (1 кредит)\n\n" +
      "Итого ~2 кредита. Продолжить?"
    )) return;

    setAutoImproving(true);
    try {
      toast.info("Шаг 1/3: Humanize Fix - убираем запах GPT...", { duration: 6000 });
      await onHumanize();
      toast.info("Шаг 2/3: Score + AI-детектор...", { duration: 4000 });
      await runChecks(["score", "ai"]);
      toast.info("Шаг 3/3: Уникальность через Text.ru...", { duration: 4000 });
      await runChecks(["uniqueness"]);
      toast.success("Auto-Improve завершён - проверьте вердикт выше");
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
            hint={result.details?.uniqueness_details?.words ? `${result.details.uniqueness_details.words} слов - Text.ru` : "Антиплагиат через Text.ru"}
            value={result.uniqueness_percent !== null ? `${result.uniqueness_percent}%` : "-"}
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
          {onHumanize && (
            <Button
              size="sm"
              disabled={autoImproving || loadingFree || loadingUniq}
              onClick={autoImproveToTop}
              className="h-10 font-semibold text-white bg-gradient-to-r from-purple-600 via-fuchsia-600 to-blue-600 hover:from-purple-700 hover:via-fuchsia-700 hover:to-blue-700 hover:scale-[1.01] transition-all"
            >
              {autoImproving
                ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Auto-Improve...</>
                : <><Rocket className="h-4 w-4 mr-1.5" /> Auto-Improve to TOP <span className="ml-1.5 text-[10px] opacity-80">~2 ₵</span></>}
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={loadingFree}
              onClick={() => runChecks(["score", "ai"])}
              className="h-9 font-medium"
            >
              {loadingFree
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Анализ...</>
                : <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Проверить (free)</>}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={loadingUniq}
              onClick={() => runChecks(["uniqueness"], { confirmCredit: true })}
              className="h-9 font-medium"
            >
              {loadingUniq
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Проверка...</>
                : <><ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Уникальность <span className="ml-1 text-[10px] text-muted-foreground">1 ₵</span></>}
            </Button>
          </div>
          {badgeMeta && (
            <Button size="sm" variant="ghost" className="h-8 w-full text-xs" onClick={shareCard}>
              <Share2 className="h-3 w-3 mr-1.5" />
              Поделиться результатом
            </Button>
          )}
        </div>
      </Card>
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