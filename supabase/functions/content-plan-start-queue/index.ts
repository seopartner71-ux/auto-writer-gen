// Starts the writing queue for a content plan: saves template_settings,
// marks selected topics as 'queued', kicks the background drain loop.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdminOrStaff } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const ALLOWED_LENGTH = new Set(["short", "medium", "long"]);
const ALLOWED_LANG = new Set(["ru", "en"]);
const ALLOWED_PERSONAS = new Set(["agency", "inhouse", "brand_owner", "expert", "freeform"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizePersona(val: unknown): string {
  const v = String(val ?? "").trim();
  if (ALLOWED_PERSONAS.has(v)) return v;
  if (UUID_RE.test(v)) return v; // author_profiles.id
  return "freeform";
}

function sanitizeSettings(s: any) {
  return {
    persona_id: sanitizePersona(s?.persona_id),
    length: ALLOWED_LENGTH.has(String(s?.length)) ? String(s.length) : "medium",
    language: ALLOWED_LANG.has(String(s?.language)) ? String(s.language) : "ru",
    stealth: !!s?.stealth,
    extra_instructions: String(s?.extra_instructions || "").slice(0, 1500),
  };
}

async function fireProcessNext(planId: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/content-plan-process-next`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify({ plan_id: planId }),
    });
  } catch (_) { /* ignore */ }
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const auth = await verifyAuth(req);
  if (auth instanceof Response) return auth;
  const guard = await requireAdminOrStaff(auth);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const planId = String(body.plan_id || "");
  if (!planId) return errorResponse("plan_id required", 400);
  const topicIds: string[] | undefined = Array.isArray(body.topic_ids) && body.topic_ids.length
    ? body.topic_ids.map((x: any) => String(x)).slice(0, 200) : undefined;
  const settings = sanitizeSettings(body.settings);
  const persist = body.persist_settings !== false;

  const a = adminClient();

  if (persist) {
    const { error: e1 } = await a.from("content_plans").update({ template_settings: settings }).eq("id", planId);
    if (e1) return errorResponse(`settings: ${e1.message}`, 500);
  }

  // Old plans may have no owner. The writer needs a real user id for history
  // and for the internal x-queue-user-id auth header.
  await a.from("content_plans").update({ created_by: auth.userId }).eq("id", planId).is("created_by", null);

  // Mark ok-status topics as queued
  let q = a.from("content_topics").update({ gen_status: "queued", gen_error: null, attempts: 0 })
    .eq("plan_id", planId).eq("status", "ok").neq("gen_status", "done").neq("gen_status", "processing");
  if (topicIds) q = q.in("id", topicIds);
  const { data: queued, error: e2 } = await q.select("id");
  if (e2) return errorResponse(`queue: ${e2.message}`, 500);

  await a.from("content_plans").update({ status: "in_progress" }).eq("id", planId);

  // Kick the drain loop without blocking response
  // @ts-ignore EdgeRuntime is available in Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(fireProcessNext(planId));
  } else {
    fireProcessNext(planId);
  }

  return jsonResponse({ ok: true, queued: (queued ?? []).length });
});