import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const HUMANIZE_THRESHOLD = 70;
const FIRST_PASS_THRESHOLD = 60;
const MAX_PASSES = 2;
const TOTAL_BUDGET_MS = 90_000;
const POLL_INTERVAL_MS = 2_500;
const MAX_POLL_MS = 30_000;

export function isStealthRunning(articleId: string): boolean {
  try {
    return sessionStorage.getItem(`stealth_running_${articleId}`) === "true";
  } catch {
    return false;
  }
}

function setStealthFlag(articleId: string, value: boolean) {
  try {
    if (value) sessionStorage.setItem(`stealth_running_${articleId}`, "true");
    else sessionStorage.removeItem(`stealth_running_${articleId}`);
  } catch { /* noop */ }
}

/**
 * Auto Stealth Pass: orchestrates quality-check, iterative humanize (up to 2 passes)
 * and Turgenev fix. Uses one updating toast and finishes with a metrics summary.
 */
export async function runAutoStealthPass(articleId: string, lang: "ru" | "en" = "ru"): Promise<void> {
  const t = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const toastId = `stealth-${articleId}`;
  const startedAt = Date.now();
  const timeLeft = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  setStealthFlag(articleId, true);
  toast.loading(t("Проверяем качество текста...", "Checking text quality..."), {
    id: toastId,
    duration: TOTAL_BUDGET_MS,
  });

  try {
    // Step 1 — initial quality-check
    let qc = await invokeQualityCheck(articleId);
    let currentAiScore = numberOr(qc?.ai_score, 100);
    console.log("[auto-stealth] initial ai_score:", currentAiScore);

    // Step 2 — iterative humanize (up to MAX_PASSES). First pass only if < 60,
    // second pass if still < 70 after the first.
    let passCount = 0;
    while (
      ((passCount === 0 && currentAiScore < FIRST_PASS_THRESHOLD) ||
        (passCount > 0 && currentAiScore < HUMANIZE_THRESHOLD)) &&
      passCount < MAX_PASSES &&
      timeLeft() > 15_000
    ) {
      passCount++;
      toast.loading(
        passCount === 1
          ? t("Улучшаем AI Score...", "Improving AI Score...")
          : t("Второй проход улучшения...", "Second improvement pass..."),
        { id: toastId, duration: timeLeft() },
      );

      const { error } = await supabase.functions.invoke("improve-article", {
        body: { article_id: articleId, fix_type: "humanize" },
      });
      if (error) {
        console.warn(`[auto-stealth] pass ${passCount} failed`, error);
        break;
      }

      // Wait for the recheck to finish, then re-read the score.
      await waitForQualityIdle(articleId);
      qc = await invokeQualityCheck(articleId);
      currentAiScore = numberOr(qc?.ai_score, currentAiScore);
      console.log(`[auto-stealth] pass ${passCount} ai_score:`, currentAiScore);
    }

    // Step 3 — Turgenev (Baden-Baden) auto-fix when flagged
    const turgStatusInitial = String(qc?.turgenev_status || "ok");
    const turgScoreInitial = numberOr(qc?.turgenev_score, 0);
    const turgRisky = turgStatusInitial === "fail" || turgScoreInitial > 7;
    if (turgRisky && timeLeft() > 10_000) {
      toast.loading(t("Снижаем риск Баден-Бадена...", "Reducing Baden-Baden risk..."), {
        id: toastId,
        duration: timeLeft(),
      });
      const { error } = await supabase.functions.invoke("improve-article", {
        body: { article_id: articleId, fix_type: "turgenev" },
      });
      if (error) console.warn("[auto-turgenev] fix failed", error);
      else await waitForQualityIdle(articleId);
    }

    // Step 4 — final quality-check for the summary toast
    const final = (turgRisky || passCount > 0) ? await invokeQualityCheck(articleId) : qc;

    if (timeLeft() <= 0) {
      toast.warning(
        t(
          "Автопроверка не завершилась. Проверьте качество вручную.",
          "Auto-check didn't finish. Please review quality manually.",
        ),
        { id: toastId, duration: 6000 },
      );
      return;
    }

    toast.success(buildSummary(final, lang), { id: toastId, duration: 6000 });
  } catch (e) {
    console.warn("[auto-stealth] error", e);
    toast.dismiss(toastId);
  } finally {
    setStealthFlag(articleId, false);
  }
}

async function invokeQualityCheck(articleId: string): Promise<any | null> {
  try {
    const { data } = await supabase.functions.invoke("quality-check", {
      body: { article_id: articleId },
    });
    return data ?? null;
  } catch (e) {
    console.warn("[auto-stealth] quality-check invoke failed", e);
    return null;
  }
}

async function waitForQualityIdle(articleId: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < MAX_POLL_MS) {
    const { data } = await supabase
      .from("articles")
      .select("quality_status")
      .eq("id", articleId)
      .maybeSingle();
    if ((data as any)?.quality_status !== "checking") return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : fallback;
}

function buildSummary(final: any | null, lang: "ru" | "en"): string {
  const t = (ru: string, en: string) => (lang === "ru" ? ru : en);
  if (!final) return t("Готово. Текст готов к публикации.", "Done. Text is ready to publish.");

  const parts: string[] = [];
  const aiScore = typeof final.ai_score === "number" ? final.ai_score : null;
  if (aiScore != null) {
    const dot = aiScore >= 75 ? "🟢" : aiScore >= 60 ? "🟡" : "🔴";
    parts.push(`${dot} AI ${aiScore}`);
  }
  const turg = final.turgenev_status as string | undefined;
  if (turg) {
    const okLabel = t("OK", "OK");
    const riskLabel = t("риск", "risk");
    parts.push(`${turg === "ok" ? "🛡️" : "⚠️"} ${t("Тургенев", "Turgenev")}: ${turg === "ok" ? okLabel : riskLabel}`);
  }
  const uniq =
    typeof final.uniqueness_score === "number"
      ? final.uniqueness_score
      : typeof final.uniqueness_percent === "number"
        ? final.uniqueness_percent
        : null;
  if (uniq != null) {
    parts.push(`📝 ${t("Уник.", "Uniq.")} ${uniq}%`);
  }

  if (!parts.length) return t("Готово. Текст готов к публикации.", "Done. Text is ready to publish.");
  return `${t("Готово", "Done")} · ${parts.join(" · ")}`;
}
