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

const MAX_JOBS_PER_TICK = 3;
const MAX_ATTEMPTS = 3;

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

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
    for (const job of jobs || []) {
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

      // Fire generate-doc-universal (fire-and-forget). It responds 202 fast
      // and runs the pipeline in EdgeRuntime.waitUntil with a 130s cap.
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-doc-universal`;
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          "x-user-id": (job as any).user_id,
        },
        body: JSON.stringify({ ecosystem_format_id: (job as any).ecosystem_format_id }),
      })
        .then(async (r) => {
          const ok = r.ok;
          const text = await r.text().catch(() => "");
          await admin
            .from("document_generation_jobs")
            .update({
              status: ok ? "completed" : ((job as any).attempts + 1 >= MAX_ATTEMPTS ? "failed" : "queued"),
              last_error: ok ? null : `HTTP ${r.status}: ${text.slice(0, 300)}`,
              completed_at: ok ? new Date().toISOString() : null,
            })
            .eq("id", (job as any).id);
        })
        .catch(async (e) => {
          console.error("[document-jobs-worker] invoke failed:", (e as Error).message);
          await admin
            .from("document_generation_jobs")
            .update({
              status: (job as any).attempts + 1 >= MAX_ATTEMPTS ? "failed" : "queued",
              last_error: (e as Error).message?.slice(0, 300) || "invoke_failed",
            })
            .eq("id", (job as any).id);
        });

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