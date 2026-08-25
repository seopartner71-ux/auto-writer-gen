// P19 - Deployment Engine: production release layer on top of the existing
// build/QA/visual stack. It never renders HTML itself and never mutates the
// registry: it only orchestrates readiness -> build -> deploy -> indexing and
// records every release in public.deployments.
//
// Actions:
//   readiness  - checklist (registry, content, seo, visual, qa) + gate verdict
//   build      - build-only pass via site-qa-check, records a `ready` release
//   deploy     - gate + provider deploy (cloudflare | vercel | github_pages)
//   history    - last releases for the project

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { recordRelease } from "../_shared/siteRelease.ts";

const DEPLOY_FN: Record<string, string> = {
  cloudflare: "deploy-cloudflare-direct",
  vercel: "deploy-vercel-direct",
  github_pages: "deploy-github-pages",
};

const MIN_VISUAL_SCORE = 90;

interface Check {
  key: string;
  ok: boolean;
  value: string;
  reason_ru?: string;
  reason_en?: string;
}

interface Readiness {
  checks: Check[];
  can_deploy: boolean;
  blockers_ru: string[];
  blockers_en: string[];
  visual_score: number;
  qa_critical: number;
  pages: number;
}

async function computeReadiness(sb: ReturnType<typeof adminClient>, projectId: string): Promise<Readiness> {
  const [{ data: registry }, { data: seoRows }, { data: visualRows }, { data: designProfile }, { data: project }] =
    await Promise.all([
      sb.from("page_registry")
        .select("id, url_path, decision, status, is_system, page_type")
        .eq("project_id", projectId).limit(10000),
      sb.from("page_seo").select("id, seo_status, title, meta_description").eq("project_id", projectId).limit(10000),
      sb.from("page_visual_config").select("visual_score, visual_status").eq("project_id", projectId).limit(10000),
      sb.from("design_profiles").select("id").eq("project_id", projectId).limit(1).maybeSingle(),
      sb.from("projects").select("last_qa_report").eq("id", projectId).maybeSingle(),
    ]);

  const active = (registry || []).filter((r: Record<string, unknown>) =>
    r.is_system === true || r.decision === "approved" || (r.decision !== "rejected" && r.status === "published"));
  const contentPages = active.filter((r: Record<string, unknown>) => r.is_system !== true);

  const seo = seoRows || [];
  const seoOk = seo.filter((s: Record<string, unknown>) => s.title && s.meta_description).length;

  // Visual: per-page configs win; with no configs the renderer falls back to the
  // design profile defaults, so a saved profile is enough to pass the gate.
  const visual = (visualRows || []) as { visual_score: number | null }[];
  const visualScore = visual.length
    ? Math.round(visual.reduce((s, v) => s + (v.visual_score || 0), 0) / visual.length)
    : 0;
  const visualOk = visual.length ? visualScore >= MIN_VISUAL_SCORE : !!designProfile;


  const qa = ((project as Record<string, unknown> | null)?.last_qa_report || null) as
    { critical?: number; score?: number } | null;
  const qaCritical = Number(qa?.critical ?? -1);

  const checks: Check[] = [
    {
      key: "registry",
      ok: active.length > 0,
      value: `${active.length}`,
      reason_ru: "Реестр страниц пуст - запустите Page Decision Engine",
      reason_en: "Page registry is empty - run the Page Decision Engine",
    },
    {
      key: "content",
      ok: contentPages.length > 0,
      value: `${contentPages.length}`,
      reason_ru: "Нет контентных страниц",
      reason_en: "No content pages",
    },
    {
      key: "seo",
      ok: seoOk > 0 && seoOk >= Math.ceil(active.length * 0.6),
      value: `${seoOk}/${active.length}`,
      reason_ru: "SEO Engine не заполнил title и description",
      reason_en: "SEO Engine has not filled title and description",
    },
    {
      key: "visual",
      ok: visualOk,
      value: visual.length ? `${visualScore}` : (designProfile ? "profile" : "-"),
      reason_ru: visual.length
        ? `Visual Score ниже ${MIN_VISUAL_SCORE} - доработайте дизайн`
        : "Нет профиля дизайна - настройте шаг «Дизайн»",
      reason_en: visual.length
        ? `Visual Score below ${MIN_VISUAL_SCORE} - refine the design`
        : "No design profile - configure the Design step",
    },
    {
      key: "qa",
      ok: qaCritical === 0,
      value: qaCritical < 0 ? "-" : `${qaCritical}`,
      reason_ru: qaCritical < 0
        ? "QA не выполнялся - запустите проверку"
        : `Критических ошибок QA: ${qaCritical}`,
      reason_en: qaCritical < 0 ? "QA has not run yet" : `QA critical issues: ${qaCritical}`,
    },
  ];

  const failed = checks.filter((c) => !c.ok);
  return {
    checks,
    can_deploy: failed.length === 0,
    blockers_ru: failed.map((c) => c.reason_ru || c.key),
    blockers_en: failed.map((c) => c.reason_en || c.key),
    visual_score: visualScore,
    qa_critical: qaCritical,
    pages: active.length,
  };
}

