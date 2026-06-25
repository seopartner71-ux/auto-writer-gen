// Processes ONE queued content_topic at a time. Can be invoked:
//  - by client (admin/staff JWT) for a single topic via topic_id
//  - by content-plan-start-queue (service-role) to drain plan_id queue.
// On success it self-invokes for the next queued topic in the same plan.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAX_ATTEMPTS = 2;
const STUCK_PROCESSING_MS = 2 * 60 * 1000;
const VC_WRITER_TIMEOUT_MS = 120 * 1000;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

async function isAdminOrStaff(userId: string): Promise<boolean> {
  const { data } = await admin().from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  return roles.includes("admin") || roles.includes("staff");
}

async function authorize(req: Request): Promise<{ ok: true; isService: boolean } | Response> {
  const auth = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  if (auth === `Bearer ${SERVICE_KEY}`) return { ok: true, isService: true };
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return errorResponse("Unauthorized", 401);
  try {
    const { data, error } = await admin().auth.getClaims(token);
    if (error || !data?.claims?.sub) return errorResponse("Unauthorized", 401);
    if (!(await isAdminOrStaff(data.claims.sub))) return errorResponse("Forbidden", 403);
    return { ok: true, isService: false };
  } catch {
    return errorResponse("Unauthorized", 401);
  }
}

async function claimNext(planId: string, topicId?: string) {
  const a = admin();
  console.log("[content-plan-process-next] claimNext:start", { plan_id: planId || null, topic_id: topicId || null });
  // Find one queued topic
  let q = a.from("content_topics").select("id, plan_id, title, attempts, description").eq("gen_status", "queued").limit(1);
  if (topicId) q = q.eq("id", topicId);
  else q = q.eq("plan_id", planId).order("position");
  const { data: rows, error: selectError } = await q;
  if (selectError) {
    console.error("[content-plan-process-next] claimNext:select_error", { message: selectError.message, code: (selectError as any).code });
    throw selectError;
  }
  const row = (rows ?? [])[0];
  if (!row) {
    console.log("[content-plan-process-next] claimNext:no_queued_topic", { plan_id: planId || null, topic_id: topicId || null });
    return null;
  }
  console.log("[content-plan-process-next] claimNext:found", { topic_id: row.id, plan_id: row.plan_id, attempts: row.attempts ?? 0 });
  // Mark processing
  const { data: upd, error: updateError } = await a.from("content_topics")
    .update({ gen_status: "processing", attempts: (row.attempts ?? 0) + 1, gen_error: null })
    .eq("id", row.id).eq("gen_status", "queued").select("id").maybeSingle();
  if (updateError) {
    console.error("[content-plan-process-next] claimNext:update_error", { topic_id: row.id, message: updateError.message, code: (updateError as any).code });
    throw updateError;
  }
  if (!upd) {
    console.warn("[content-plan-process-next] claimNext:lost_race", { topic_id: row.id });
    return null;
  }
  console.log("[content-plan-process-next] claimNext:processing", { topic_id: row.id, attempts_next: (row.attempts ?? 0) + 1 });
  return row;
}

