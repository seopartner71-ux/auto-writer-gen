import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyStealthPostProcess, buildRareLexiconAddon } from "../_shared/stealth.ts";
import {
  generateStealthPrompt,
  buildNewArticleUserPrompt,
} from "../_shared/promptBuilder.ts";
import { buildSerpClusterDisciplineAddon } from "../_shared/serpClusterPrompt.ts";
import { buildSerpEntityDisciplineAddon } from "../_shared/serpEntityDiscipline.ts";
import { runDoubleHumanizePass } from "../_shared/humanizePass.ts";
import { enforcePersonaSyntax } from "../_shared/personaEnforce.ts";
import { enforceDataNuggets } from "../_shared/nuggetsEnforce.ts";
import { validateContent } from "../_shared/contentValidator.ts";
import { ANTI_TURGENEV_ADDON, buildAntiTurgenevAddon } from "../_shared/antiTurgenevAddon.ts";
import { getStyleProfile } from "../_shared/styleProfile.ts";
import { resolveAutoAuthorByNiche } from "../_shared/authorAutoSelect.ts";
import { logLLM } from "../_shared/costLogger.ts";
import { assertPersonaLanguage } from "../_shared/personaLanguageGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-bulk-user-id",
};

const ITEMS_PER_RUN = 1;
const SERPER_TIMEOUT_MS = 15000;
const AI_TIMEOUT_MS = 45000;
const NEXT_BATCH_DELAY_MS = 1500;

type AdminClient = ReturnType<typeof createClient>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeJwtPayload(token: string) {
  const payloadB64 = token.split(".")[1];
  if (!payloadB64) throw new Error("Unauthorized");
  const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(atob(padded));
}

function getUserIdFromRequest(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");

  const token = authHeader.replace("Bearer ", "");
  const payload = decodeJwtPayload(token) as { role?: string; sub?: string };

  if (payload.role === "service_role") {
    const internalUserId = req.headers.get("x-bulk-user-id");
    if (!internalUserId) throw new Error("Unauthorized");
    return internalUserId;
  }

  if (!payload.sub) throw new Error("Unauthorized");
  return payload.sub;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

// NOTE: Author-aware prompt is now built per-item via the SAME
// generateStealthPrompt that powers single-article generation. The author
// profile is fetched once per chunk and passed into processQueuedItem.
async function fetchAuthorProfile(admin: AdminClient, authorProfileId: string | null) {
  if (!authorProfileId) return null;
  const { data: author } = await admin
    .from("author_profiles")
    .select("*")
    .eq("id", authorProfileId)
    .single();
  return author || null;
}

async function finalizeJob(admin: AdminClient, bulkJobId: string, fallbackCompletedItems: number) {
  const [{ data: finalItems }, { data: jobState }] = await Promise.all([
    admin.from("bulk_job_items").select("status").eq("bulk_job_id", bulkJobId),
    admin.from("bulk_jobs").select("status").eq("id", bulkJobId).single(),
  ]);

  const items = finalItems || [];
  const completedItems = items.length
    ? items.filter((item: any) => item.status === "done" || item.status === "error").length
    : fallbackCompletedItems;
  const allDone = items.length > 0 && items.every((item: any) => item.status === "done" || item.status === "error");
  const hasQueued = items.some((item: any) => item.status === "queued");
  const nextStatus = allDone ? "completed" : jobState?.status === "paused" ? "paused" : "processing";

  await admin.from("bulk_jobs").update({
    status: nextStatus,
    completed_items: completedItems,
  }).eq("id", bulkJobId);

  return { completedItems, hasQueued, nextStatus };
}

async function scheduleNextChunk(params: {
  supabaseUrl: string;
  publicKey: string;
  serviceKey: string;
  bulkJobId: string;
  userId: string;
}) {
  await sleep(NEXT_BATCH_DELAY_MS);

  // Fire-and-forget: don't wait for the full response, just ensure the request is sent
  try {
    const response = await fetchWithTimeout(`${params.supabaseUrl}/functions/v1/bulk-generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.serviceKey}`,
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Modul bulk-generate",
        apikey: params.publicKey,
        "Content-Type": "application/json",
        "x-bulk-user-id": params.userId,
      },
      body: JSON.stringify({ bulk_job_id: params.bulkJobId }),
    }, 15000);

    // Just check status, don't consume body to avoid hanging
    if (!response.ok) {
      console.error("Failed to schedule next bulk chunk:", response.status);
    }
  } catch (err) {
    console.error("scheduleNextChunk fetch error (will rely on frontend auto-resume):", err);
    // Don't throw — frontend auto-resume will pick up stalled jobs
  }
}

