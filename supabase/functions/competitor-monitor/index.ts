// Competitor Monitoring worker.
//
// Two entry modes:
//  1) Cron tick (service-role or shared cron secret, body {} or {mode:"tick"}):
//     enqueue due pages -> claim jobs -> process them with rate limiting.
//  2) User call (JWT, body {mode:"check", page_id}): queue + process one page
//     immediately, after verifying ownership.
//
// Pipeline per page: FETCH -> EXTRACT -> NORMALIZE -> SNAPSHOT -> HASH COMPARE
// -> (only if changed) STRUCTURED DIFF -> SEVERITY -> AI ANALYSIS -> NOTIFY.
// AI is never called when the hashes match.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { fetchPage, buildSnapshot, validateUrl, type NormalizedSnapshot } from "../_shared/competitorSnapshot.ts";
import { computeDiff, hashesEqual, type MonitorConfig } from "../_shared/competitorDiff.ts";
import { chatJson } from "../_shared/aiClient.ts";

const MAX_JOBS_PER_TICK = 6;
const MAX_ATTEMPTS = 3;
const PER_DOMAIN_DELAY_MS = 3000;
const MAX_FAILURES_BEFORE_PAUSE = 5;
const AI_MODEL = "google/gemini-2.5-flash";

const FREQUENCY_HOURS: Record<string, number> = {
  daily: 24,
  twice_week: 84,
  weekly: 168,
};

function nextCheckAt(frequency: string): string | null {
  const h = FREQUENCY_HOURS[frequency];
  if (!h) return null; // manual
  return new Date(Date.now() + h * 3600_000).toISOString();
}

function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function isCronCaller(req: Request, db: SupabaseClient): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (service && auth === `Bearer ${service}`) return true;
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  // Service-role JWT issued by the platform (role claim in the payload).
  try {
    const part = token.split(".")[1];
    if (part) {
      const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
      if (json?.role === "service_role") return true;
    }
  } catch { /* not a JWT, fall through */ }
  const { data } = await db
    .from("internal_cron_secrets")
    .select("secret_value")
    .eq("name", "competitor_monitor")
    .maybeSingle();
  return Boolean(data?.secret_value && data.secret_value === token);
}

async function resolveOpenRouterKey(db: SupabaseClient): Promise<string | null> {
  try {
    const { data } = await db
      .from("api_keys")
      .select("api_key")
      .eq("provider", "openrouter")
      .eq("is_valid", true)
      .limit(1)
      .maybeSingle();
    if (data?.api_key) return data.api_key as string;
  } catch { /* fall through to env */ }
  return Deno.env.get("OPENROUTER_API_KEY") || null;
}

const AI_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    what_changed: { type: "string" },
    probable_goal: { type: "string" },
    what_it_may_mean: { type: "string" },
    what_to_check: { type: "array", items: { type: "string" } },
  },
  required: ["what_changed", "probable_goal", "what_it_may_mean", "what_to_check"],
} as const;

async function analyzeWithAi(
  db: SupabaseClient,
  summary: Record<string, unknown>,
  meta: { url: string; title: string; severity: string; userId: string },
): Promise<Record<string, unknown> | null> {
  const apiKey = await resolveOpenRouterKey(db);
  if (!apiKey) return null;
  try {
    const res = await chatJson<Record<string, unknown>>({
      apiKey,
      model: AI_MODEL,
      appTitle: "SEO-Modul competitor monitor",
      functionName: "competitor-monitor",
      userId: meta.userId,
      timeoutMs: 45_000,
      maxTokens: 900,
      temperature: 0.4,
      schema: AI_SCHEMA as unknown as Record<string, unknown>,
      schemaName: "competitor_change_analysis",
      system:
        "Ты SEO-аналитик. На вход подается ТОЛЬКО структурированный список изменений страницы конкурента, " +
        "без самой страницы. Отвечай по-русски, кратко, по делу, без markdown и без символа '*'. " +
        "Не используй букву 'е' с двумя точками. Не используй длинное тире, только короткий дефис. " +
        "ЗАПРЕЩЕНО утверждать, что изменение повлияло на позиции или трафик - таких данных нет. " +
        "Используй формулировки 'возможно', 'вероятно', 'может свидетельствовать'.",
      user:
        `Страница: ${meta.url}\nTitle: ${meta.title}\nЗначимость: ${meta.severity}\n\n` +
        `Изменения (JSON):\n${JSON.stringify(summary)}\n\n` +
        `Верни JSON: what_changed (что изменил конкурент), probable_goal (вероятная цель), ` +
        `what_it_may_mean (что это может означать), what_to_check (массив из 3-6 пунктов, что стоит проверить у нас).`,
    });
    return res.data;
  } catch (e) {
    console.warn("[competitor-monitor] AI analysis failed:", (e as Error)?.message);
    return null;
  }
}

interface PageRow {
  id: string; user_id: string; monitor_id: string; url: string; label: string | null;
  frequency: string; monitor_config: MonitorConfig | null; is_enabled: boolean;
  consecutive_failures: number;
}

