// Background worker that drains the commerce content generation queue.
//
// Cron (every minute) -> claim ONE enabled autorun row with a lease ->
// call generate-commerce-content for a bounded batch -> update progress.
//
// Guarantees:
//  - bounded work per run (batch_size, max 40 pages)
//  - single-flight lock via lease_until
//  - idempotent progress (content_status on the rows themselves)
//  - circuit breaker: AI budget/auth aborts pause the project
//  - paused projects are skipped at every entry point

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";

const LEASE_MS = 4 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireWorkerAuth(req: Request, admin: any): Promise<Response | null> {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && authHeader === `Bearer ${serviceKey}`) return null;
  try {
    const { data } = await admin
      .from("internal_cron_secrets")
      .select("secret_value")
      .eq("name", "commerce_content_worker")
      .maybeSingle();
    const secret = String(data?.secret_value || "");
    if (secret && authHeader === `Bearer ${secret}`) return null;
  } catch (e) {
    console.warn("[commerce-content-worker] secret lookup failed:", (e as Error).message);
  }
  return json({ error: "Unauthorized: worker token required" }, 401);
}

async function pendingCount(admin: any, projectId: string): Promise<number> {
  const { count } = await admin
    .from("site_products")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .or("content_status.is.null,content_status.in.(pending,failed)");
  return Number(count || 0);
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const authError = await requireWorkerAuth(req, admin);
  if (authError) return authError;

  try {
    const nowIso = new Date().toISOString();

    // 1. Candidates: enabled, not paused/done, lease free.
    const { data: rows, error } = await admin
      .from("commerce_content_autorun")
      .select("project_id, user_id, batch_size, processed_total, status, lease_until")
      .eq("enabled", true)
      .in("status", ["idle", "running"])
      .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
      .order("last_run_at", { ascending: true, nullsFirst: true })
      .limit(3);
    if (error) throw error;
    if (!rows?.length) return json({ ok: true, idle: true });

    const job = rows[0];
    const projectId = String(job.project_id);
    const batch = Math.min(Math.max(Number(job.batch_size || 10), 1), 40);

    // 2. Single-flight claim.
    const lease = new Date(Date.now() + LEASE_MS).toISOString();
    const { data: claimed } = await admin
      .from("commerce_content_autorun")
      .update({ status: "running", lease_until: lease, last_run_at: nowIso })
      .eq("project_id", projectId)
      .eq("enabled", true)
      .in("status", ["idle", "running"])
      .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
      .select("project_id")
      .maybeSingle();
    if (!claimed) return json({ ok: true, skipped: "not_claimed" });

    // 3. Nothing left to do -> stop cleanly.
    const remaining = await pendingCount(admin, projectId);
    if (remaining === 0) {
      await admin
        .from("commerce_content_autorun")
        .update({ status: "done", enabled: false, lease_until: null, last_error: null })
        .eq("project_id", projectId);
      return json({ ok: true, project_id: projectId, done: true });
    }

    // 4. Bounded batch through the existing generator.
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-commerce-content`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "x-queue-user-id": String(job.user_id),
      },
      body: JSON.stringify({
        project_id: projectId,
        scope: "products",
        only_missing: true,
        limit: batch,
      }),
    });

    const text = await res.text();
    let payload: any = null;
    try { payload = JSON.parse(text); } catch { /* keep raw */ }

    // 5. Circuit breaker / error handling.
    if (!res.ok) {
      const terminal = res.status === 402 || res.status === 403 || res.status === 400;
      await admin
        .from("commerce_content_autorun")
        .update({
          status: terminal ? "paused" : "idle",
          paused_reason: terminal ? `http_${res.status}` : null,
          last_error: text.slice(0, 500),
          lease_until: null,
        })
        .eq("project_id", projectId);
      return json({ ok: false, project_id: projectId, status: res.status, error: text.slice(0, 300) }, 200);
    }

    if (payload?.aborted) {
      await admin
        .from("commerce_content_autorun")
        .update({
          status: "paused",
          paused_reason: String(payload.aborted),
          last_error: String(payload.aborted),
          lease_until: null,
        })
        .eq("project_id", projectId);
      return json({ ok: false, project_id: projectId, paused: String(payload.aborted) });
    }

    const generated = Number(payload?.generated || 0);
    const failed = Number(payload?.failed || 0);
    const left = await pendingCount(admin, projectId);

    await admin
      .from("commerce_content_autorun")
      .update({
        status: left === 0 ? "done" : "idle",
        enabled: left !== 0,
        lease_until: null,
        last_error: null,
        paused_reason: null,
        processed_total: Number(job.processed_total || 0) + generated,
      })
      .eq("project_id", projectId);

    return json({ ok: true, project_id: projectId, generated, failed, remaining: left });
  } catch (e) {
    console.error("[commerce-content-worker]", e);
    return json({ error: (e as Error)?.message || "unexpected error" }, 500);
  }
});
