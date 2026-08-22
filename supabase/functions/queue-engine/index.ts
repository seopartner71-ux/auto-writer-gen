// ============================================================================
// P20.1 - QUEUE ENGINE (one click, background batches)
//
//   UI -> queue-engine (start) -> generation_jobs row -> background loop
//                                    |
//         content / seo / media / blog engines called batch by batch
//
// The engines themselves are NOT modified: the queue just calls them with a
// batch limit until nothing is pending, keeping progress in generation_jobs.
//
// Body:
//   { action: "start",  project_id, job_type, params?, batch_size? }
//   { action: "status", project_id, job_type? }
//   { action: "pause" | "resume" | "cancel", job_id }
//   { action: "tick",   job_id }                      (internal continuation)
// ============================================================================

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** Stop the loop before the edge runtime kills us and continue with a tick. */
const SLICE_MS = 90_000;
/** Hard guard against endless loops. */
const MAX_BATCHES = 400;

type JobType = "content" | "seo" | "media" | "blog";
type Row = Record<string, any>;

const DEFAULT_BATCH: Record<JobType, number> = { content: 20, seo: 20, media: 8, blog: 3 };

// ------------------------------------------------------------- internals ---
async function callFn(fn: string, payload: unknown, userId: string): Promise<Row> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "x-queue-user-id": userId,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(json?.error || `HTTP ${res.status}`) };
    return json as Row;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

// ------------------------------------------------------------- adapters ----
interface BatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  /** items still waiting, -1 when the engine cannot tell */
  remaining: number;
  note: string;
  error?: string;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

async function countTotal(admin: any, job: Row): Promise<number> {
  const projectId = job.project_id as string;
  const mode = String(job.params?.mode || "");
  try {
    if (job.job_type === "content") {
      const wanted =
        mode === "failed" ? ["failed"] :
        mode === "thin" ? ["thin", "failed"] :
        mode === "all" ? null : ["pending", "failed"];
      let total = 0;
      for (const table of ["site_products", "site_clusters", "site_silos"]) {
        const { data } = await admin.from(table).select("content_status")
          .eq("project_id", projectId).neq("status", "archived").limit(5000);
        for (const r of data || []) {
          const st = String(r.content_status || "pending");
          if (!wanted || wanted.includes(st)) total++;
        }
      }
      return total;
    }
    if (job.job_type === "seo") {
      const { data: reg } = await admin.from("page_registry").select("id, status")
        .eq("project_id", projectId).in("status", ["approved", "review"]).limit(5000);
      const ids = (reg || []).map((r: Row) => r.id);
      if (mode === "all" || !ids.length) return ids.length;
      const { data: seo } = await admin.from("page_seo").select("registry_id, seo_status")
        .eq("project_id", projectId).limit(5000);
      const done = new Set(
        (seo || [])
          .filter((r: Row) => (mode === "only_fail" ? String(r.seo_status) !== "FAIL" : true))
          .map((r: Row) => r.registry_id),
      );
      return ids.filter((id: string) => !done.has(id)).length;
    }
    if (job.job_type === "blog") {
      const { data } = await admin.from("content_plan").select("id, status")
        .eq("project_id", projectId).limit(2000);
      const rows = data || [];
      if (mode === "priority" || mode === "all") return rows.filter((r: Row) => String(r.status) !== "published").length;
      return rows.filter((r: Row) => ["planned", "failed"].includes(String(r.status))).length;
    }
  } catch { /* fall through */ }
  return 0;
}

