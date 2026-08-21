// ============================================================================
// P16 - BLOG AUTOPUBLISH (CRON mode).
//
// Service-role only. Walks projects with
//   projects.blog_engine_settings = { mode: "cron", enabled: true, per_run: N }
// and, for each of them, runs the blog engine:
//
//   generate (N articles) -> SEO Engine (inside blog-engine) -> quality gate
//   -> publish (FAIL articles are never published)
//
// MANUAL mode projects are untouched: the user presses the buttons in the UI.
// ============================================================================

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireServiceRole, adminClient } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function blogEngine(payload: Record<string, unknown>, userId: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/blog-engine`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "x-queue-user-id": userId,
    },
    body: JSON.stringify(payload),
  });
  return await res.json().catch(() => ({ ok: false }));
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const guard = requireServiceRole(req);
  if (guard) return guard;

  try {
    const body = await req.json().catch(() => ({}));
    const onlyProject = String(body?.project_id || "");

    const admin = adminClient();
    let q = admin.from("projects")
      .select("id, user_id, blog_engine_settings")
      .eq("blog_engine_settings->>mode", "cron")
      .eq("blog_engine_settings->>enabled", "true");
    if (onlyProject) q = q.eq("id", onlyProject);
    const { data: projects, error } = await q.limit(20);
    if (error) return errorResponse(error.message, 500);

    const runs: unknown[] = [];
    for (const p of (projects || []) as any[]) {
      const perRun = Math.min(5, Math.max(1, Number(p.blog_engine_settings?.per_run) || 1));
      const gen = await blogEngine(
        { project_id: p.id, action: "generate", mode: "priority", limit: perRun },
        p.user_id,
      );
      const pub = await blogEngine({ project_id: p.id, action: "publish" }, p.user_id);
      runs.push({ project_id: p.id, generate: gen, publish: pub });
    }

    return jsonResponse({ ok: true, projects: (projects || []).length, runs });
  } catch (e) {
    console.error("blog-autopublish error:", e);
    return errorResponse(e instanceof Error ? e.message : "autopublish failed", 500);
  }
});
