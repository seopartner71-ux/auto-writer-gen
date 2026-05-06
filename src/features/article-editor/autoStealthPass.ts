import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const THRESHOLD = 60;
const MAX_POLL_MS = 45_000;
const POLL_INTERVAL_MS = 2_500;

/**
 * Auto Stealth Pass: after article generation, polls quality-check result
 * and, if ai_score < THRESHOLD, runs improve-article to humanize the text.
 * Shows toast indicators during the process.
 */
export async function runAutoStealthPass(articleId: string, lang: "ru" | "en" = "ru"): Promise<void> {
  try {
    const aiScore = await waitForAiScore(articleId);
    console.log("[auto-stealth] ai_score:", aiScore);
    if (aiScore == null || aiScore >= THRESHOLD) return;

    const toastId = `stealth-${articleId}`;
    toast.loading(
      lang === "ru" ? "Улучшаем качество текста..." : "Improving text quality...",
      { id: toastId, duration: 60_000 },
    );

    console.log("[auto-stealth] running humanize fix");
    const { data, error } = await supabase.functions.invoke("improve-article", {
      body: { article_id: articleId },
    });

    if (error || (data && (data as any).error)) {
      console.warn("[auto-stealth] improve-article failed", error || (data as any).error);
      toast.dismiss(toastId);
      return;
    }

    // Wait for the post-improve quality recheck to land a new score.
    const newScore = await waitForAiScore(articleId, true);
    toast.dismiss(toastId);

    if (newScore != null) {
      toast.success(
        lang === "ru"
          ? `Готово. AI Score улучшен: ${newScore}`
          : `Done. AI Score improved: ${newScore}`,
        { duration: 5000 },
      );
    }
    console.log("[auto-stealth] done, newScore:", newScore);
  } catch (e) {
    console.warn("[auto-stealth] error", e);
  }
}

async function waitForAiScore(articleId: string, requireFresh = false): Promise<number | null> {
  const started = Date.now();
  let lastSeen: number | null = null;
  while (Date.now() - started < MAX_POLL_MS) {
    const { data } = await supabase
      .from("articles")
      .select("ai_score, quality_status")
      .eq("id", articleId)
      .maybeSingle();
    const score = (data as any)?.ai_score;
    const status = (data as any)?.quality_status;
    if (typeof score === "number" && status !== "checking") {
      if (!requireFresh || lastSeen === null || score !== lastSeen) {
        return score;
      }
    }
    if (typeof score === "number") lastSeen = score;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return lastSeen;
}
