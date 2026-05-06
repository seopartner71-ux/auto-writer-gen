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
  // Clear any stale flag from a previous session before re-setting it.
  try { sessionStorage.removeItem(`stealth_running_${articleId}`); } catch { /* noop */ }
  try { sessionStorage.setItem(`stealth_running_${articleId}`, "true"); } catch { /* noop */ }
  console.log("[stealth] START", articleId);
  toast.loading(t("Проверяем качество текста...", "Checking text quality..."), {
    id: toastId,
    duration: TOTAL_BUDGET_MS,
  });

  try {
    // Step 1 — initial quality-check (independent: failure must not break the chain)
    let qc: any = null;
    try {
      qc = await invokeQualityCheck(articleId);
      console.log("[stealth] quality-check done:", qc?.ai_score, "turgenev:", qc?.turgenev_status);
    } catch (e) {
      console.warn("[stealth] quality-check failed:", (e as any)?.message ?? e);
    }
    // Fallback: if quality-check failed, treat ai_score as 0 so humanize still runs.
    let currentAiScore = numberOr(qc?.ai_score, 0);

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

      try {
        const { error } = await supabase.functions.invoke("improve-article", {
          body: { article_id: articleId, fix_type: "humanize" },
        });
        if (error) {
          console.warn(`[stealth] humanize pass ${passCount} failed`, error);
          break;
        }
        await waitForQualityIdle(articleId);
        try {
          qc = await invokeQualityCheck(articleId);
        } catch (e) {
          console.warn(`[stealth] quality-check after pass ${passCount} failed:`, (e as any)?.message ?? e);
        }
        currentAiScore = numberOr(qc?.ai_score, currentAiScore);
        console.log(`[stealth] humanize pass ${passCount} done, ai_score:`, currentAiScore);
      } catch (e) {
        console.warn(`[stealth] humanize pass ${passCount} threw:`, (e as any)?.message ?? e);
        break;
      }
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
      try {
        const { error } = await supabase.functions.invoke("improve-article", {
          body: { article_id: articleId, fix_type: "turgenev" },
        });
        if (error) console.warn("[stealth] turgenev fix failed", error);
        else await waitForQualityIdle(articleId);
        console.log("[stealth] turgenev check done");
      } catch (e) {
        console.warn("[stealth] turgenev step threw:", (e as any)?.message ?? e);
      }
    }

    // Step 4 — final quality-check for the summary toast (best-effort)
    let final: any = qc;
    if (turgRisky || passCount > 0) {
      try {
        final = await invokeQualityCheck(articleId);
      } catch (e) {
        console.warn("[stealth] final quality-check failed:", (e as any)?.message ?? e);
      }
    }

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
    console.log("[stealth] END", articleId, "final ai_score:", final?.ai_score);
  } catch (e) {
    console.warn("[stealth] ERROR", e);
    toast.dismiss(toastId);
  } finally {
    setStealthFlag(articleId, false);
    console.log("[stealth] flag cleared", articleId);
  }
}

async function invokeQualityCheck(articleId: string): Promise<any | null> {
  // Load fresh content + scores from DB. quality-check requires `content`
  // in the request body; without it the function returns 400 and the whole
  // chain silently no-ops. We also use mode:"auto" so no credits are spent
  // and uniqueness (text.ru) is not blocking — auto path runs AI + Turgenev
  // + burstiness in the background and writes scores to the row.
  try {
    const { data: row } = await supabase
      .from("articles")
      .select("content, ai_score, turgenev_status, turgenev_score, uniqueness_percent")
      .eq("id", articleId)
      .maybeSingle();
    const content = (row as any)?.content as string | undefined;
    if (!content || content.length < 50) {
      console.warn("[stealth] no content for quality-check");
      return row ?? null;
    }

    // Fire auto quality-check (background on the server side).
    try {
      await supabase.functions.invoke("quality-check", {
        body: { article_id: articleId, content, mode: "auto" },
      });
    } catch (e) {
      console.warn("[stealth] quality-check invoke failed:", (e as any)?.message ?? e);
    }

    // Wait for server to finish (quality_status flips off "checking").
    await waitForQualityIdle(articleId);

    // Re-read updated scores from the row.
    const { data: updated } = await supabase
      .from("articles")
      .select("ai_score, turgenev_status, turgenev_score, uniqueness_percent")
      .eq("id", articleId)
      .maybeSingle();
    return updated ?? row ?? null;
  } catch (e) {
    console.warn("[stealth] invokeQualityCheck threw:", (e as any)?.message ?? e);
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
