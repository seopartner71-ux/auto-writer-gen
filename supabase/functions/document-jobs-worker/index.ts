// Background worker for heavy document types (whitepaper, catalog).
// Dispatcher generate-document enqueues a row in document_generation_jobs
// when document_types.generation_pattern='background'. This function is
// invoked periodically (via pg_cron) and by generate-document as a nudge.
//
// Per invocation it:
// 1) resets stuck ecosystem_formats rows (>5 min in 'generating') to failed
// 2) claims up to N queued jobs and fires generate-doc-universal for each
//    (fire-and-forget — universal function itself has 130s hard-timeout).
//
// Safe to call many times; jobs are claimed atomically by row status.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";

const MAX_JOBS_PER_TICK = 1;
const MAX_ATTEMPTS = 3;

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const authError = await requireWorkerAuth(req, admin);
    if (authError) return authError;

    // 1. Reset stuck generations across all types (safety net).
    let stuckReset = 0;
    try {
      const { data } = await admin.rpc("reset_stuck_document_generations");
      stuckReset = Number(data ?? 0);
    } catch (e) {
      console.warn("[document-jobs-worker] reset_stuck_document_generations failed:", (e as Error).message);
    }

    // 2. Claim queued jobs.
    const { data: jobs, error: jErr } = await admin
      .from("document_generation_jobs")
      .select("id, ecosystem_format_id, user_id, attempts")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(MAX_JOBS_PER_TICK);
    if (jErr) throw jErr;

    const started: string[] = [];
    const seenFormats = new Set<string>();
    for (const job of jobs || []) {
      const formatId = String((job as any).ecosystem_format_id || "");
      if (seenFormats.has(formatId)) {
        await admin
          .from("document_generation_jobs")
          .update({
            status: "failed",
            last_error: "Duplicate queued job skipped",
            completed_at: new Date().toISOString(),
          })
          .eq("id", (job as any).id)
          .eq("status", "queued");
        continue;
      }
      seenFormats.add(formatId);

      // Mark processing before firing so a second worker tick skips it.
      const { error: uErr } = await admin
        .from("document_generation_jobs")
        .update({
          status: "processing",
          attempts: (job as any).attempts + 1,
          claimed_at: new Date().toISOString(),
        })
        .eq("id", (job as any).id)
        .eq("status", "queued"); // guard against races
      if (uErr) {
        console.warn("[document-jobs-worker] claim failed:", uErr.message);
        continue;
      }

      // Fire generate-doc-universal without blocking the cron HTTP response.
      // The universal generator marks the job completed/failed when the real
      // background generation finishes; here we only verify that the request was accepted.
      const invokeTask = invokeUniversal(admin, job as any, formatId);
      const runtime = (globalThis as any).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(invokeTask);
      else invokeTask.catch((e) => console.error("[document-jobs-worker] invoke task failed:", (e as Error).message));

      started.push((job as any).id);
    }

    return json({ ok: true, stuck_reset: stuckReset, jobs_started: started.length });
  } catch (e) {
    console.error("[document-jobs-worker] top", e);
    return json({ error: (e as Error).message || "internal error" }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
async function invokeUniversal(admin: any, job: any, formatId: string): Promise<void> {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const nextAttempts = Number(job.attempts || 0) + 1;
  if (!baseUrl || !serviceKey) {
    await markInvokeFailure(admin, job, nextAttempts, "Missing backend runtime credentials");
    return;
  }

  try {
    const r = await fetch(`${baseUrl}/functions/v1/generate-doc-universal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "x-queue-user-id": job.user_id,
      },
      body: JSON.stringify({ ecosystem_format_id: formatId, job_id: job.id }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      await markInvokeFailure(admin, job, nextAttempts, `HTTP ${r.status}: ${text.slice(0, 300)}`);
      return;
    }
    await admin
      .from("document_generation_jobs")
      .update({ last_error: null, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "processing");
  } catch (e) {
    console.error("[document-jobs-worker] invoke failed:", (e as Error).message);
    await markInvokeFailure(admin, job, nextAttempts, (e as Error).message?.slice(0, 300) || "invoke_failed");
  }
}

// deno-lint-ignore no-explicit-any
async function markInvokeFailure(admin: any, job: any, nextAttempts: number, message: string): Promise<void> {
  const finalFail = nextAttempts >= MAX_ATTEMPTS;
  await admin
    .from("document_generation_jobs")
    .update({
      status: finalFail ? "failed" : "queued",
      last_error: message,
      claimed_at: finalFail ? job.claimed_at : null,
      completed_at: finalFail ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  await admin
    .from("ecosystem_formats")
    .update({
      status: finalFail ? "failed" : "queued",
      progress: 0,
      error_reason: finalFail ? message.slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.ecosystem_format_id);
}

// Cron cannot reliably read managed service-role env vars from Vault in this
// project, so it uses a DB-stored internal token with service-role-only access.
// Direct function-to-function calls with service role are still accepted.
// deno-lint-ignore no-explicit-any
async function requireWorkerAuth(req: Request, admin: any): Promise<Response | null> {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && authHeader === `Bearer ${serviceKey}`) return null;

  try {
    const { data } = await admin
      .from("internal_cron_secrets")
      .select("secret_value")
      .eq("name", "document_jobs_worker")
      .maybeSingle();
    const secret = String(data?.secret_value || "");
    if (secret && authHeader === `Bearer ${secret}`) return null;
  } catch (e) {
    console.warn("[document-jobs-worker] cron secret lookup failed:", (e as Error).message);
  }

  return json({ error: "Unauthorized: worker token required" }, 401);
}