async function runBatch(job: Row, batchSize: number): Promise<BatchResult> {
  const projectId = job.project_id as string;
  const userId = job.user_id as string;
  const p = (job.params || {}) as Row;
  const mode = String(p.mode || "");

  if (job.job_type === "content") {
    const d = await callFn("generate-commerce-content", {
      project_id: projectId,
      limit: batchSize,
      use_registry: p.use_registry !== false,
      only_missing: mode === "missing" || !mode,
      only_failed: mode === "failed",
      include_thin: mode === "thin" || mode === "all",
      force: mode === "all",
    }, userId);
    if (d.ok === false) return { processed: 0, succeeded: 0, failed: 0, remaining: -1, note: "", error: String(d.error) };
    const ok = num(d.generated) + num(d.expanded);
    const bad = num(d.failed);
    return {
      processed: ok + bad + num(d.thin),
      succeeded: ok, failed: bad,
      remaining: num(d.pending),
      note: `+${ok} ready, ${num(d.thin)} thin, ${bad} fail`,
    };
  }

  if (job.job_type === "seo") {
    const d = await callFn("seo-engine", {
      project_id: projectId,
      mode: mode || "missing",
      registry_ids: Array.isArray(p.registry_ids) ? p.registry_ids : undefined,
      limit: batchSize,
    }, userId);
    if (d.ok === false) return { processed: 0, succeeded: 0, failed: 0, remaining: -1, note: "", error: String(d.error) };
    const s = (d.summary || {}) as Row;
    return {
      processed: num(s.processed),
      succeeded: num(s.generated), failed: num(s.failed),
      remaining: -1,
      note: `PASS ${num(s.pass)} / REVIEW ${num(s.review)} / FAIL ${num(s.fail)}`,
    };
  }

  if (job.job_type === "media") {
    const d = await callFn("media-engine", {
      project_id: projectId,
      mode: mode === "regenerate" ? "regenerate" : mode === "import" ? "import_only" : "generate_missing",
      entity_ids: Array.isArray(p.entity_ids) ? p.entity_ids : undefined,
      scope: Array.isArray(p.scope) ? p.scope : undefined,
      limit: batchSize,
    }, userId);
    if (d.ok === false) return { processed: 0, succeeded: 0, failed: 0, remaining: -1, note: "", error: String(d.error) };
    const ok = num(d.generated) + num(d.imported);
    return {
      processed: num(d.processed) || ok + num(d.failed),
      succeeded: ok, failed: num(d.failed),
      remaining: num(d.remaining),
      note: `+${ok} img, ${num(d.placeholders)} placeholder, ${num(d.failed)} fail`,
    };
  }

  // blog
  const d = await callFn("blog-engine", {
    project_id: projectId,
    action: "generate",
    mode: mode || "new",
    plan_ids: Array.isArray(p.plan_ids) ? p.plan_ids : undefined,
    limit: batchSize,
  }, userId);
  if (d.ok === false) return { processed: 0, succeeded: 0, failed: 0, remaining: -1, note: "", error: String(d.error) };
  const ok = num(d.generated);
  return {
    processed: ok + num(d.failed) + num(d.skipped),
    succeeded: ok, failed: num(d.failed),
    remaining: -1,
    note: `+${ok} articles, ${num(d.failed)} fail`,
  };
}

// ----------------------------------------------------------------- loop ----
async function processJob(admin: any, jobId: string): Promise<void> {
  const started = Date.now();
  const durations: number[] = [];

  const load = async (): Promise<Row | null> => {
    const { data } = await admin.from("generation_jobs").select("*").eq("id", jobId).maybeSingle();
    return data || null;
  };

  let job = await load();
  if (!job) return;
  if (!["queued", "running"].includes(String(job.status))) return;

  const batchSize = Math.max(1, num(job.params?.batch_size) || DEFAULT_BATCH[job.job_type as JobType] || 10);

  let total = num(job.total);
  if (!total) {
    total = await countTotal(admin, job);
    await admin.from("generation_jobs").update({
      total,
      total_batches: total ? Math.ceil(total / batchSize) : 0,
    }).eq("id", jobId);
  }

  await admin.from("generation_jobs").update({
    status: "running",
    started_at: job.started_at || new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
  }).eq("id", jobId);

  let processed = num(job.processed);
  let succeeded = num(job.succeeded);
  let failed = num(job.failed);
  let batchNo = num(job.current_batch);
  const log: string[] = Array.isArray(job.log) ? job.log.slice(-40) : [];

  while (batchNo < MAX_BATCHES) {
    // control check: pause / cancel from the UI
    const fresh = await load();
    if (!fresh) return;
    if (fresh.status === "paused" || fresh.status === "cancelled") return;

    const t0 = Date.now();
    const res = await runBatch(fresh, batchSize);
    const spent = (Date.now() - t0) / 1000;
    durations.push(spent);
    batchNo++;

    if (res.error) {
      log.push(`batch ${batchNo}: error - ${res.error}`);
      await admin.from("generation_jobs").update({
        status: "failed", error_message: res.error, log: log.slice(-40),
        current_batch: batchNo, finished_at: new Date().toISOString(),
      }).eq("id", jobId);
      return;
    }

    processed += res.processed;
    succeeded += res.succeeded;
    failed += res.failed;
    if (res.remaining >= 0) total = Math.max(total, processed + res.remaining);
    else total = Math.max(total, processed);
    log.push(`batch ${batchNo}: ${res.note}`);

    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const left = Math.max(0, total - processed);
    const eta = Math.round((left / batchSize) * avg);

    await admin.from("generation_jobs").update({
      processed, succeeded, failed,
      total,
      current_batch: batchNo,
      total_batches: total ? Math.max(batchNo, Math.ceil(total / batchSize)) : batchNo,
      progress: total ? Math.min(99, Math.round((processed / total) * 100)) : 0,
      eta_seconds: eta,
      avg_batch_seconds: Math.round(avg * 10) / 10,
      heartbeat_at: new Date().toISOString(),
      log: log.slice(-40),
    }).eq("id", jobId);

    const done = res.remaining === 0 || (res.remaining < 0 && res.processed === 0) || left === 0;
    if (done) {
      await admin.from("generation_jobs").update({
        status: "completed", progress: 100, eta_seconds: 0,
        finished_at: new Date().toISOString(), log: log.slice(-40),
      }).eq("id", jobId);
      return;
    }

    // hand over to a fresh invocation before the runtime deadline
    if (Date.now() - started > SLICE_MS) {
      void callFn("queue-engine", { action: "tick", job_id: jobId }, String(fresh.user_id));
      return;
    }
  }

  await admin.from("generation_jobs").update({
    status: "completed", progress: 100, eta_seconds: 0,
    finished_at: new Date().toISOString(),
    log: [...log, "batch guard reached"].slice(-40),
  }).eq("id", jobId);
}

