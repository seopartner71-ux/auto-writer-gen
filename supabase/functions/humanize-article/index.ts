// Server-side humanize pass for any generated article.
//
// Body: { article_id: string, force?: boolean }
// - Loads article (user-scoped or admin-scoped via service role).
// - Skips if already rewritten=true (unless force=true).
// - Conditional skip: if ai_human_score >= 75 AND turgenev_score <= 4 (already great), skips silently.
// - Runs runDoubleHumanizePass (Sonnet + Opus, Opus gated by check_ai_budget).
// - Updates article: content, rewritten=true, humanize_meta, pipeline_stages.
// - Returns { ok, applied, passes, models, opus_skipped, reason }.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { runDoubleHumanizePass } from "../_shared/humanizePass.ts";
import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { logPipelineEvent, startTimer } from "../_shared/pipelineLogger.ts";

function detectLang(text: string, hint?: string | null): "ru" | "en" {
  if (hint === "ru" || hint === "en") return hint;
  return /[а-яА-Я]/.test(text || "") ? "ru" : "en";
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const body = await req.json().catch(() => ({}));
    const { article_id, force = false } = body as { article_id?: string; force?: boolean };
    if (!article_id || typeof article_id !== "string") {
      return errorResponse("article_id is required", 400);
    }

    const admin = adminClient();

    // Load article + user check
    const { data: article, error: artErr } = await admin
      .from("articles")
      .select("id, user_id, content, language, rewritten, ai_human_score, turgenev_score, pipeline_stages, humanize_meta")
      .eq("id", article_id)
      .maybeSingle();
    if (artErr || !article) return errorResponse("Article not found", 404);

    // Permission: owner OR admin
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    const isAdmin = !!roleRow;
    if (article.user_id !== userId && !isAdmin) {
      return errorResponse("Forbidden", 403);
    }

    // Already humanized
    if (article.rewritten && !force) {
      return jsonResponse({ ok: true, applied: false, reason: "already_rewritten" });
    }

    const content = (article.content || "").toString();
    if (content.replace(/<[^>]+>/g, "").length < 400) {
      return jsonResponse({ ok: true, applied: false, reason: "too_short" });
    }

    // Conditional skip: already great quality (only when not forced).
    if (!force) {
      const aiHuman = Number(article.ai_human_score ?? 0);
      const turg = Number(article.turgenev_score ?? 99); // unknown → not great
      if (aiHuman >= 80 && turg <= 4) {
        return jsonResponse({ ok: true, applied: false, reason: "quality_already_high" });
      }
    }

    // Get OpenRouter key (Vault first, then env fallback)
    const { data: orRow } = await admin
      .from("api_keys")
      .select("api_key")
      .eq("provider", "openrouter")
      .eq("is_valid", true)
      .maybeSingle();
    const openRouterKey = orRow?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterKey) return errorResponse("OpenRouter key not configured", 500);

    const lang = detectLang(content, article.language);

    const elapsed = startTimer();
    let result;
    try {
      result = await runDoubleHumanizePass(content, lang, openRouterKey, {
        admin,
        userId: article.user_id,
      });
    } catch (e) {
      logPipelineEvent({
        stage: "humanize",
        user_id: article.user_id,
        article_id: article_id,
        verdict: "fail",
        duration_ms: elapsed(),
        error_kind: "upstream",
        error_message: (e as Error)?.message,
        meta: { lang, force },
      });
      throw e;
    }
    logPipelineEvent({
      stage: "humanize",
      user_id: article.user_id,
      article_id: article_id,
      verdict: result.passesApplied === 0 ? "warning" : "pass",
      duration_ms: elapsed(),
      model: result.modelsUsed.join(","),
      meta: {
        lang,
        force,
        passes: result.passesApplied,
        models: result.modelsUsed,
        opus_skipped: result.opusSkipped || false,
        opus_skip_reason: result.opusSkipReason || null,
      },
    });

    // No passes succeeded — log to humanize_meta but don't mark rewritten.
    const baseStages = Array.isArray(article.pipeline_stages) ? article.pipeline_stages : [];
    const newStages = [...baseStages];
    if (result.modelsUsed.includes("anthropic/claude-sonnet-4")) newStages.push("humanize-sonnet");
    if (result.modelsUsed.includes("anthropic/claude-opus-4")) newStages.push("humanize-opus");

    const meta = {
      passes_applied: result.passesApplied,
      models_used: result.modelsUsed,
      opus_skipped: result.opusSkipped || false,
      opus_skip_reason: result.opusSkipReason || null,
      ran_at: new Date().toISOString(),
      lang,
    };

    if (result.passesApplied === 0) {
      // Persist meta even when nothing changed, so we can see why in admin.
      await admin
        .from("articles")
        .update({ humanize_meta: meta, pipeline_stages: newStages })
        .eq("id", article_id);
      return jsonResponse({
        ok: true,
        applied: false,
        reason: "no_passes_succeeded",
        meta,
      });
    }

    const { error: updErr } = await admin
      .from("articles")
      .update({
        content: result.content,
        rewritten: true,
        humanize_meta: meta,
        pipeline_stages: newStages,
      })
      .eq("id", article_id);
    if (updErr) {
      console.error("[humanize-article] update failed:", updErr);
      return errorResponse(`DB update failed: ${updErr.message}`, 500);
    }

    return jsonResponse({
      ok: true,
      applied: true,
      passes: result.passesApplied,
      models: result.modelsUsed,
      opus_skipped: result.opusSkipped || false,
      reason: result.opusSkipReason || null,
    });
  } catch (e) {
    console.error("[humanize-article] error", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});
