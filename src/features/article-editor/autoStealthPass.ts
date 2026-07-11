import { supabase } from "@/integrations/supabase/client";
import { logger, errMessage } from "@/shared/utils/logger";
import { toast } from "sonner";
import { createElement } from "react";
import { HumanizeProgress, type HumanizeStage, type HumanizeMetricsReport } from "./HumanizeProgress";
import { translate } from "@/shared/hooks/useI18n";

const HUMANIZE_THRESHOLD = 70;
const FIRST_PASS_THRESHOLD = 60;
const MAX_PASSES = 2;
// Полный конвейер: humanize (до 150с) + до 2× improve с 60с cooldown между ними
// + turgenev + финальный quality-check. Прежний бюджет 90с обнулялся ещё
// на Step 0, из-за чего improve/turgenev полностью пропускались (см. AB-тест).
// Значение - верхняя граница, не задержка: короткие прогоны завершаются раньше.
const TOTAL_BUDGET_MS = 600_000;
const IMPROVE_COOLDOWN_MS = 65_000;
const POLL_INTERVAL_MS = 2_500;
const MAX_POLL_MS = 30_000;
// improve-article is now async: it returns 202 immediately and does the LLM
// work in the background. We poll `quality_status !== "improving"` for up to
// 240s (per-pass budget) at 5s cadence - matches the stack-overflow reference
// pattern shipped with the async improve-article rewrite.
const IMPROVE_POLL_INTERVAL_MS = 5_000;
const IMPROVE_MAX_POLL_MS = 240_000;