function background(fn: () => Promise<void>) {
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(fn());
  else void fn();
}

// ------------------------------------------------------------------ http ---
Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const auth = await verifyAuth(req);
  if (auth instanceof Response) return auth;

  let body: Row = {};
  try { body = await req.json(); } catch { /* empty */ }

  const action = String(body.action || "status");
  const admin = adminClient();

  try {
    if (action === "tick") {
      const jobId = String(body.job_id || "");
      if (!jobId) return errorResponse("job_id required", 400);
      background(() => processJob(admin, jobId));
      return jsonResponse({ ok: true, ticked: jobId });
    }

    if (action === "start") {
      const projectId = String(body.project_id || "");
      const jobType = String(body.job_type || "") as JobType;
      if (!projectId) return errorResponse("project_id required", 400);
      if (!["content", "seo", "media", "blog"].includes(jobType)) return errorResponse("bad job_type", 400);

      const { data: active } = await admin.from("generation_jobs").select("*")
        .eq("project_id", projectId).eq("job_type", jobType)
        .in("status", ["queued", "running", "paused"]).maybeSingle();
      if (active) return jsonResponse({ ok: true, job: active, already_running: true });

      const params = { ...(body.params || {}), batch_size: num(body.batch_size) || undefined };
      const { data: job, error } = await admin.from("generation_jobs").insert({
        project_id: projectId,
        user_id: auth.userId,
        job_type: jobType,
        status: "queued",
        params,
      }).select("*").single();
      if (error) return errorResponse(error.message, 500);

      background(() => processJob(admin, job.id));
      return jsonResponse({ ok: true, job });
    }

    if (action === "pause" || action === "cancel") {
      const jobId = String(body.job_id || "");
      if (!jobId) return errorResponse("job_id required", 400);
      const patch: Row = action === "pause"
        ? { status: "paused" }
        : { status: "cancelled", finished_at: new Date().toISOString(), eta_seconds: 0 };
      const { data } = await admin.from("generation_jobs").update(patch)
        .eq("id", jobId).eq("user_id", auth.userId).select("*").maybeSingle();
      return jsonResponse({ ok: true, job: data });
    }

    if (action === "resume") {
      const jobId = String(body.job_id || "");
      if (!jobId) return errorResponse("job_id required", 400);
      const { data } = await admin.from("generation_jobs").update({ status: "running" })
        .eq("id", jobId).eq("user_id", auth.userId).select("*").maybeSingle();
      if (data) background(() => processJob(admin, jobId));
      return jsonResponse({ ok: true, job: data });
    }

    // status
    const projectId = String(body.project_id || "");
    if (!projectId) return errorResponse("project_id required", 400);
    let q = admin.from("generation_jobs").select("*").eq("project_id", projectId)
      .order("created_at", { ascending: false }).limit(20);
    if (body.job_type) q = q.eq("job_type", String(body.job_type));
    const { data } = await q;
    return jsonResponse({ ok: true, jobs: data || [] });
  } catch (e) {
    console.error("[queue-engine]", e);
    return errorResponse((e as Error)?.message || "unexpected error", 500);
  }
});
