import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function getAuthorPrompt(admin: AdminClient, authorProfileId: string | null) {
  if (!authorProfileId) return "";

  const { data: author } = await admin.from("author_profiles").select("voice_tone, system_prompt_override, stop_words").eq("id", authorProfileId).single();
  if (!author) return "";

  let authorPrompt = `\n\nАвторский стиль: ${author.voice_tone || "нейтральный"}. ${author.system_prompt_override || ""}`;
  if (author.stop_words?.length) {
    authorPrompt += `\nНе используй слова: ${author.stop_words.join(", ")}`;
  }

  return authorPrompt;
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

  const response = await fetchWithTimeout(`${params.supabaseUrl}/functions/v1/bulk-generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.serviceKey}`,
      apikey: params.publicKey,
      "Content-Type": "application/json",
      "x-bulk-user-id": params.userId,
    },
    body: JSON.stringify({ bulk_job_id: params.bulkJobId }),
  }, 10000);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to schedule next bulk chunk:", response.status, errorText);
    throw new Error(`Failed to schedule next chunk: ${response.status}`);
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
  authorPrompt: string;
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
    authorPrompt,
    bulkJobId,
    completedCount,
  } = params;

  try {
    await admin.from("bulk_job_items").update({ status: "researching", error_message: null }).eq("id", item.id);

    const isRussian = /[а-яё]/i.test(item.seed_keyword);
    const geo = isRussian ? "ru" : "us";
    const lang = isRussian ? "ru" : "en";

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
    const articleLang = isRussian ? "русском" : "English";

    const articlePrompt = `Write a comprehensive SEO article on the topic: "${item.seed_keyword}"
Language: ${articleLang}
${headings.length > 0 ? `Use these headings: ${headings.join(", ")}` : ""}
${lsiKeywords.length > 0 ? `Include LSI keywords: ${lsiKeywords.join(", ")}` : ""}
Target word count: ${analysis.recommended_word_count || 2000}
Format: Markdown with proper H2/H3 headings.${authorPrompt}`;

    const articleResp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: writerModel,
        messages: [{ role: "user", content: articlePrompt }],
      }),
    }, AI_TIMEOUT_MS);

    if (!articleResp.ok) {
      const errorText = await articleResp.text();
      throw new Error(`AI API error: ${articleResp.status} ${errorText}`);
    }

    const articleData = await articleResp.json();
    const articleContent = articleData.choices?.[0]?.message?.content || "";

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
    }).select("id").single();

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
    .select("id, status, completed_items, author_profile_id, total_items")
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

  const authorPrompt = await getAuthorPrompt(admin, job.author_profile_id || null);
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
      authorPrompt,
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
    if (!profile || profile.plan !== "pro") {
      return jsonResponse({ error: "Bulk generation is only available on the PRO plan" }, 403);
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