async function processPage(db: SupabaseClient, page: PageRow): Promise<{ status: string; detail?: string }> {
  const fetched = await fetchPage(page.url);
  if (!fetched.ok) {
    const failures = (page.consecutive_failures || 0) + 1;
    await db.from("competitor_pages").update({
      status: "error",
      last_error: `${fetched.kind}: ${fetched.message}`,
      last_checked_at: new Date().toISOString(),
      consecutive_failures: failures,
      is_enabled: failures >= MAX_FAILURES_BEFORE_PAUSE ? false : page.is_enabled,
      next_check_at: nextCheckAt(page.frequency) ?? new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    }).eq("id", page.id);
    return { status: "fetch_failed", detail: fetched.kind };
  }

  let snap: NormalizedSnapshot;
  try {
    snap = await buildSnapshot(fetched.html, fetched.finalUrl, fetched.status);
  } catch (e) {
    await db.from("competitor_pages").update({
      status: "error",
      last_error: `parse: ${(e as Error).message}`.slice(0, 400),
      last_checked_at: new Date().toISOString(),
      consecutive_failures: (page.consecutive_failures || 0) + 1,
    }).eq("id", page.id);
    return { status: "parse_failed" };
  }

  const { data: prevSnap } = await db
    .from("competitor_snapshots")
    .select("id,title,description,h1,headings,word_count,content,images,internal_links,external_links,faq,tables,lists,cta,prices,schema_types,canonical,robots,content_hash,structure_hash,meta_hash,links_hash")
    .eq("page_id", page.id)
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const isBaseline = !prevSnap;
  const cfg = page.monitor_config || {};

  // Nothing meaningful changed -> store nothing new, no AI, no change row.
  if (prevSnap && hashesEqual(prevSnap as Record<string, unknown>, snap as unknown as Record<string, unknown>, cfg)) {
    await db.from("competitor_pages").update({
      status: "ok",
      last_error: null,
      last_checked_at: new Date().toISOString(),
      consecutive_failures: 0,
      next_check_at: nextCheckAt(page.frequency) ?? new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
    }).eq("id", page.id);
    return { status: "no_changes" };
  }

  const { data: inserted, error: insErr } = await db.from("competitor_snapshots").insert({
    page_id: page.id,
    user_id: page.user_id,
    is_baseline: isBaseline,
    http_status: snap.http_status,
    title: snap.title,
    description: snap.description,
    h1: snap.h1,
    headings: snap.headings,
    word_count: snap.word_count,
    content: snap.content,
    images: snap.images,
    internal_links: snap.internal_links,
    external_links: snap.external_links,
    faq: snap.faq,
    tables: snap.tables,
    lists: snap.lists,
    cta: snap.cta,
    prices: snap.prices,
    schema_types: snap.schema_types,
    canonical: snap.canonical,
    robots: snap.robots,
    content_hash: snap.content_hash,
    structure_hash: snap.structure_hash,
    meta_hash: snap.meta_hash,
    links_hash: snap.links_hash,
    raw_html: snap.raw_html,
  }).select("id").single();
  if (insErr) throw insErr;

  await db.from("competitor_pages").update({
    status: "ok",
    last_error: null,
    last_checked_at: new Date().toISOString(),
    consecutive_failures: 0,
    next_check_at: nextCheckAt(page.frequency) ?? new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
  }).eq("id", page.id);

  // Baseline: first snapshot is not a "change".
  if (isBaseline) return { status: "baseline" };

  const result = computeDiff(prevSnap as Record<string, unknown>, snap as unknown as Record<string, unknown>, cfg);
  if (!result.hasChanges) return { status: "no_changes" };

  let ai: Record<string, unknown> | null = null;
  if (result.severity === "high" || result.severity === "critical" || result.score >= 25) {
    ai = await analyzeWithAi(db, result.summary, {
      url: page.url, title: snap.title, severity: result.severity, userId: page.user_id,
    });
  }

  const { data: change } = await db.from("competitor_changes").insert({
    page_id: page.id,
    monitor_id: page.monitor_id,
    user_id: page.user_id,
    snapshot_id: inserted.id,
    prev_snapshot_id: (prevSnap as any).id,
    severity: result.severity,
    score: result.score,
    summary: result.summary,
    diff: result.diff,
    ai_analysis: ai,
  }).select("id").single();

  if (result.severity === "high" || result.severity === "critical") {
    const parts: string[] = [];
    const s = result.summary as Record<string, any>;
    if (s.words_delta) parts.push(`${s.words_delta > 0 ? "+" : ""}${s.words_delta} слов`);
    if (s.h2_added) parts.push(`+${s.h2_added} H2`);
    if (s.faq_added) parts.push(`+${s.faq_added} FAQ`);
    if (s.internal_links_added) parts.push(`+${s.internal_links_added} внутренних ссылок`);
    if (s.title_changed) parts.push("изменен Title");
    await db.from("notifications").insert({
      user_id: page.user_id,
      title: "Изменения у конкурента",
      message: `${new URL(page.url).hostname}${new URL(page.url).pathname} - ${parts.join(", ") || "существенное обновление страницы"}`,
    });
  }

  return { status: "change_detected", detail: change?.id };
}

