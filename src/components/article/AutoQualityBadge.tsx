import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Wand2 } from "lucide-react";
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

const STATUS_META: Record<string, { dot: string; label: string; ring: string }> = {
  ok: { dot: "bg-emerald-500", label: "Готово", ring: "ring-emerald-500/40" },
  warning: { dot: "bg-amber-500", label: "Проверьте", ring: "ring-amber-500/40" },
  fail: { dot: "bg-rose-500", label: "Нужна доработка", ring: "ring-rose-500/40" },
  checking: { dot: "bg-muted-foreground/50 animate-pulse", label: "Проверка...", ring: "ring-border" },
};

function dotFor(s: string | null | undefined) {
  if (s === "ok") return "🟢";
  if (s === "warning" || s === "underuse") return "🟡";
  if (s === "fail" || s === "overuse") return "🔴";
  return "⏳";
}

export function AutoQualityBadge({ articleId, initial }: Props) {
  const [data, setData] = useState(initial || {});
  const [improving, setImproving] = useState(false);

  // Polling when checking
  useEffect(() => {
    let stopped = false;
    let attempts = 0;
    async function tick() {
      if (stopped) return;
      attempts++;
      const { data: row } = await supabase.from("articles")
        .select("quality_status,ai_score,burstiness_score,burstiness_status,keyword_density,keyword_density_status")
        .eq("id", articleId).maybeSingle();
      if (row) setData(row as any);
      if (row && row.quality_status === "checking" && attempts < 60) {
        setTimeout(tick, 3000);
      }
    }
    if (!data.quality_status || data.quality_status === "checking") {
      tick();
    }
    return () => { stopped = true; };
  }, [articleId]);

  const status = data.quality_status || "checking";
  const meta = STATUS_META[status] || STATUS_META.checking;
  const showImprove = status === "warning" || status === "fail";

  async function runImprove() {
    setImproving(true);
    try {
      const { error } = await supabase.functions.invoke("improve-article", {
        body: { article_id: articleId },
      });
      if (error) throw error;
      toast.success("Запущена авто-доработка. Дождитесь повторной проверки.");
      setData((d) => ({ ...d, quality_status: "checking" }));
      // restart polling
      setTimeout(async () => {
        let n = 0;
        const poll = async () => {
          n++;
          const { data: row } = await supabase.from("articles")
            .select("quality_status,ai_score,burstiness_score,burstiness_status,keyword_density,keyword_density_status")
            .eq("id", articleId).maybeSingle();
          if (row) setData(row as any);
          if (row && row.quality_status === "checking" && n < 60) setTimeout(poll, 3000);
        };
        poll();
      }, 1000);
    } catch (e: any) {
      toast.error(e?.message || "Ошибка авто-доработки");
    } finally {
      setImproving(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card/40 px-2 py-0.5 text-[11px] hover:border-border ring-1 ${meta.ring}`}
          title={meta.label}
        >
          <span className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
          <span className="text-muted-foreground">{meta.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3 text-xs space-y-2">
        <div className="font-medium text-sm">Качество статьи</div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span>{dotFor(data.ai_score == null ? "checking" : (data.ai_score >= 60 ? "ok" : data.ai_score >= 30 ? "warning" : "fail"))} AI-детектор</span>
            <span className="font-mono text-muted-foreground">
              {data.ai_score != null ? `${100 - data.ai_score}%` : "..."}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>{dotFor(data.burstiness_status)} Ритм текста</span>
            <span className="font-mono text-muted-foreground">
              {data.burstiness_score != null ? `σ=${data.burstiness_score}` : "..."}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>{dotFor(data.keyword_density_status)} Плотность</span>
            <span className="font-mono text-muted-foreground">
              {data.keyword_density != null ? `${data.keyword_density}%${data.keyword_density_status === "overuse" ? "↑" : data.keyword_density_status === "underuse" ? "↓" : ""}` : "..."}
            </span>
          </div>
        </div>
        {showImprove && (
          <Button
            size="sm"
            className="w-full mt-2"
            onClick={runImprove}
            disabled={improving}
          >
            {improving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
            Улучшить автоматически
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}