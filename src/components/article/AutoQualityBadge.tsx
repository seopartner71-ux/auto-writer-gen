import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Wand2, RotateCcw, History, Trophy, ThumbsUp, AlertTriangle, FileWarning, CircleDashed } from "lucide-react";
import { toast } from "sonner";

interface Props {
  articleId: string;
  initial?: {
    quality_status?: string | null;
    ai_score?: number | null;
    burstiness_score?: number | null;
    burstiness_status?: string | null;
    keyword_density?: number | null;
    keyword_density_status?: string | null;
  };
}

const STATUS_META: Record<string, { Icon: any; label: string; color: string }> = {
  ok:        { Icon: Trophy,        label: "Отлично",         color: "text-emerald-400" },
  warning:   { Icon: ThumbsUp,      label: "Хорошо",          color: "text-amber-400" },
  fail:      { Icon: AlertTriangle, label: "Нужна доработка", color: "text-rose-400" },
  too_short: { Icon: FileWarning,   label: "Текст короткий",  color: "text-muted-foreground" },
  checking:  { Icon: Loader2,       label: "Проверка",        color: "text-muted-foreground animate-spin" },
  none:      { Icon: CircleDashed,  label: "Не проверено",    color: "text-muted-foreground/60" },
};

function dotFor(s: string | null | undefined) {
  if (s === "ok") return "🟢";
  if (s === "warning" || s === "underuse") return "🟡";
  if (s === "fail" || s === "overuse") return "🔴";
  return "⏳";
}

export function AutoQualityBadge({ articleId, initial }: Props) {
  const [data, setData] = useState<any>(initial || {});
  const [improving, setImproving] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);

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

  // Realtime subscription replaces polling — one channel per badge,
  // server pushes updates when row changes. Fallback timeout marks
  // status as 'timeout' if no update arrives in 3 minutes.
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
          }));
          if (row.quality_status && row.quality_status !== "checking") {
            cleanupChannel();
          }
        }
      )
      .subscribe();
    channelRef.current = ch;

    // Safety net: if still 'checking' after 3 min, mark timeout
    fallbackTimerRef.current = window.setTimeout(() => {
      if (stoppedRef.current) return;
      setData((d: any) => (d.quality_status === "checking" ? { ...d, quality_status: "timeout" } : d));
      cleanupChannel();
    }, 180_000);
  }

  async function fetchOnce() {
    const { data: row } = await supabase.from("articles")
      .select("quality_status,ai_score,burstiness_score,burstiness_status,keyword_density,keyword_density_status")
      .eq("id", articleId).maybeSingle();
    if (stoppedRef.current) return;
    if (row) setData((d: any) => ({ ...d, ...row }));
    if (!row || row.quality_status === "checking") startRealtime();
  }

  useEffect(() => {
    stoppedRef.current = false;
    if (!data.quality_status || data.quality_status === "checking") {
      // If we already know it's checking, just subscribe; otherwise fetch then decide
      if (data.quality_status === "checking") startRealtime();
      else fetchOnce();
    }
    return () => {
      stoppedRef.current = true;
      cleanupChannel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

  async function runImprove() {
    setImproving(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("improve-article", {
        body: { article_id: articleId },
      });
      if (error) throw error;
      if ((res as any)?.cooldown) {
        toast.warning((res as any).message || "Подождите перед повторной доработкой");
        return;
      }
      toast.success("Запущена авто-доработка");
      setData((d: any) => ({ ...d, quality_status: "checking" }));
      stoppedRef.current = false;
      startRealtime();
    } catch (e: any) {
      toast.error(e?.message || "Ошибка авто-доработки");
    } finally {
      setImproving(false);
    }
  }

  async function runRecheck() {
    setRechecking(true);
    try {
      const { data: art } = await supabase.from("articles").select("content").eq("id", articleId).maybeSingle();
      if (!art?.content) { toast.error("Нет контента"); return; }
      const { error } = await supabase.functions.invoke("quality-check", {
        body: { article_id: articleId, content: art.content, mode: "auto" },
      });
      if (error) throw error;
      setData((d: any) => ({ ...d, quality_status: "checking" }));
      stoppedRef.current = false;
      startRealtime();
    } catch (e: any) {
      toast.error(e?.message || "Ошибка");
    } finally {
      setRechecking(false);
    }
  }

  const status = data.quality_status || "none";
  const meta = STATUS_META[status] || STATUS_META.none;
  const showImprove = status === "warning" || status === "fail";
  const showRetry = status === "timeout" || status === "fail" || status === "warning" || status === "ok";
  const Icon = status === "timeout" ? AlertTriangle : meta.Icon;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted/40 transition-colors"
          title={status === "timeout" ? "Проверка не ответила" : meta.label}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon className={`h-4 w-4 ${meta.color}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3 text-xs space-y-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-medium text-sm">Качество статьи</div>
          <span className={`text-[10px] uppercase tracking-wide ${meta.color.replace("animate-spin", "")}`}>{status === "timeout" ? "Таймаут" : meta.label}</span>
        </div>
        {status === "too_short" && (
          <div className="text-muted-foreground text-[11px] leading-snug">
            Текст короче 200 символов - проверка качества не проводилась.
          </div>
        )}
        {status !== "too_short" && status !== "none" && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span>{dotFor(data.ai_score == null ? "checking" : (data.ai_score >= 70 ? "ok" : data.ai_score >= 50 ? "warning" : "fail"))} AI-детектор</span>
              <span className="font-mono text-muted-foreground">
                {data.ai_score != null ? `${data.ai_score}` : "..."}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>{dotFor(data.burstiness_status)} Длина предложений</span>
              <span className="font-mono text-muted-foreground">
                {data.burstiness_score != null ? `σ=${data.burstiness_score}` : "..."}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>{dotFor(data.keyword_density_status)} Плотность ключа</span>
              <span className="font-mono text-muted-foreground">
                {data.keyword_density != null ? `${data.keyword_density}%${data.keyword_density_status === "overuse" ? "↑" : data.keyword_density_status === "underuse" ? "↓" : ""}` : "..."}
              </span>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1.5 pt-1">
          {showImprove && (
            <Button size="sm" className="w-full" onClick={runImprove} disabled={improving || rechecking}>
              {improving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
              Улучшить автоматически
            </Button>
          )}
          {showRetry && status !== "checking" && (
            <Button size="sm" variant="outline" className="w-full" onClick={runRecheck} disabled={rechecking || improving}>
              {rechecking ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
              Перепроверить
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="w-full text-[11px] h-7"
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent("open-article-versions", { detail: { articleId } }));
            }}
          >
            <History className="h-3 w-3 mr-1" />
            История версий
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