async function processQueuedItem(params: {
  admin: AdminClient;
  item: any;
  job: any;
  userId: string;
  openRouterApiKey: string;
  serperApiKey: string | null;
  writerModel: string;
  researchModel: string;
  authorProfile: any | null;
  bulkJobId: string;
  completedCount: number;
}) {
  const {
    admin,
    item,
    job,
    userId,
    openRouterApiKey,
    serperApiKey,
    writerModel,
    researchModel,
    bulkJobId,
    completedCount,
  } = params;
  let authorProfile = params.authorProfile;

  try {
    await admin.from("bulk_job_items").update({ status: "researching", error_message: null }).eq("id", item.id);

    // Prefer explicit job language (set by user in bulk UI). Fall back to
    // legacy keyword sniffing for old jobs created before the column existed.
    const jobLang = ((job as any)?.language ?? "").toString().toLowerCase();
    const isRussian = jobLang
      ? jobLang === "ru"
      : /[а-яё]/i.test(item.seed_keyword);
    const geo = isRussian ? "ru" : "us";
    const lang: "ru" | "en" = isRussian ? "ru" : "en";

    // ─── Persona language sanity-check ───────────────────────────────
    // Server-side guard: FACTORY jobs may carry a persona from the wrong
    // locale (e.g. RU persona on EN keywords). Drop the persona prompt if
    // languages diverge — bulk item will fall back to plain style.
    {
      const kept = assertPersonaLanguage({
        authorProfile,
        articleLang: lang,
        context: {
          fn: "bulk-generate",
          userId,
          keywordId: item.keyword_id ?? null,
        },
      });
      if (authorProfile && !kept) authorProfile = null;
    }

    let competitors: any[] = [];
    if (serperApiKey) {
      try {
        const serperRes = await fetchWithTimeout("https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "X-API-KEY": serperApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ q: item.seed_keyword, gl: geo, hl: lang, num: 10 }),
        }, SERPER_TIMEOUT_MS);

        if (serperRes.ok) {
          const serperData = await serperRes.json();
          competitors = (serperData.organic || []).slice(0, 10);
        }
      } catch (error) {
        console.warn("Serper request failed, continuing without SERP:", error);
      }
    }

    const analysisPrompt = `Analyze this keyword for SEO content creation: "${item.seed_keyword}"
Competitors found: ${competitors.map((c: any) => c.title).join(", ") || "none"}

Return JSON: { "intent": "informational|transactional|navigational", "must_cover_topics": [...], "lsi_keywords": [...], "recommended_headings": [...], "recommended_word_count": number }`;

    const analysisResp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Modul bulk-generate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: researchModel,
        messages: [{ role: "user", content: analysisPrompt }],
        response_format: { type: "json_object" },
      }),
    }, AI_TIMEOUT_MS);

    let analysis: Record<string, any> = {};
    if (analysisResp.ok) {
      const analysisData = await analysisResp.json();
      try { logLLM({ functionName: "bulk-generate", model: ((analysisData as any)?.model) as string, tokensIn: Number((analysisData as any)?.usage?.prompt_tokens || 0), tokensOut: Number((analysisData as any)?.usage?.completion_tokens || 0) }); } catch(_) {}
      try {
        analysis = JSON.parse(analysisData.choices?.[0]?.message?.content || "{}");
      } catch {
        analysis = {};
      }
    }

    const { data: keywordData } = await admin.from("keywords").insert({
      user_id: userId,
      seed_keyword: item.seed_keyword,
      intent: analysis.intent || null,
      lsi_keywords: analysis.lsi_keywords || [],
      must_cover_topics: analysis.must_cover_topics || [],
      recommended_headings: analysis.recommended_headings || [],
    }).select("id").single();

    const keywordId = keywordData?.id;
    if (keywordId) {
      await admin.from("bulk_job_items").update({ keyword_id: keywordId }).eq("id", item.id);

      if (competitors.length > 0) {
        const serpInserts = competitors.map((competitor: any, index: number) => ({
          keyword_id: keywordId,
          position: index + 1,
          url: competitor.link || competitor.url || null,
          title: competitor.title || null,
          snippet: competitor.snippet || null,
        }));
        await admin.from("serp_results").insert(serpInserts);
      }
    }

    await admin.from("bulk_job_items").update({ status: "writing" }).eq("id", item.id);

    const headings = analysis.recommended_headings || [];
    const lsiKeywords = analysis.lsi_keywords || [];

    // Build outline from recommended_headings (default to H2 level).
    const outlineForPrompt = headings.map((h: string) => ({ text: String(h), level: "h2" }));

    // Build the EXACT same system prompt as single-article generation.
    // Anything missing from request_payload defaults to empty so old queue
    // entries do not break.
    const payload = (item.request_payload || {}) as Record<string, any>;
    const { system: baseSystemPrompt } = generateStealthPrompt({
      authorProfile,
      serpData: (competitors || []).map((c: any) => ({
        title: c.title || "",
        snippet: c.snippet || "",
        url: c.link || c.url || "",
      })),
      lsiKeywords,
      userStructure: outlineForPrompt,
      keyword: {
        seed_keyword: item.seed_keyword,
        intent: analysis.intent,
        difficulty: analysis.difficulty,
        questions: analysis.questions || [],
        language: isRussian ? "ru" : "en",
      },
      competitorTables: payload.competitor_tables || [],
      competitorLists: payload.competitor_lists || [],
      deepAnalysisContext: payload.deep_analysis_context || "",
      miralinksLinks: payload.miralinks_links || [],
      gogetlinksLinks: payload.gogetlinks_links || [],
      includeExpertQuote: payload.include_expert_quote !== false,
      includeComparisonTable: payload.include_comparison_table !== false,
      dataNuggets: payload.data_nuggets || [],
      seoKeywords: payload.seo_keywords || null,
      geoLocation: payload.geo_location || null,
      customInstructions: payload.custom_instructions || null,
      interlinkingContext: payload.interlinkingContext || null,
    });
    const lexiconBlock = buildRareLexiconAddon(lsiKeywords, isRussian ? "ru" : "en");
    const serpEntityBlock = buildSerpEntityDisciplineAddon(
      (competitors || []).map((c: any, i: number) => ({
        position: i + 1,
        deep_analysis: c.deep_analysis || null,
      })),
      isRussian ? "ru" : "en",
    );
    const systemPrompt = (lexiconBlock ? `${baseSystemPrompt}\n\n${lexiconBlock}` : baseSystemPrompt)
      + buildSerpClusterDisciplineAddon(isRussian ? "ru" : "en")
      + (isRussian ? buildAntiTurgenevAddon(getStyleProfile((job as any)?.author_profile?.style_analysis?.syntax_profile)) : "")
      + serpEntityBlock;

    const userPrompt = buildNewArticleUserPrompt(
      { seed_keyword: item.seed_keyword, intent: analysis.intent, difficulty: analysis.recommended_word_count ? 50 : 30, questions: analysis.questions || [] },
      outlineForPrompt.map((o: any) => `## ${o.text}`).join("\n"),
      (competitors || []).map((c: any, i: number) => `${i + 1}. "${c.title}" - ${c.snippet || ""}`).join("\n"),
      lsiKeywords.join(", "),
      (analysis.questions || []).join("\n- "),
      payload.miralinks_links || [],
      payload.gogetlinks_links || [],
      analysis.must_cover_topics || [],
      analysis.content_gaps || [],
      [],
      payload.expert_insights || [],
      payload.anchor_links || [],
      payload.seo_keywords || null,
      payload.geo_location || null,
      payload.custom_instructions || null,
    );

    const articleResp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Modul bulk-generate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: writerModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: authorProfile?.temperature ? Number(authorProfile.temperature) : 0.85,
      }),
    }, AI_TIMEOUT_MS);

    if (!articleResp.ok) {
      const errorText = await articleResp.text();
      throw new Error(`AI API error: ${articleResp.status} ${errorText}`);
    }

    const articleData = await articleResp.json();
    try { logLLM({ functionName: "bulk-generate", model: ((articleData as any)?.model) as string, tokensIn: Number((articleData as any)?.usage?.prompt_tokens || 0), tokensOut: Number((articleData as any)?.usage?.completion_tokens || 0) }); } catch(_) {}
    const rawContent = articleData.choices?.[0]?.message?.content || "";
    let articleContent = applyStealthPostProcess(rawContent, isRussian ? "ru" : "en");

    // ─── Auto Fact-Check Guard (FACTORY pipeline) ────────────────────
    // Apply server-side regex validator: strips fake experts, pseudo-stats,
    // fake organizations. Mirrors the client-side fact-check that runs in
    // ArticlesPage so bulk-generated articles get the same protection.
    const fc = validateContent(articleContent);
    if (fc.issues.length) {
      articleContent = fc.fixedContent;
      console.log(`[bulk-generate][fact-check] auto-fixed ${fc.issues.length} issues for "${item.seed_keyword}"`);
    }

    // ─── Data Nuggets enforcement ────────────────────────────────────
    // If <50% of supplied facts/numbers ended up in the text, run a
    // targeted insert-pass on Sonnet that organically weaves the missing
    // nuggets into the existing paragraphs (cheaper than full regen).
    let nuggetCoverage: number | null = null;
    try {
      const nuggetsList = (analysis as any)?.data_nuggets || [];
      if (Array.isArray(nuggetsList) && nuggetsList.length > 0) {
        const ne = await enforceDataNuggets(
          articleContent,
          nuggetsList,
          isRussian ? "ru" : "en",
          openRouterApiKey,
          0.5,
        );
        if (ne.applied) {
          articleContent = ne.content;
          console.log(`[bulk-generate][nuggets] coverage ${(ne.beforeRatio * 100).toFixed(0)}% -> ${(ne.afterRatio * 100).toFixed(0)}% (inserted ${ne.missingCount}) for "${item.seed_keyword}"`);
        } else if (ne.beforeRatio < 0.5) {
          console.warn(`[bulk-generate][nuggets] low coverage ${(ne.beforeRatio * 100).toFixed(0)}% for "${item.seed_keyword}" - insert pass skipped/rejected`);
        }
        nuggetCoverage = ne.afterRatio ?? ne.beforeRatio ?? null;
      }
    } catch (e) {
      console.warn(`[bulk-generate][nuggets] enforcement failed for "${item.seed_keyword}":`, (e as Error)?.message);
    }

    // ─── Persona enforcement (auto-rewrite) ──────────────────────────
    // Compare measured syntax stats against the expected syntax_profile.
    // If deviation > 30%, ask Sonnet for a single rhythm-rewrite pass.
    // Falls back to original content if integrity guard fails or if the
    // rewrite did not actually reduce deviation by ≥20%.
    let personaDeviation: number | null = null;
    try {
      const expectedProfile = (job as any)?.author_profile?.style_analysis?.syntax_profile;
      if (expectedProfile) {
        const enforced = await enforcePersonaSyntax(
          articleContent,
          expectedProfile,
          isRussian ? "ru" : "en",
          openRouterApiKey,
          0.3,
        );
        if (enforced.applied) {
          articleContent = enforced.content;
          console.log(`[bulk-generate][persona] rewrote syntax: ${(enforced.beforeDeviation * 100).toFixed(0)}% -> ${(enforced.afterDeviation * 100).toFixed(0)}% (profile=${expectedProfile}) for "${item.seed_keyword}"`);
        } else if (enforced.beforeDeviation > 0.3) {
          console.warn(`[bulk-generate][persona] high deviation ${(enforced.beforeDeviation * 100).toFixed(0)}% (profile=${expectedProfile}) for "${item.seed_keyword}" - rewrite skipped/rejected`);
        }
        personaDeviation = enforced.afterDeviation ?? enforced.beforeDeviation ?? null;
      }
    } catch (e) {
      console.warn(`[bulk-generate][persona] enforcement failed for "${item.seed_keyword}":`, (e as Error)?.message);
    }

    // ─── Double Humanize Pass (FACTORY) ──────────────────────────────
    // Sonnet (heavy rewrite) + Opus (micro-polish) target <5% AI detection.
    // Best-effort: failures or integrity-guard rejections preserve previous
    // content. Skipped for very short articles.
    try {
      const hum = await runDoubleHumanizePass(
        articleContent,
        isRussian ? "ru" : "en",
        openRouterApiKey,
        { admin, userId },
      );
      if (hum.passesApplied > 0) {
        articleContent = hum.content;
        console.log(`[bulk-generate][humanize] applied ${hum.passesApplied} pass(es) via ${hum.modelsUsed.join(", ")} for "${item.seed_keyword}"`);
      }
      if (hum.opusSkipped) {
        console.warn(`[bulk-generate][humanize] Opus skipped for user ${userId}: ${hum.opusSkipReason}`);
      }
    } catch (e) {
      console.warn(`[bulk-generate][humanize] failed for "${item.seed_keyword}":`, (e as Error)?.message);
    }

    const h1Match = articleContent.match(/^#\s+(.+)$/m);
    const articleTitle = h1Match?.[1] || item.seed_keyword;
    const metaDesc = articleContent
      .replace(/^#.+$/gm, "")
      .split(/\n\n+/)
      .map((paragraph: string) => paragraph.trim())
      .filter((paragraph: string) => paragraph.length > 30)[0]
      ?.replace(/[*_#`]/g, "")
      .slice(0, 160) || "";

    const { data: articleRecord } = await admin.from("articles").insert({
      user_id: userId,
      keyword_id: keywordId || null,
      author_profile_id: job.author_profile_id || null,
      title: articleTitle,
      content: articleContent,
      meta_description: metaDesc,
      status: "published",
      language: lang,
      geo,
      quality_status: "checking",
      serp_cluster_pipeline: true,
      generation_model: model || null,
      data_nuggets_coverage: nuggetCoverage,
      persona_deviation: personaDeviation,
    }).select("id").single();

    // Auto quality check (background, no credit)
    if (articleRecord?.id && articleContent && articleContent.length > 200) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        // fire-and-forget
        void fetch(`${supabaseUrl}/functions/v1/quality-check`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ article_id: articleRecord.id, content: articleContent, mode: "auto" }),
        }).catch(() => {});
        // fire-and-forget embedding for semantic interlinking
        void fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ article_id: articleRecord.id }),
        }).catch(() => {});
      } catch (_) { /* ignore */ }
    }

    // Optional: auto-publish to Blogger with natural delay
    if (articleRecord?.id && (job as any).auto_publish_blogger) {
      try {
        // Natural jitter: 2-5 minutes... but for serverless we use shorter 5-30s to fit edge runtime
        // The cron-like spacing happens because items are processed one-by-one already
        const jitterMs = 5000 + Math.floor(Math.random() * 25000);
        await sleep(jitterMs);
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        await fetch(`${supabaseUrl}/functions/v1/blogger-publish`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
            "x-queue-user-id": userId,
          },
          body: JSON.stringify({
            article_id: articleRecord.id,
            blog_id: (job as any).blogger_blog_id || undefined,
          }),
        });
      } catch (pubErr) {
        console.error("Bulk Blogger auto-publish failed:", pubErr);
      }
    }

    const nextCompletedCount = completedCount + 1;

    await admin.from("bulk_job_items").update({
      status: "done",
      article_id: articleRecord?.id || null,
      error_message: null,
    }).eq("id", item.id);

    await admin.from("bulk_jobs").update({ completed_items: nextCompletedCount }).eq("id", bulkJobId);
    return nextCompletedCount;
  } catch (error) {
    console.error(`Error processing bulk item ${item.id}:`, error);

    const nextCompletedCount = completedCount + 1;
    await admin.from("bulk_job_items").update({
      status: "error",
      error_message: error instanceof Error ? error.message : "Unknown error",
    }).eq("id", item.id);
    await admin.from("bulk_jobs").update({ completed_items: nextCompletedCount }).eq("id", bulkJobId);
    return nextCompletedCount;
  }
}

