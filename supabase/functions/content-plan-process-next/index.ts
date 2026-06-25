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
  // Find one queued topic
  let q = a.from("content_topics").select("id, plan_id, title, attempts").eq("gen_status", "queued").limit(1);
  if (topicId) q = q.eq("id", topicId);
  else q = q.eq("plan_id", planId).order("position");
  const { data: rows } = await q;
  const row = (rows ?? [])[0];
  if (!row) return null;
  // Mark processing
  const { data: upd } = await a.from("content_topics")
    .update({ gen_status: "processing", attempts: (row.attempts ?? 0) + 1, gen_error: null })
    .eq("id", row.id).eq("gen_status", "queued").select("id").maybeSingle();
  if (!upd) return null; // lost race
  return row;
}

async function fireSelf(planId: string) {
  // fire-and-forget chain
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/content-plan-process-next`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({ plan_id: planId }),
    });
  } catch (_) { /* ignore */ }
}

async function processOne(planId: string, topicId: string | undefined): Promise<{ processed: boolean; planId: string | null }> {
  const a = admin();
  const claimed = await claimNext(planId, topicId);
  if (!claimed) return { processed: false, planId: null };

  // Load plan + client
  const { data: plan } = await a.from("content_plans")
    .select("id, template_settings, client_id, content_clients(name, domain, niche)")
    .eq("id", claimed.plan_id).maybeSingle();
  const settings = (plan?.template_settings ?? {}) as any;
  const client: any = (plan as any)?.content_clients ?? {};

  const lengthMap: Record<string, number> = { short: 2800, medium: 4500, long: 6500 };
  const lengthKey = String(settings.length || "medium");
  const length = lengthMap[lengthKey] ?? 4500;
  const persona = String(settings.persona_id || "freeform");
  const stealth = !!settings.stealth;
  const extra = String(settings.extra_instructions || "").slice(0, 1500);
  const audience = [client.niche, settings.language === "en" ? "EN" : "RU", extra].filter(Boolean).join(" · ").slice(0, 1000);

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/vc-writer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({
        format: "guide",
        topic: claimed.title,
        audience,
        length,
        humanize: true,
        fact_check: true,
        author_persona: persona,
        stealth,
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `vc-writer ${res.status}`);
    const md: string = String(json?.markdown ?? "");
    if (!md) throw new Error("Empty markdown");
    await a.from("content_topics").update({
      gen_status: "done",
      article_markdown: md,
      article_title: json?.meta?.title ?? claimed.title,
      article_meta: json?.meta ?? null,
      generated_at: new Date().toISOString(),
      gen_error: null,
    }).eq("id", claimed.id);
  } catch (e: any) {
    const msg = String(e?.message ?? "error").slice(0, 500);
    const next = (claimed.attempts ?? 0) + 1 < MAX_ATTEMPTS ? "queued" : "error";
    await a.from("content_topics").update({ gen_status: next, gen_error: msg }).eq("id", claimed.id);
  }
  return { processed: true, planId: claimed.plan_id };
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const auth = await authorize(req);
  if (auth instanceof Response) return auth;

  const body = await req.json().catch(() => ({}));
  const planId = String(body.plan_id || "");
  const topicId = body.topic_id ? String(body.topic_id) : undefined;

  // Run synchronously so single-topic callers can wait. For chained calls,
  // we immediately fire-and-forget the next one so each invocation stays short.
  const { processed, planId: pid } = await processOne(planId, topicId);

  if (processed && !topicId && pid) {
    // Chain to next queued in the plan without blocking response.
    // @ts-ignore EdgeRuntime is available in Supabase Edge Functions
    if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(fireSelf(pid));
    } else {
      await fireSelf(pid);
    }
  }

  return jsonResponse({ ok: true, processed });
});