async function resetStuckProcessing(planId?: string, topicId?: string) {
  const a = admin();
  const cutoff = new Date(Date.now() - STUCK_PROCESSING_MS).toISOString();
  console.log("[content-plan-process-next] stuck_guard:start", { plan_id: planId || null, topic_id: topicId || null, cutoff });

  let toErrorQuery = a.from("content_topics")
    .update({ gen_status: "error", gen_error: "Timeout: задача зависла в processing больше 2 минут" })
    .eq("gen_status", "processing")
    .lt("updated_at", cutoff)
    .gte("attempts", MAX_ATTEMPTS);
  if (topicId) toErrorQuery = toErrorQuery.eq("id", topicId);
  else if (planId) toErrorQuery = toErrorQuery.eq("plan_id", planId);
  const { data: errored, error: errorUpdateError } = await toErrorQuery.select("id, attempts");
  if (errorUpdateError) {
    console.error("[content-plan-process-next] stuck_guard:error_update_failed", { message: errorUpdateError.message, code: (errorUpdateError as any).code });
  }

  let toQueuedQuery = a.from("content_topics")
    .update({ gen_status: "queued", gen_error: "Автоповтор после зависания processing" })
    .eq("gen_status", "processing")
    .lt("updated_at", cutoff)
    .or(`attempts.is.null,attempts.lt.${MAX_ATTEMPTS}`);
  if (topicId) toQueuedQuery = toQueuedQuery.eq("id", topicId);
  else if (planId) toQueuedQuery = toQueuedQuery.eq("plan_id", planId);
  const { data: requeued, error: requeueError } = await toQueuedQuery.select("id, attempts");
  if (requeueError) {
    console.error("[content-plan-process-next] stuck_guard:requeue_failed", { message: requeueError.message, code: (requeueError as any).code });
  }

  console.log("[content-plan-process-next] stuck_guard:done", {
    requeued: (requeued ?? []).length,
    errored: (errored ?? []).length,
    requeued_ids: (requeued ?? []).map((x: any) => x.id),
    errored_ids: (errored ?? []).map((x: any) => x.id),
  });
}

async function fireSelf(planId: string) {
  // fire-and-forget chain
  try {
    console.log("[content-plan-process-next] fireSelf:start", { plan_id: planId });
    await fetch(`${SUPABASE_URL}/functions/v1/content-plan-process-next`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({ plan_id: planId }),
    });
    console.log("[content-plan-process-next] fireSelf:sent", { plan_id: planId });
  } catch (e: any) {
    console.error("[content-plan-process-next] fireSelf:failed", { plan_id: planId, message: String(e?.message ?? e) });
  }
}

function runInBackground(task: Promise<unknown>) {
  const guarded = task.catch((e: any) => {
    console.error("[content-plan-process-next] background:failed", { message: String(e?.message ?? e) });
  });
  // @ts-ignore EdgeRuntime is available in Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(guarded);
  }
}

async function drainOnce(planId: string, topicId?: string) {
  await resetStuckProcessing(planId || undefined, topicId);
  const { processed, planId: pid } = await processOne(planId, topicId);

  if (processed && !topicId && pid) {
    await fireSelf(pid);
  }

  console.log("[content-plan-process-next] drainOnce:finish", { processed, plan_id: pid, topic_id: topicId || null });
}