/** Launch Readiness Engine verdict (best effort, never blocks the release). */
async function launchReport(
  sb: ReturnType<typeof adminClient>,
  projectId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await sb.functions.invoke("launch-readiness-engine", {
      body: { project_id: projectId },
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
        "x-queue-user-id": userId,
      },
    });
    return (data as Record<string, unknown>) || null;
  } catch {
    return null;
  }
}

/** Reads the real upstream error body hidden behind supabase-js "non-2xx". */
async function upstreamError(err: unknown, fallback: string): Promise<string> {
  const ctx = (err as { context?: Response })?.context;
  if (ctx && typeof ctx.text === "function") {
    try {
      const raw = await ctx.text();
      try {
        const parsed = JSON.parse(raw);
        return String(parsed?.error || parsed?.message || raw).slice(0, 500);
      } catch {
        return raw.slice(0, 500) || fallback;
      }
    } catch { /* ignore */ }
  }
  return (err as { message?: string })?.message || fallback;
}

// ---------------------------------------------------------------- P21 -----
// Release Manager: every successful deploy is recorded as an immutable
// release (semver auto-increment per project) so the owner can browse the
// publication history and switch the current production url back.
async function buildHash(sb: ReturnType<typeof adminClient>, projectId: string): Promise<string> {
  const { data } = await sb.from("page_registry")
    .select("url_path, updated_at").eq("project_id", projectId).limit(5000);
  const seed = (data || []).map((r: Record<string, unknown>) => `${r.url_path}:${r.updated_at}`).sort().join("|");
  const bytes = new TextEncoder().encode(seed || projectId);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Single writer for site_releases (see _shared/siteRelease.ts). The deploy
 * function skips its own release row when we drive the deploy (skip_release),
 * so exactly one row per deploy is written here and projects.last_release_id
 * is kept in sync by the shared helper.
 */
async function createRelease(
  sb: ReturnType<typeof adminClient>,
  args: {
    projectId: string; userId: string; provider: string; url: string;
    pages: number; deploymentId: string | null; launchReport: unknown;
  },
): Promise<Record<string, unknown> | null> {
  return await recordRelease(sb as never, {
    projectId: args.projectId,
    userId: args.userId,
    provider: args.provider,
    url: args.url,
    pages: args.pages,
    deploymentId: args.deploymentId,
    buildHash: await buildHash(sb, args.projectId),
    launchReport: args.launchReport,
  });
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.project_id || "");
    const action = String(body?.action || "readiness");
    if (!projectId) return errorResponse("project_id required", 400);

    const sb = adminClient();
    const { data: project } = await sb.from("projects")
      .select("id, user_id, name, domain, custom_domain, hosting_platform, production_url, deployment_url, published_at, deployment_status")
      .eq("id", projectId).maybeSingle();
    if (!project) return errorResponse("Project not found", 404);
    const proj = project as Record<string, string | null>;
    if (proj.user_id !== auth.userId) return errorResponse("Forbidden", 403);

    if (action === "releases") {
      const { data } = await sb.from("site_releases").select("*")
        .eq("project_id", projectId).order("created_at", { ascending: false }).limit(50);
      return jsonResponse({ success: true, releases: data || [] });
    }

    if (action === "set_current") {
      const releaseId = String(body?.release_id || "");
      if (!releaseId) return errorResponse("release_id required", 400);
      const { data: rel } = await sb.from("site_releases").select("*")
        .eq("id", releaseId).eq("project_id", projectId).maybeSingle();
      if (!rel) return errorResponse("Release not found", 404);
      await sb.from("site_releases").update({ is_current: false })
        .eq("project_id", projectId).eq("is_current", true);
      const { data: updated } = await sb.from("site_releases")
        .update({ is_current: true, status: "published" }).eq("id", releaseId).select("*").maybeSingle();
      const relUrl = (rel as Record<string, string | null>).published_url;
      if (relUrl) {
        await sb.from("projects").update({ production_url: relUrl, deployment_url: relUrl }).eq("id", projectId);
      }
      return jsonResponse({ success: true, release: updated });
    }

    if (action === "archive_release") {
      const releaseId = String(body?.release_id || "");
      if (!releaseId) return errorResponse("release_id required", 400);
      const { data } = await sb.from("site_releases")
        .update({ status: "archived", is_current: false })
        .eq("id", releaseId).eq("project_id", projectId).select("*").maybeSingle();
      return jsonResponse({ success: true, release: data });
    }

    if (action === "history") {
      const { data } = await sb.from("deployments")
        .select("id, provider, domain, status, url, zip_url, pages_count, error, created_at, deployed_at")
        .eq("project_id", projectId).order("created_at", { ascending: false }).limit(20);
      return jsonResponse({ success: true, deployments: data || [] });
    }

    const readiness = await computeReadiness(sb, projectId);

    if (action === "readiness") {
      return jsonResponse({ success: true, readiness });
    }

    if (action === "build") {
      const { data: row } = await sb.from("deployments").insert({
        project_id: projectId, user_id: auth.userId, provider: "build",
        status: "building", readiness, domain: proj.custom_domain || proj.domain,
      }).select("id").single();
      const deploymentId = (row as { id: string } | null)?.id || null;
      try {
        const { data, error } = await sb.functions.invoke("site-qa-check", {
          body: { project_id: projectId },
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
            "x-queue-user-id": auth.userId,
          },
        });
        if (error) throw new Error(await upstreamError(error, "Build failed"));
        const res = data as { report?: { critical?: number; pages?: number; score?: number }; domain?: string };
        if (deploymentId) {
          await sb.from("deployments").update({
            status: "ready",
            qa_report: res?.report || null,
            pages_count: (res?.report as { pages?: number } | undefined)?.pages ?? readiness.pages,
            build_id: deploymentId,
            domain: res?.domain || proj.custom_domain || proj.domain,
          }).eq("id", deploymentId);
        }
        const after = await computeReadiness(sb, projectId);
        return jsonResponse({ success: true, deployment_id: deploymentId, report: res?.report || null, readiness: after });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Build failed";
        if (deploymentId) await sb.from("deployments").update({ status: "failed", error: msg }).eq("id", deploymentId);
        return errorResponse(msg, 502, { deployment_id: deploymentId });
      }
    }

    if (action === "deploy") {
      const provider = String(body?.provider || "cloudflare");
      const fn = DEPLOY_FN[provider];
      if (!fn) return errorResponse("Unknown provider", 400);
      const force = body?.force === true;

      if (!readiness.can_deploy && !force) {
        return jsonResponse({
          success: false,
          blocked: true,
          readiness,
        }, 200);
      }

      const { data: row } = await sb.from("deployments").insert({
        project_id: projectId, user_id: auth.userId, provider,
        status: "deploying", readiness, domain: proj.custom_domain || proj.domain,
      }).select("id").single();
      const deploymentId = (row as { id: string } | null)?.id || null;

      try {
        await sb.from("projects").update({ hosting_platform: provider }).eq("id", projectId);
        const { data, error } = await sb.functions.invoke(fn, {
          body: { project_id: projectId, skip_release: true, ...(force ? { force_deploy: true } : {}) },
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
            "x-queue-user-id": auth.userId,
          },
        });
        if (error) throw new Error(await upstreamError(error, "Deploy failed"));
        const res = (data || {}) as { url?: string; domain?: string; message?: string; error?: string; qa_report?: unknown };
        if (res.error) throw new Error(String(res.message || res.error));

        const url = res.url || (res.domain ? `https://${res.domain}` : "");
        if (deploymentId) {
          await sb.from("deployments").update({
            status: "success",
            url: url || null,
            domain: (res.domain || proj.custom_domain || proj.domain) ?? null,
            deployed_at: new Date().toISOString(),
            qa_report: (res.qa_report as Record<string, unknown>) || null,
          }).eq("id", deploymentId);
        }

        if (url) {
          await sb.from("projects").update({
            production_url: url,
            deployment_status: "success",
            published_at: new Date().toISOString(),
            deployment_url: url,
            last_deploy_at: new Date().toISOString(),
          }).eq("id", projectId);
        }

        let report: unknown = null;
        if (deploymentId) {
          report = await launchReport(sb, projectId, auth.userId);
          if (report) await sb.from("deployments").update({ launch_report: report }).eq("id", deploymentId);
        }

        // P21 Release Manager - record the release of this successful deploy.
        const release = await createRelease(sb, {
          projectId, userId: auth.userId, provider, url,
          pages: (report as { stats?: { pages?: number } } | null)?.stats?.pages ?? readiness.pages,
          deploymentId, launchReport: report,
        });


        // IndexNow / sitemap ping after a successful release (best effort).
        let indexing: unknown = null;
        if (url) {
          try {
            const { data: ping } = await sb.functions.invoke("notify-search-engines", {
              body: { project_id: projectId, reason: "deploy" },
              headers: {
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
                "x-queue-user-id": auth.userId,
              },
            });
            indexing = ping;
            const results = (ping as { results?: { provider: string; status: string; message?: string }[] })?.results || [];
            if (results.length) {
              await sb.from("indexing_logs").insert(results.map((r) => ({
                user_id: auth.userId,
                project_id: projectId,
                deployment_id: deploymentId,
                provider: r.provider,
                status: r.status === "success" ? "success" : "error",
                url,
                response_message: (r.message || "").slice(0, 500),
              })));
            }
          } catch { /* indexing must never fail the release */ }
        }

        return jsonResponse({ success: true, deployment_id: deploymentId, url, message: res.message || null, indexing, release });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Deploy failed";
        if (deploymentId) await sb.from("deployments").update({ status: "failed", error: msg }).eq("id", deploymentId);
        await sb.from("projects").update({ deployment_status: "failed" }).eq("id", projectId);
        return errorResponse(msg, 502, { deployment_id: deploymentId });
      }
    }

    if (action === "index") {
      const url = String(proj.production_url || proj.deployment_url || proj.domain || "");
      if (!url) return errorResponse("Site is not published yet", 400);
      const site = url.startsWith("http") ? url : `https://${url}`;
      const { data, error } = await sb.functions.invoke("notify-search-engines", {
        body: { project_id: projectId, reason: "manual" },
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
          "x-queue-user-id": auth.userId,
        },
      });
      if (error) return errorResponse(await upstreamError(error, "Indexing request failed"), 502);
      const results = (data as { results?: { provider: string; status: string; message?: string }[] })?.results || [];
      if (results.length) {
        await sb.from("indexing_logs").insert(results.map((r) => ({
          user_id: auth.userId,
          project_id: projectId,
          provider: r.provider,
          status: r.status === "success" ? "success" : "error",
          url: site,
          response_message: (r.message || "").slice(0, 500),
        })));
      }
      return jsonResponse({ success: true, url: site, results });
    }

    return errorResponse("Unknown action", 400);
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});
