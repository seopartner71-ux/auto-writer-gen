import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Polls `articles.ai_score` every `intervalMs` after the article row exists.
 * The stealth pass writes the score asynchronously, so we poll until it
 * appears. Resets to null when articleId is cleared.
 */
export function useAiScorePoll(
  articleId: string | null,
  setAiScore: (v: number | null) => void,
  intervalMs = 8000,
) {
  useEffect(() => {
    if (!articleId) { setAiScore(null); return; }
    let cancelled = false;
    const fetchScore = async () => {
      const { data } = await supabase
        .from("articles")
        .select("ai_score")
        .eq("id", articleId)
        .maybeSingle();
      if (!cancelled && data && typeof (data as any).ai_score === "number") {
        setAiScore((data as any).ai_score);
      }
    };
    fetchScore();
    const interval = window.setInterval(fetchScore, intervalMs);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [articleId, setAiScore, intervalMs]);
}