async function processOne(planId: string, topicId: string | undefined): Promise<{ processed: boolean; planId: string | null }> {
  const a = admin();
  console.log("[content-plan-process-next] processOne:start", { plan_id: planId || null, topic_id: topicId || null });
  const claimed = await claimNext(planId, topicId);
  if (!claimed) {
    console.log("[content-plan-process-next] processOne:nothing_to_process", { plan_id: planId || null, topic_id: topicId || null });
    return { processed: false, planId: null };
  }

  try {
    // Load plan + client
    console.log("[content-plan-process-next] plan_load:start", { plan_id: claimed.plan_id, topic_id: claimed.id });
    const { data: plan, error: planError } = await a.from("content_plans")
      .select("id, template_settings, client_id, created_by, content_clients(name, domain, niche)")
      .eq("id", claimed.plan_id).maybeSingle();
    if (planError) {
      console.error("[content-plan-process-next] plan_load:failed", { plan_id: claimed.plan_id, message: planError.message, code: (planError as any).code });
      throw planError;
    }
    console.log("[content-plan-process-next] plan_load:done", { plan_id: claimed.plan_id, has_plan: !!plan, owner_user_id: (plan as any)?.created_by ?? null });
    const settings = (plan?.template_settings ?? {}) as any;
    const client: any = (plan as any)?.content_clients ?? {};
    const ownerUserId: string | null = (plan as any)?.created_by ?? null;

    const lengthMap: Record<string, number> = { short: 2800, medium: 4500, long: 6500 };
    const lengthKey = String(settings.length || "medium");
    const length = lengthMap[lengthKey] ?? 4500;
    const personaRaw = String(settings.persona_id || "freeform");
    const stealth = !!settings.stealth;
    let extra = String(settings.extra_instructions || "").slice(0, 1500);
    const topicDescription = String((claimed as any).description || "").trim();
    if (topicDescription) {
      const topicTitle = String(claimed.title || "").trim();
      const block = `\n\nТребования к статье «${topicTitle}»: ${topicDescription}`.slice(0, 2000);
      extra = (extra + block).slice(0, 3500);
    }
    const audience = [client.niche, settings.language === "en" ? "EN" : "RU", extra].filter(Boolean).join(" · ").slice(0, 1000);

    // Load FULL author profile from author_profiles when persona_id is a UUID.
    // Mirrors how /articles -> generate-article loads author by author_profile_id.
    // Five legacy persona codes (agency/inhouse/brand_owner/expert/freeform) still pass through.
    const LEGACY_PERSONAS = new Set(["agency", "inhouse", "brand_owner", "expert", "freeform"]);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personaRaw);
    let authorProfilePayload: any = null;
    let personaCode = LEGACY_PERSONAS.has(personaRaw) ? personaRaw : "freeform";
    if (isUuid) {
      const { data: author, error: authorErr } = await a.from("author_profiles").select("*").eq("id", personaRaw).maybeSingle();
      if (authorErr) {
        console.warn("[content-plan-process-next] author_load:failed", { persona_id: personaRaw, message: authorErr.message });
      } else if (author) {
        // system_prompt = full author voice + per-project extra_instructions appended (not replaced).
        const baseSystem = String(author.system_prompt_override || author.system_instruction || "").trim();
        const merged = extra
          ? (baseSystem ? `${baseSystem}\n\nДополнительно для этого проекта: ${extra}` : `Дополнительно для этого проекта: ${extra}`)
          : baseSystem;
        authorProfilePayload = {
          id: author.id,
          name: author.name,
          system_prompt: merged || undefined,
          voice_tone: author.voice_tone || undefined,
          style_examples: author.style_examples || undefined,
          stop_words: Array.isArray(author.stop_words) ? author.stop_words : undefined,
          negative_instructions: (author as any).negative_instructions || undefined,
        };
        console.log("[content-plan-process-next] author_load:done", {
          author_id: author.id,
          author_name: author.name,
          has_system_prompt: !!merged,
          stop_words_count: Array.isArray(author.stop_words) ? author.stop_words.length : 0,
        });
      }
    }

    console.log("[content-plan-process-next] vc_writer:start", {
      topic_id: claimed.id,
      title: claimed.title,
      length,
      persona: personaCode,
      author_profile_id: authorProfilePayload?.id || null,
      stealth,
      timeout_ms: VC_WRITER_TIMEOUT_MS,
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("vc-writer timeout"), VC_WRITER_TIMEOUT_MS);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/vc-writer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: ANON_KEY,
          ...(ownerUserId ? { "x-queue-user-id": ownerUserId } : {}),
        },
        body: JSON.stringify({
          format: "guide",
          topic: claimed.title,
          audience,
          length,
          humanize: stealth || true,
          fact_check: true,
          author_persona: personaCode,
          author_profile: authorProfilePayload || undefined,
          stealth,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));
    console.log("[content-plan-process-next] vc_writer:response", { topic_id: claimed.id, status: res.status, ok: res.ok });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `vc-writer ${res.status}`);
    const md: string = String(json?.markdown ?? "");
    if (!md) throw new Error("Empty markdown");
    console.log("[content-plan-process-next] vc_writer:markdown_ready", { topic_id: claimed.id, content_len: md.length });

    // Persist into central articles table so the topic is available in /articles
    // and the standard pipeline (quality, export, publish) treats it as a regular article.
    let articleId: string | null = null;
    if (ownerUserId) {
      const lang = String(settings.language || "ru").toLowerCase() === "en" ? "en" : "ru";
      const insertPayload = {
        user_id: ownerUserId,
        title: json?.meta?.title ?? claimed.title,
        content: md,
        status: "completed",
        language: lang,
        geo: lang === "ru" ? "ru" : "us",
        source: "content_plan",
        content_topic_id: claimed.id,
      };
      console.log("[content-plan] inserting article", {
        topic_id: claimed.id,
        plan_id: claimed.plan_id,
        user_id: ownerUserId,
        source: "content_plan",
        title_len: insertPayload.title?.length ?? 0,
        content_len: md.length,
      });
      const { data: art, error: artErr } = await a.from("articles")
        .insert(insertPayload).select("id").single();
      if (artErr) {
        console.error("[content-plan] article insert FAILED", {
          topic_id: claimed.id,
          error: artErr.message,
          code: (artErr as any).code,
          details: (artErr as any).details,
          hint: (artErr as any).hint,
        });
      } else {
        articleId = art?.id ?? null;
        console.log("[content-plan] article inserted", { article_id: articleId, topic_id: claimed.id });
      }
    } else {
      console.warn("[content-plan] skipping article insert - no ownerUserId", { topic_id: claimed.id, plan_id: claimed.plan_id });
    }

    console.log("[content-plan-process-next] topic_update_done:start", { topic_id: claimed.id, article_id: articleId });
    const { error: doneError } = await a.from("content_topics").update({
      gen_status: "done",
      article_markdown: md,
      article_title: json?.meta?.title ?? claimed.title,
      article_meta: json?.meta ?? null,
      article_id: articleId,
      generated_at: new Date().toISOString(),
      gen_error: null,
    }).eq("id", claimed.id);
    if (doneError) {
      console.error("[content-plan-process-next] topic_update_done:failed", { topic_id: claimed.id, message: doneError.message, code: (doneError as any).code });
      throw doneError;
    }
    console.log("[content-plan-process-next] topic_update_done:success", { topic_id: claimed.id, article_id: articleId });
  } catch (e: any) {
    const isAbort = e?.name === "AbortError" || /aborted|timeout/i.test(String(e?.message ?? ""));
    const msg = isAbort
      ? "Timeout: превышено время ожидания"
      : String(e?.message ?? "error").slice(0, 500);
    const attemptsUsed = (claimed.attempts ?? 0) + 1;
    const next = attemptsUsed < MAX_ATTEMPTS ? "queued" : "error";
    console.error("[content-plan-process-next] processOne:failed", {
      topic_id: claimed.id,
      plan_id: claimed.plan_id,
      next_status: next,
      attempts_used: attemptsUsed,
      is_abort: isAbort,
      error: msg,
    });
    const { error: failUpdateError } = await a.from("content_topics").update({ gen_status: next, gen_error: msg }).eq("id", claimed.id);
    if (failUpdateError) {
      console.error("[content-plan-process-next] processOne:fail_status_update_failed", { topic_id: claimed.id, message: failUpdateError.message, code: (failUpdateError as any).code });
    }
  }
  console.log("[content-plan-process-next] processOne:finish", { topic_id: claimed.id, plan_id: claimed.plan_id });
  return { processed: true, planId: claimed.plan_id };
}