async function enqueueDue(db: SupabaseClient): Promise<number> {
  const { data: due } = await db
    .from("competitor_pages")
    .select("id,user_id,frequency,is_enabled,next_check_at")
    .eq("is_enabled", true)
    .neq("frequency", "manual")
    .lte("next_check_at", new Date().toISOString())
    .limit(50);
  let n = 0;
  for (const p of due || []) {
    const { error } = await db.from("competitor_check_jobs").insert({
      page_id: p.id, user_id: p.user_id, trigger_source: "cron",
    });
    if (!error) n++;
  }
  return n;
}

async function claimJobs(db: SupabaseClient, limit: number, pageId?: string) {
  const q = db.from("competitor_check_jobs")
    .select("id,page_id,user_id,attempts")
    .eq("status", "queued")
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (pageId) q.eq("page_id", pageId);
  const { data } = await q;
  const claimed: Array<{ id: string; page_id: string; user_id: string; attempts: number }> = [];
  for (const job of data || []) {
    const { data: upd } = await db.from("competitor_check_jobs")
      .update({ status: "running", claimed_at: new Date().toISOString(), attempts: (job.attempts || 0) + 1 })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (upd) claimed.push(job as any);
  }
  return claimed;
}

async function runJobs(db: SupabaseClient, jobs: Array<{ id: string; page_id: string; attempts: number }>) {
  const results: Array<Record<string, unknown>> = [];
  const seenDomains = new Set<string>();
  for (const job of jobs) {
    const { data: page } = await db
      .from("competitor_pages")
      .select("id,user_id,monitor_id,url,label,frequency,monitor_config,is_enabled,consecutive_failures")
      .eq("id", job.page_id)
      .maybeSingle();
    if (!page) {
      await db.from("competitor_check_jobs").update({ status: "failed", last_error: "page not found", finished_at: new Date().toISOString() }).eq("id", job.id);
      continue;
    }
    // Rate limiting: never hit the same host twice back to back.
    try {
      const host = new URL(page.url).hostname;
      if (seenDomains.has(host)) await new Promise(r => setTimeout(r, PER_DOMAIN_DELAY_MS));
      seenDomains.add(host);
    } catch { /* ignore */ }

    try {
      const r = await processPage(db, page as PageRow);
      await db.from("competitor_check_jobs").update({
        status: "done", finished_at: new Date().toISOString(), last_error: null,
      }).eq("id", job.id);
      results.push({ page_id: page.id, ...r });
    } catch (e) {
      const msg = (e as Error)?.message?.slice(0, 400) || "unknown error";
      const giveUp = (job.attempts || 1) >= MAX_ATTEMPTS;
      await db.from("competitor_check_jobs").update({
        status: giveUp ? "failed" : "queued",
        last_error: msg,
        finished_at: giveUp ? new Date().toISOString() : null,
        scheduled_at: giveUp ? undefined : new Date(Date.now() + 5 * 60_000).toISOString(),
      }).eq("id", job.id);
      results.push({ page_id: page.id, status: "error", detail: msg });
    }
  }
  return results;
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const db = admin();
  try {
    const body = await req.json().catch(() => ({}));
    const mode = String((body as any)?.mode || "tick");

    if (mode === "check") {
      const auth = await verifyAuth(req);
      if (auth instanceof Response) return auth;
      const pageId = String((body as any)?.page_id || "");
      if (!pageId) return errorResponse("page_id is required", 400);
      const { data: page } = await db
        .from("competitor_pages")
        .select("id,user_id,url")
        .eq("id", pageId)
        .maybeSingle();
      if (!page || page.user_id !== auth.userId) return errorResponse("Not found", 404);
      const v = validateUrl(page.url);
      if (!v.ok) return errorResponse(v.reason, 400);

      await db.from("competitor_check_jobs").insert({ page_id: pageId, user_id: auth.userId, trigger_source: "manual" });
      const jobs = await claimJobs(db, 1, pageId);
      const results = await runJobs(db, jobs as any);
      return jsonResponse({ ok: true, results });
    }

    // Cron tick.
    if (!(await isCronCaller(req, db))) return errorResponse("Unauthorized", 401);

    // Safety net: release jobs stuck in running for >10 minutes.
    await db.from("competitor_check_jobs")
      .update({ status: "queued", claimed_at: null })
      .eq("status", "running")
      .lt("claimed_at", new Date(Date.now() - 10 * 60_000).toISOString());

    const enqueued = await enqueueDue(db);
    const jobs = await claimJobs(db, MAX_JOBS_PER_TICK);
    const results = await runJobs(db, jobs as any);
    return jsonResponse({ ok: true, enqueued, processed: results.length, results });
  } catch (e) {
    console.error("[competitor-monitor] fatal:", (e as Error)?.message);
    return new Response(JSON.stringify({ error: (e as Error)?.message || "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
