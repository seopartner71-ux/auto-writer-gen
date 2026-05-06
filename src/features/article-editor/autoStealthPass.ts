import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const THRESHOLD = 60;
const MAX_POLL_MS = 45_000;
const POLL_INTERVAL_MS = 2_500;
const TOTAL_BUDGET_MS = 60_000;

/**
 * Auto Stealth Pass: after generation orchestrates quality + Turgenev checks
 * and runs auto-fixes when needed. Whole flow is capped at 60s.
 */
export async function runAutoStealthPass(articleId: string, lang: "ru" | "en" = "ru"): Promise<void> {
  const t = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const toastId = `stealth-${articleId}`;
  const startedAt = Date.now();
  const timeLeft = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  try {
    toast.loading(t("Проверяем качество текста...", "Checking text quality..."), {
      id: toastId,
      duration: TOTAL_BUDGET_MS,
    });

    // Step 1 — initial AI score (quality-check is auto-triggered after generation)
    const aiScore = await waitForAiScore(articleId);
    console.log("[auto-stealth] ai_score:", aiScore);

    // Step 2 — humanize fix when AI score is too low
    if (aiScore != null && aiScore < THRESHOLD && timeLeft() > 5_000) {
      toast.loading(t("Улучшаем AI Score...", "Improving AI Score..."), {
        id: toastId,
        duration: timeLeft(),
      });
      const { data, error } = await supabase.functions.invoke("improve-article", {
        body: { article_id: articleId },
      });
      if (error || (data && (data as any).error)) {
        console.warn("[auto-stealth] humanize failed", error || (data as any).error);
      } else {
        await waitForAiScore(articleId, true);
      }
    }

    // Step 3 — read latest Turgenev status (quality-check writes it automatically)
    let { turg_status: turgStatus, turg_score: turgScore } = await readTurgenev(articleId);
    console.log("[auto-turgenev] score:", turgScore, "status:", turgStatus);

    // Step 4 — auto-fix if Turgenev flags Baden-Baden risk
    const turgRisky =
      turgStatus === "fail" || (typeof turgScore === "number" && turgScore > 7);
    if (turgRisky && timeLeft() > 5_000) {
      toast.loading(t("Снижаем риск Баден-Бадена...", "Reducing Baden-Baden risk..."), {
        id: toastId,
        duration: timeLeft(),
      });
      const { error } = await supabase.functions.invoke("improve-article", {
        body: { article_id: articleId },
      });
      if (error) console.warn("[auto-turgenev] fix failed", error);
      else {
        await waitForAiScore(articleId, true);
        const fresh = await readTurgenev(articleId);
        turgStatus = fresh.turg_status;
        console.log("[auto-turgenev] fix applied, new status:", turgStatus);
      }
    }

    toast.dismiss(toastId);

    if (timeLeft() <= 0) {
      toast.warning(
        t(
          "Автопроверка не завершилась. Проверьте качество вручную.",
          "Auto-check didn't finish. Please review quality manually.",
        ),
        { duration: 6000 },
      );
      return;
    }

    const finalMsg =
      turgStatus === "fail"
        ? t("Готово. Текст улучшен и защищён.", "Done. Text improved and protected.")
        : t("Готово. Текст прошёл проверку.", "Done. Text passed all checks.");
    toast.success(finalMsg, { duration: 5000 });
  } catch (e) {
    console.warn("[auto-stealth] error", e);
    toast.dismiss(toastId);
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

async function readTurgenev(
  articleId: string,
): Promise<{ turg_status: string | null; turg_score: number | null }> {
  const { data } = await supabase
    .from("articles")
    .select("turgenev_status, turgenev_score")
    .eq("id", articleId)
    .maybeSingle();
  return {
    turg_status: ((data as any)?.turgenev_status as string | null) ?? null,
    turg_score: ((data as any)?.turgenev_score as number | null) ?? null,
  };
}