serve(async (req) => {
  console.log("[content-plan-process-next] request:start", { method: req.method });
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const auth = await authorize(req);
  if (auth instanceof Response) return auth;
  console.log("[content-plan-process-next] auth:ok", { is_service: auth.isService });

  const body = await req.json().catch(() => ({}));
  const planId = String(body.plan_id || "");
  const topicId = body.topic_id ? String(body.topic_id) : undefined;
  console.log("[content-plan-process-next] request:body", { plan_id: planId || null, topic_id: topicId || null });
  // No params = global drain: pick any queued topic from any plan (cron/recovery).
  if (!planId && !topicId) {
    const a = admin();
    await resetStuckProcessing();
    const { data: anyQueued } = await a.from("content_topics")
      .select("plan_id").eq("gen_status", "queued").limit(1).maybeSingle();
    if (!anyQueued?.plan_id) {
      return jsonResponse({ ok: true, processed: false, drained: true });
    }
    runInBackground(drainOnce(anyQueued.plan_id, undefined));
    return jsonResponse({ ok: true, accepted: true, drained: true, plan_id: anyQueued.plan_id }, 202);
  }

  runInBackground(drainOnce(planId, topicId));

  console.log("[content-plan-process-next] request:accepted", { plan_id: planId || null, topic_id: topicId || null });
  return jsonResponse({ ok: true, accepted: true }, 202);
});