async function processBulkChunk(params: {
  admin: AdminClient;
  bulkJobId: string;
  userId: string;
  supabaseUrl: string;
  publicKey: string;
  serviceKey: string;
  openRouterApiKey: string;
}) {
  const { admin, bulkJobId, userId, supabaseUrl, publicKey, serviceKey, openRouterApiKey } = params;

  const { data: job } = await admin
    .from("bulk_jobs")
    .select("id, status, completed_items, author_profile_id, total_items, auto_publish_blogger, blogger_blog_id, language")
    .eq("id", bulkJobId)
    .eq("user_id", userId)
    .single();

  if (!job) throw new Error("Job not found");
  if (job.status === "paused" || job.status === "completed") return;

  await admin.from("bulk_jobs").update({ status: "processing" }).eq("id", bulkJobId);

  const [{ data: items }, { data: writerAssignment }, { data: researchAssignment }, { data: serperKeys }] = await Promise.all([
    admin.from("bulk_job_items").select("*").eq("bulk_job_id", bulkJobId).eq("status", "queued").order("created_at", { ascending: true }).limit(ITEMS_PER_RUN),
    admin.from("task_model_assignments").select("model_key").eq("task_key", "writer_pro").single(),
    admin.from("task_model_assignments").select("model_key").eq("task_key", "research_pro").single(),
    admin.from("api_keys").select("api_key").eq("provider", "serper").eq("is_valid", true).limit(1),
  ]);

  if (!items?.length) {
    await finalizeJob(admin, bulkJobId, job.completed_items || 0);
    return;
  }

  const authorProfile = await fetchAuthorProfile(admin, job.author_profile_id || null);
  const effectiveAuthor = authorProfile
    || (await resolveAutoAuthorByNiche(admin, userId));
  if (!authorProfile && effectiveAuthor) {
    console.log("[bulk-generate] Auto-selected persona by niche for job", bulkJobId, "->", effectiveAuthor.name);
  }
  const writerModel = writerAssignment?.model_key || "google/gemini-2.5-pro";
  const researchModel = researchAssignment?.model_key || "google/gemini-2.5-flash";
  const serperApiKey = serperKeys?.[0]?.api_key || null;

  let completedCount = job.completed_items || 0;

  for (const item of items) {
    const { data: jobCheck } = await admin.from("bulk_jobs").select("status").eq("id", bulkJobId).single();
    if (jobCheck?.status === "paused") return;

    completedCount = await processQueuedItem({
      admin,
      item,
      job,
      userId,
      openRouterApiKey,
      serperApiKey,
      writerModel,
      researchModel,
      authorProfile: effectiveAuthor,
      bulkJobId,
      completedCount,
    });
  }

  const summary = await finalizeJob(admin, bulkJobId, completedCount);
  if (summary.nextStatus === "processing" && summary.hasQueued) {
    await scheduleNextChunk({
      supabaseUrl,
      publicKey,
      serviceKey,
      bulkJobId,
      userId,
    });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || serviceKey;

    if (!supabaseUrl || !serviceKey || !publicKey) throw new Error("Server configuration error");

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: openRouterKeyRow } = await admin.from("api_keys").select("api_key").eq("provider", "openrouter").eq("is_valid", true).single();
    const openRouterApiKey = openRouterKeyRow?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterApiKey) throw new Error("OpenRouter API key not configured");

    const userId = getUserIdFromRequest(req);
    const { data: profile } = await admin.from("profiles").select("plan").eq("id", userId).single();
    // DB plan ids: basic = NANO, pro = PRO, factory = FACTORY.
    // Bulk available on PRO and FACTORY only. NANO (basic) blocked.
    const planRaw = String(profile?.plan || "").toLowerCase().trim().replace(/[^a-z]/g, "");
    const allowedPlans = new Set(["pro", "factory", "business", "enterprise", "admin"]);
    console.log("[bulk-generate][plan-check] user:", userId, "plan:", profile?.plan, "key:", planRaw, "allowed:", allowedPlans.has(planRaw));
    if (!profile || !allowedPlans.has(planRaw)) {
      return jsonResponse({ error: "Массовая генерация доступна только на тарифах PRO и FACTORY" }, 403);
    }

    const { bulk_job_id } = await req.json();
    if (!bulk_job_id) throw new Error("bulk_job_id is required");

    const { data: job } = await admin
      .from("bulk_jobs")
      .select("id, user_id, status, completed_items")
      .eq("id", bulk_job_id)
      .eq("user_id", userId)
      .single();

    if (!job) throw new Error("Job not found");

    const { count: queuedCount } = await admin
      .from("bulk_job_items")
      .select("id", { count: "exact", head: true })
      .eq("bulk_job_id", bulk_job_id)
      .eq("status", "queued");

    if (!queuedCount) {
      await finalizeJob(admin, bulk_job_id, job.completed_items || 0);
      return jsonResponse({ message: "No items to process", bulk_job_id });
    }

    await admin.from("bulk_jobs").update({ status: "processing" }).eq("id", bulk_job_id);

    const backgroundTask = processBulkChunk({
      admin,
      bulkJobId: bulk_job_id,
      userId,
      supabaseUrl,
      publicKey,
      serviceKey,
      openRouterApiKey,
    }).catch(async (error) => {
      console.error("bulk-generate background error:", error);
      await admin.from("bulk_jobs").update({ status: "paused" }).eq("id", bulk_job_id);
    });

    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(backgroundTask);
      return jsonResponse({ accepted: true, bulk_job_id, queued: queuedCount }, 202);
    }

    await backgroundTask;
    return jsonResponse({ accepted: true, bulk_job_id, queued: queuedCount });
  } catch (error) {
    console.error("bulk-generate error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("Forbidden") || message.includes("PRO") ? 403 : message.includes("Unauthorized") ? 401 : 500;
    return jsonResponse({ error: message }, status);
  }
});