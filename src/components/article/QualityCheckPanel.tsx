import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Trophy, ThumbsUp, Share2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
}

function statusOf(value: number | null, kind: "turgenev" | "uniq" | "ai"): "ok" | "warn" | "bad" | "none" {
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

function StatusIcon({ s }: { s: "ok" | "warn" | "bad" | "none" }) {
  if (s === "ok") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (s === "warn") return <AlertTriangle className="h-4 w-4 text-warning" />;
  if (s === "bad") return <XCircle className="h-4 w-4 text-destructive" />;
  return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />;
}

export function QualityCheckPanel({ articleId, content, initial, onUpdate }: Props) {
  const [result, setResult] = useState<QualityResult>(initial || {
    turgenev_score: null, uniqueness_percent: null, ai_human_score: null, quality_badge: null,
  });
  const [loadingSet, setLoadingSet] = useState<Set<string>>(new Set());

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
    if (opts?.confirmCredit) {
      if (!confirm("Проверка уникальности через Text.ru стоит 1 кредит. Продолжить?")) return;
    }
    const next = new Set(loadingSet);
    checks.forEach((c) => next.add(c));
    setLoadingSet(next);
    try {
      const { data, error } = await supabase.functions.invoke("quality-check", {
        body: { article_id: articleId, content, checks },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
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
      toast.success("Проверка завершена");
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
    ? { icon: Trophy, label: "Отлично - готово к публикации", cls: "text-success" }
    : result.quality_badge === "good"
    ? { icon: ThumbsUp, label: "Хорошо - можно публиковать", cls: "text-warning" }
    : result.quality_badge === "needs_work"
    ? { icon: AlertTriangle, label: "Требует доработки", cls: "text-destructive" }
    : null;

  return (
    <TooltipProvider>
      <Card className="p-4 space-y-3 bg-card/50 backdrop-blur border-border/60">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Проверка качества</div>
          {result.checked_at && (
            <span className="text-[10px] text-muted-foreground">
              {new Date(result.checked_at).toLocaleString("ru-RU")}
            </span>
          )}
        </div>

        <div className="space-y-2">
          {/* SEO-Module Score */}
          <div className="flex items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2">
              <StatusIcon s={sScore} />
              <Tooltip>
                <TooltipTrigger className="text-left">
                  <span>СЕО-Модуль Score</span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="text-xs space-y-1">
                    <div>Аналог Тургенева. Чем меньше баллов риска - тем чище текст.</div>
                    {result.details?.score_details && (
                      <>
                        <div>Стилистика: {result.details.score_details.stylistics}/10</div>
                        <div>Вода: {result.details.score_details.water}/10</div>
                      </>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
            <span className="font-mono text-xs">
              {result.turgenev_score !== null ? `${result.turgenev_score} баллов` : "-"}
            </span>
          </div>

          {/* Uniqueness */}
          <div className="flex items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2">
              <StatusIcon s={sUniq} />
              <Tooltip>
                <TooltipTrigger className="text-left">
                  <span>Уникальность</span>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-xs">Антиплагиат через Text.ru. Стоит 1 кредит.</div>
                </TooltipContent>
              </Tooltip>
            </div>
            <span className="font-mono text-xs">
              {result.uniqueness_percent !== null ? `${result.uniqueness_percent}%` : "-"}
            </span>
          </div>

          {/* AI-Score */}
          <div className="flex items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2">
              <StatusIcon s={sAi} />
              <Tooltip>
                <TooltipTrigger className="text-left">
                  <span>AI-детектор</span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="text-xs space-y-1">
                    <div>Шкала "человечности" текста (0-100).</div>
                    {result.details?.ai_details?.verdict && (
                      <div>Вердикт: {result.details.ai_details.verdict}</div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
            <span className="font-mono text-xs">
              {result.ai_human_score !== null ? `${result.ai_human_score}% человек` : "-"}
            </span>
          </div>
        </div>

        {badgeMeta && (
          <div className={`flex items-center gap-2 text-sm font-medium ${badgeMeta.cls} pt-2 border-t border-border/40`}>
            <badgeMeta.icon className="h-4 w-4" />
            {badgeMeta.label}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            variant="secondary"
            className="flex-1 min-w-[140px]"
            disabled={isLoading("score") || isLoading("ai")}
            onClick={() => runChecks(["score", "ai"])}
          >
            {(isLoading("score") || isLoading("ai")) ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            Score + AI (бесплатно)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 min-w-[140px]"
            disabled={isLoading("uniqueness")}
            onClick={() => runChecks(["uniqueness"], { confirmCredit: true })}
          >
            {isLoading("uniqueness") ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
            Уникальность (1 кредит)
          </Button>
        </div>

        {badgeMeta && (
          <Button size="sm" variant="ghost" className="w-full" onClick={shareCard}>
            <Share2 className="h-3.5 w-3.5 mr-1" />
            Поделиться результатом
          </Button>
        )}
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