/** Shape of the quality-check row returned from articles after auto checks. */
export interface QualityCheckResult {
  content?: string | null;
  ai_score?: number | null;
  turgenev_status?: string | null;
  turgenev_score?: number | null;
  uniqueness_percent?: number | null;
  uniqueness_score?: number | null;
  quality_status?: string | null;
}

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
  const t = (key: string) => translate(key, lang);
  const toastId = `stealth-${articleId}`;
  const startedAt = Date.now();
  const timeLeft = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  setStealthFlag(articleId, true);
  // Clear any stale flag from a previous session before re-setting it.
  try { sessionStorage.removeItem(`stealth_running_${articleId}`); } catch { /* noop */ }
  try { sessionStorage.setItem(`stealth_running_${articleId}`, "true"); } catch { /* noop */ }
  logger.debug("[stealth] START", articleId);
  toast.loading(t("stealth.checking"), {
    id: toastId,
    duration: TOTAL_BUDGET_MS,
  });

  try {
    // Step 0 - unconditional double-humanize (Sonnet + Opus, server-side, budget-gated).
    // This is the primary "quality first" pass for every freshly generated article.
    // Conditional skips inside humanize-article: already rewritten, too short, already great.
    try {
      // Custom toast with stepper (Pass 1 / Pass 2 / Finalize) + progress bar.
      const humanizeStartedAt = Date.now();
      const renderHumanize = (stage?: HumanizeStage, metrics?: HumanizeMetricsReport) =>
        createElement(HumanizeProgress, {
          startedAt: humanizeStartedAt,
          estimatedMs: 130_000,
          forcedStage: stage,
          lang,
          metrics,
        });
      toast.custom(() => renderHumanize(), { id: toastId, duration: 160_000 });
      // Client-side hard cap so the toast does not hang if the edge function
      // gets killed by the wall-clock (Cloudflare/Workers tears down the
      // connection without a clean error). 150s ≈ edge function budget.
      const invokePromise = supabase.functions.invoke("humanize-article", {
        body: { article_id: articleId },
      });
      const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) =>
        setTimeout(
          () => resolve({ data: null, error: new Error("humanize_client_timeout_150s") }),
          150_000,
        ),
      );
      const { data: hz, error: hzErr } = (await Promise.race([invokePromise, timeoutPromise])) as
        | { data: unknown; error: null }
        | { data: null; error: Error };
      if (hzErr) {
        console.warn("[stealth] humanize-article failed:", hzErr);
        toast.custom(() => renderHumanize("error"), { id: toastId, duration: 4_000 });
      } else {
        logger.debug("[stealth] humanize-article:", hz);
        const raw = hz as { metrics?: HumanizeMetricsReport; fakes_fixed?: number } | null;
        const metrics: HumanizeMetricsReport | undefined = raw?.metrics
          ? { ...raw.metrics, fakesFixed: raw.fakes_fixed }
          : (raw?.fakes_fixed ? { fakesFixed: raw.fakes_fixed } : undefined);
        // Hold the toast a bit longer when we have a delta to show.
        toast.custom(() => renderHumanize("done", metrics), {
          id: toastId,
          duration: metrics ? 6_000 : 2_500,
        });
      }
    } catch (e) {
      console.warn("[stealth] humanize-article threw:", errMessage(e));
    }

    // Step 1 - initial quality-check (independent: failure must not break the chain)
    let qc: QualityCheckResult | null = null;
    try {
      qc = await invokeQualityCheck(articleId);
      logger.debug("[stealth] quality-check done:", qc?.ai_score, "turgenev:", qc?.turgenev_status);
    } catch (e) {
      console.warn("[stealth] quality-check failed:", errMessage(e));
    }
    // Fallback: if quality-check failed, treat ai_score as 0 so humanize still runs.
    let currentAiScore = numberOr(qc?.ai_score, 0);

    // Step 2 - iterative humanize (up to MAX_PASSES). First pass only if < 60,
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
          ? t("stealth.improving1")
          : t("stealth.improving2"),
        { id: toastId, duration: timeLeft() },
      );

      try {
        const res = await invokeImproveWithCooldown(articleId, "humanize", `pass ${passCount}`);
        if (res === "error") break;
        if (res === "cooldown_persist") {
          // Cooldown не ушёл после ретрая - не молча ломаем цикл, идём к Turgenev/финалу.
          break;
        }
        await waitForQualityIdle(articleId);
        try {
          qc = await invokeQualityCheck(articleId);
        } catch (e) {
          console.warn(`[stealth] quality-check after pass ${passCount} failed:`, errMessage(e));
        }
        currentAiScore = numberOr(qc?.ai_score, currentAiScore);
        logger.debug(`[stealth] humanize pass ${passCount} done, ai_score:`, currentAiScore);

        // Между улучшающими вызовами improve-article стоит 60с cooldown на
        // сервере. Если планируем ещё один pass - переждём его, иначе второй
        // вызов вернёт 200 {cooldown:true} и превратится в no-op.
        const willRunAnother =
          passCount < MAX_PASSES &&
          currentAiScore < HUMANIZE_THRESHOLD &&
          timeLeft() > IMPROVE_COOLDOWN_MS + 15_000;
        if (willRunAnother) {
          await new Promise((r) => setTimeout(r, IMPROVE_COOLDOWN_MS));
        }
      } catch (e) {
        console.warn(`[stealth] humanize pass ${passCount} threw:`, errMessage(e));
        break;
      }
    }

    // Step 3 - Turgenev (Baden-Baden) auto-fix when flagged
    // Turgenev / Baden-Baden is a Russian-language tool — skip entirely for EN.
    const turgStatusInitial = String(qc?.turgenev_status || "ok");
    const turgScoreInitial = numberOr(qc?.turgenev_score, 0);
    const turgRisky = lang === "ru" && (turgStatusInitial === "fail" || turgScoreInitial > 7);
    if (turgRisky && timeLeft() > 10_000) {
      toast.loading(t("stealth.baden"), {
        id: toastId,
        duration: timeLeft(),
      });
      try {
        const res = await invokeImproveWithCooldown(articleId, "turgenev", "turgenev");
        if (res === "ok") await waitForQualityIdle(articleId);
        logger.debug("[stealth] turgenev check done");
      } catch (e) {
        console.warn("[stealth] turgenev step threw:", errMessage(e));
      }
    }

    // Step 4 - final quality-check for the summary toast (best-effort)
    let final: QualityCheckResult | null = qc;
    if (turgRisky || passCount > 0) {
      try {
        final = await invokeQualityCheck(articleId);
      } catch (e) {
        console.warn("[stealth] final quality-check failed:", errMessage(e));
      }
    }

    if (timeLeft() <= 0) {
      toast.warning(
        t("stealth.notFinished"),
        { id: toastId, duration: 6000 },
      );
      return;
    }

    toast.success(buildSummary(final, lang), { id: toastId, duration: 6000 });
    logger.debug("[stealth] END", articleId, "final ai_score:", final?.ai_score);
  } catch (e) {
    console.warn("[stealth] ERROR", e);
    toast.dismiss(toastId);
  } finally {
    setStealthFlag(articleId, false);
    logger.debug("[stealth] flag cleared", articleId);
  }
}

