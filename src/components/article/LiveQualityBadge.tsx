import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, ShieldCheck, BrainCircuit, ChevronUp, AlertTriangle, Trophy, ThumbsUp } from "lucide-react";

interface Props {
  articleId: string | null;
  content: string;
  enabled?: boolean;
  onClick?: () => void;
}

type Status = "ok" | "warn" | "bad" | "none";

function statusOfSeo(v: number | null): Status {
  if (v === null) return "none";
  if (v <= 4) return "ok";
  if (v <= 6) return "warn";
  return "bad";
}

function statusOfAi(v: number | null): Status {
  if (v === null) return "none";
  if (v >= 80) return "ok";
  if (v >= 60) return "warn";
  return "bad";
}

function combinedStatus(s: Status, a: Status): Status {
  const order = ["bad", "warn", "ok", "none"] as const;
  const ranks = { bad: 0, warn: 1, ok: 2, none: 3 };
  if (s === "none" && a === "none") return "none";
  return order[Math.min(ranks[s], ranks[a])];
}

/**
 * Live, passive quality badge for the article editor.
 * Runs free SEO + AI checks in the background after the user pauses typing.
 * Floating in top-right of editor area; clicking opens the full panel.
 */
export function LiveQualityBadge({ articleId, content, enabled = true, onClick }: Props) {
  const [seo, setSeo] = useState<number | null>(null);
  const [ai, setAi] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(false);
  const lastCheckedRef = useRef<string>("");
  const timerRef = useRef<number | null>(null);

  // Strip HTML/Markdown for length check
  const plainLen = content.replace(/<[^>]+>/g, "").trim().length;
  const tooShort = plainLen < 200;

  useEffect(() => {
    if (!enabled || !articleId || tooShort) return;

    // Debounce 3s after last change.
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(async () => {
      // Skip if content unchanged since last check (hash-ish)
      const sample = (content.length + ":" + content.slice(0, 80) + ":" + content.slice(-80));
      if (sample === lastCheckedRef.current) return;
      lastCheckedRef.current = sample;

      setRunning(true);
      setError(false);
      try {
        const { data, error: e } = await supabase.functions.invoke("quality-check", {
          body: { article_id: articleId, content, checks: ["score", "ai"] },
        });
        if (e || data?.error) {
          setError(true);
        } else {
          if (typeof data.turgenev_score === "number") setSeo(data.turgenev_score);
          if (typeof data.ai_human_score === "number") setAi(data.ai_human_score);
        }
      } catch {
        setError(true);
      } finally {
        setRunning(false);
      }
    }, 3000);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [content, articleId, enabled, tooShort]);

  if (!enabled || !articleId) return null;

  const sSeo = statusOfSeo(seo);
  const sAi = statusOfAi(ai);
  const overall = combinedStatus(sSeo, sAi);

  const seoDisplay = seo !== null ? Math.max(0, 100 - seo * 10) : null;

  const colorMap: Record<Status, string> = {
    ok:   "border-emerald-500/40 bg-emerald-500/[0.06] text-emerald-300",
    warn: "border-amber-500/40 bg-amber-500/[0.06] text-amber-300",
    bad:  "border-rose-500/40 bg-rose-500/[0.06] text-rose-300",
    none: "border-border/60 bg-card/50 text-muted-foreground",
  };

  const dotColor: Record<Status, string> = {
    ok: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-rose-400", none: "bg-muted-foreground/30",
  };

  const Icon = overall === "ok" ? Trophy
    : overall === "warn" ? ThumbsUp
    : overall === "bad" ? AlertTriangle
    : Sparkles;

  return (
    <button
      onClick={onClick}
      className={`group inline-flex items-center gap-2 rounded-full border px-2.5 py-1 backdrop-blur-md text-xs font-medium transition-all hover:scale-[1.02] hover:shadow-md ${colorMap[overall]}`}
      title="Live анализ - нажмите для подробностей"
    >
      {running ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      <span className="font-mono tabular-nums flex items-center gap-1">
        <ShieldCheck className="h-3 w-3 opacity-70" />
        <span>{seoDisplay !== null ? seoDisplay : "-"}</span>
        <span className="opacity-50">/</span>
        <BrainCircuit className="h-3 w-3 opacity-70" />
        <span>{ai !== null ? `${ai}%` : "-"}</span>
      </span>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor[overall]}`} />
      <ChevronUp className="h-3 w-3 opacity-50 transition-transform group-hover:-translate-y-0.5" />
    </button>
  );
}
