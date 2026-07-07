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
import { validateContent } from "../_shared/contentValidator.ts";
import { webGroundedFactCheck, hasRiskyClaims } from "../_shared/webGroundedCheck.ts";
import { analyzeH2Structure, countSignatures, structuralIntegrityOk } from "../_shared/humanizeMetrics.ts";
import { ensureHtml, isStaleStatus } from "../_shared/ensureHtml.ts";

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
    // Format normalization: humanizer prompts assume HTML (`<h2>`, `<p>`, `<a>`),
    // otherwise the LLM reformats structure and htmlIntegrityOk rejects the
    // rewrite. Convert pure-Markdown drafts BEFORE the pass and persist.
    const norm = ensureHtml(content);
    let workContent = norm.html;
    if (norm.converted) {
      try { await admin.from("articles").update({ content: workContent }).eq("id", article_id); } catch (_) { /* non-fatal */ }
      logPipelineEvent({
        stage: "humanize",
        user_id: article.user_id,
        article_id,
        verdict: "warning",
        duration_ms: 0,
        meta: { event: "md_to_html_conversion", reason: norm.reason, before_bytes: content.length, after_bytes: workContent.length },
      });
    }
    if (workContent.replace(/<[^>]+>/g, "").length < 400) {
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

    // Preflight: anti-fake regex pass (fake experts, pseudo-stats, fake orgs).
    // Runs BEFORE humanize so LLM rewrites already-clean text.
    const preflight = validateContent(content);
    let cleanedInput = preflight.fixedContent;
    const fakesFixed = preflight.issues.length;

    // H2 structural warnings (persisted to articles.h2_warnings).
    const h2 = analyzeH2Structure(cleanedInput);

    // PRO/FACTORY: optional web-grounded fact check via Perplexity.
    // Only when content has risky factual claims. Best-effort with timeout.
    let webGroundedApplied = false;
    let webGroundedSkipped: string | undefined;
    try {
      const { data: profileRow } = await admin
        .from("profiles")
        .select("plan")
        .eq("id", article.user_id)
        .maybeSingle();
      const plan = String(profileRow?.plan || "basic").toLowerCase();
      if ((plan === "pro" || plan === "factory") && hasRiskyClaims(cleanedInput)) {
        const sigBefore = countSignatures(cleanedInput);
        const wg = await webGroundedFactCheck({
          apiKey: openRouterKey,
          html: cleanedInput,
          briefSummary: "",
          language: lang,
          timeoutMs: 60_000,
        });
        if (!wg.skipped && wg.html && wg.html.length > 300) {
          const sigAfter = countSignatures(wg.html);
          const guard = structuralIntegrityOk(sigBefore, sigAfter);
          if (guard.ok) {
            cleanedInput = wg.html;
            webGroundedApplied = true;
          } else {
            webGroundedSkipped = `integrity: ${guard.reason}`;
          }
        } else {
          webGroundedSkipped = wg.reason || "skipped";
        }
      } else if (plan !== "pro" && plan !== "factory") {
        webGroundedSkipped = "plan_not_eligible";
      } else {
        webGroundedSkipped = "no_risky_claims";
      }
    } catch (e) {
      webGroundedSkipped = `error: ${(e as Error)?.message?.slice(0, 80)}`;
    }

    const elapsed = startTimer();
    let result;
    try {
      result = await runDoubleHumanizePass(cleanedInput, lang, openRouterKey, {
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
        metrics: result.metrics || null,
        rejections: result.rejections || null,
        fakes_fixed: fakesFixed,
        h2_warnings: h2.warnings,
        web_grounded_applied: webGroundedApplied,
        web_grounded_skipped: webGroundedSkipped || null,
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
      metrics: result.metrics || null,
      rejections: result.rejections || null,
      fakes_fixed: fakesFixed,
      preflight_issues: preflight.issues.slice(0, 20).map(i => ({ type: i.type, original: i.original.slice(0, 80) })),
      h2: { sections: h2.sections, empty: h2.empty, tooShort: h2.tooShort, uniformLength: h2.uniformLength, uniformPrefix: h2.uniformPrefix, warnings: h2.warnings },
      web_grounded_applied: webGroundedApplied,
      web_grounded_skipped: webGroundedSkipped || null,
      ran_at: new Date().toISOString(),
      lang,
    };

    if (result.passesApplied === 0) {
      // Persist meta even when nothing changed, so we can see why in admin.
      // If only anti-fake preflight applied changes, still save fixedContent.
      const updatePayload: Record<string, unknown> = { humanize_meta: meta, pipeline_stages: newStages };
      if (fakesFixed > 0 && cleanedInput !== content) {
        updatePayload.content = cleanedInput;
      }
      updatePayload.h2_warnings = h2.warnings.length ? h2 : null;
      await admin
        .from("articles")
        .update(updatePayload)
        .eq("id", article_id);
      // Fire-and-forget server-side quality-check so metrics don't depend on the client tab.
      fireQualityCheck(article_id, cleanedInput);
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
        h2_warnings: h2.warnings.length ? h2 : null,
      })
      .eq("id", article_id);
    if (updErr) {
      console.error("[humanize-article] update failed:", updErr);
      return errorResponse(`DB update failed: ${updErr.message}`, 500);
    }

    // Fire-and-forget server-side quality-check (kills client-tab dependency).
    fireQualityCheck(article_id, result.content);

    return jsonResponse({
      ok: true,
      applied: true,
      passes: result.passesApplied,
      models: result.modelsUsed,
      opus_skipped: result.opusSkipped || false,
      reason: result.opusSkipReason || null,
      metrics: result.metrics || null,
      rejections: result.rejections || null,
      fakes_fixed: fakesFixed,
    });
  } catch (e) {
    console.error("[humanize-article] error", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});

function fireQualityCheck(articleId: string, content: string): void {
  try {
    if (!content || content.length < 200) return;
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    void fetch(`${url}/functions/v1/quality-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ article_id: articleId, content, mode: "auto" }),
    }).catch(() => {});
  } catch { /* ignore */ }
}