async function invokeQualityCheck(articleId: string): Promise<QualityCheckResult | null> {
  // Load fresh content + scores from DB. quality-check requires `content`
  // in the request body; without it the function returns 400 and the whole
  // chain silently no-ops. We also use mode:"auto" so no credits are spent
  // and uniqueness (text.ru) is not blocking - auto path runs AI + Turgenev
  // + burstiness in the background and writes scores to the row.
  try {
    const { data: row } = await supabase
      .from("articles")
      .select("content, ai_score, turgenev_status, turgenev_score, uniqueness_percent")
      .eq("id", articleId)
      .maybeSingle();
    const content = (row as QualityCheckResult | null)?.content ?? undefined;
    if (!content || content.length < 50) {
      console.warn("[stealth] no content for quality-check");
      return (row as QualityCheckResult | null) ?? null;
    }

    // Fire auto quality-check (background on the server side).
    try {
      await supabase.functions.invoke("quality-check", {
        body: { article_id: articleId, content, mode: "auto", dispatched_by: "stealth" },
      });
    } catch (e) {
      console.warn("[stealth] quality-check invoke failed:", errMessage(e));
    }

    // Wait for server to finish (quality_status flips off "checking").
    await waitForQualityIdle(articleId);

    // Re-read updated scores from the row.
    const { data: updated } = await supabase
      .from("articles")
      .select("ai_score, turgenev_status, turgenev_score, uniqueness_percent")
      .eq("id", articleId)
      .maybeSingle();
    return (updated as QualityCheckResult | null) ?? (row as QualityCheckResult | null) ?? null;
  } catch (e) {
    console.warn("[stealth] invokeQualityCheck threw:", errMessage(e));
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
    if ((data as { quality_status?: string | null } | null)?.quality_status !== "checking") return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/**
 * Invokes improve-article and transparently retries once on the server-side
 * 60s cooldown. Returns:
 *  - "ok"                - improvement applied
 *  - "error"             - transport/edge error (already logged); caller breaks
 *  - "cooldown_persist"  - cooldown still active after one retry (logged);
 *                          caller continues to the next step instead of silently
 *                          treating no-op as success.
 */
async function invokeImproveWithCooldown(
  articleId: string,
  fixType: "humanize" | "turgenev",
  label: string,
): Promise<"ok" | "error" | "cooldown_persist"> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.functions.invoke("improve-article", {
      body: { article_id: articleId, fix_type: fixType },
    });
    if (error) {
      console.warn(`[stealth] improve-article ${label} failed`, error);
      return "error";
    }
    const d = (data ?? null) as { ok?: boolean; cooldown?: boolean; retry_after?: number } | null;
    if (d?.cooldown) {
      if (attempt === 0) {
        const waitMs = Math.max(1_000, Math.min(65_000, (Number(d.retry_after) || 60) * 1000 + 500));
        logger.debug(`[stealth] improve-article ${label} cooldown, retry in ${waitMs}ms`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      console.warn(`[stealth] improve-article ${label} cooldown persisted after retry, skipping`);
      return "cooldown_persist";
    }
    // Async contract: wait for the background pipeline to clear quality_status.
    await waitForImproveFinished(articleId);
    return "ok";
  }
  return "cooldown_persist";
}

/**
 * Polls `articles.quality_status` until it is no longer "improving" (i.e. the
 * background LLM pipeline in improve-article has finished - success or error).
 * Bounded by IMPROVE_MAX_POLL_MS (240s) to avoid hanging.
 */
async function waitForImproveFinished(articleId: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < IMPROVE_MAX_POLL_MS) {
    const { data } = await supabase
      .from("articles")
      .select("quality_status")
      .eq("id", articleId)
      .maybeSingle();
    const s = (data as { quality_status?: string | null } | null)?.quality_status;
    if (s !== "improving") return;
    await new Promise((r) => setTimeout(r, IMPROVE_POLL_INTERVAL_MS));
  }
  console.warn("[stealth] waitForImproveFinished timeout", articleId);
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : fallback;
}

function buildSummary(final: QualityCheckResult | null, lang: "ru" | "en"): string {
  const t = (key: string) => translate(key, lang);
  if (!final) return t("stealth.doneReady");

  const parts: string[] = [];
  const aiScore = typeof final.ai_score === "number" ? final.ai_score : null;
  if (aiScore != null) {
    const dot = aiScore >= 75 ? "🟢" : aiScore >= 60 ? "🟡" : "🔴";
    parts.push(`${dot} AI ${aiScore}`);
  }
  const turg = final.turgenev_status as string | undefined;
  if (turg) {
    const okLabel = t("stealth.turgOk");
    const riskLabel = t("stealth.turgRisk");
    parts.push(`${turg === "ok" ? "🛡️" : "⚠️"} ${t("stealth.turgenev")}: ${turg === "ok" ? okLabel : riskLabel}`);
  }
  const uniq =
    typeof final.uniqueness_score === "number"
      ? final.uniqueness_score
      : typeof final.uniqueness_percent === "number"
        ? final.uniqueness_percent
        : null;
  if (uniq != null) {
    parts.push(`📝 ${t("stealth.uniq")} ${uniq}%`);
  }

  if (!parts.length) return t("stealth.doneReady");
  return `${t("stealth.done")} · ${parts.join(" · ")}`;
}
