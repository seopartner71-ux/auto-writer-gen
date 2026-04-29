import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VERCEL_API = "https://api.vercel.com";

function decodeJwtSub(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1];
    const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(part.length + ((4 - part.length % 4) % 4), "=");
    const json = JSON.parse(atob(padded));
    return json.sub || null;
  } catch {
    return null;
  }
}

async function vercelFetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${VERCEL_API}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").substring(0, 52) || "site";
}

// Pick the best Vercel project name: prefer GitHub repo slug (always valid latin),
// fallback to sanitized project.name, fallback to a hash-based unique slug.
function pickProjectName(project: { name: string; github_repo: string | null; id: string }): string {
  const repoSlug = project.github_repo ? String(project.github_repo).split("/")[1] : "";
  if (repoSlug && /[a-z0-9]/i.test(repoSlug)) return sanitizeName(repoSlug);
  const fromName = sanitizeName(project.name || "");
  if (fromName && fromName !== "site") return fromName;
  // Last resort: short id-based slug so we never collide with the global "site"
  return "site-" + project.id.replace(/-/g, "").substring(0, 8);
}

// Extract a real domain from the Vercel project response (alias array or fallback).
function extractVercelDomain(vercelProject: any, fallbackName: string): string {
  const aliases: string[] = [];
  if (Array.isArray(vercelProject?.alias)) {
    for (const a of vercelProject.alias) {
      if (typeof a === "string") aliases.push(a);
      else if (a?.domain) aliases.push(a.domain);
    }
  }
  if (Array.isArray(vercelProject?.targets?.production?.alias)) {
    aliases.push(...vercelProject.targets.production.alias);
  }
  // Prefer shortest .vercel.app alias (canonical), then any non-empty alias
  const vercelApp = aliases.filter((d) => d.endsWith(".vercel.app")).sort((a, b) => a.length - b.length);
  if (vercelApp.length > 0) return vercelApp[0];
  if (aliases.length > 0) return aliases[0];
  return `${fallbackName}.vercel.app`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const VERCEL_TOKEN = Deno.env.get("VERCEL_API_TOKEN");
    if (!VERCEL_TOKEN) {
      return new Response(JSON.stringify({ error: "VERCEL_API_TOKEN not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const userId = decodeJwtSub(jwt);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const { project_id, action } = body || {};
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify project ownership
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, name, user_id, github_repo, github_token, domain, custom_domain")
      .eq("id", project_id)
      .maybeSingle();

    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (project.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACTION: check - is the project already on Vercel?
    if (action === "check") {
      const projectName = pickProjectName(project);
      const r = await vercelFetch(VERCEL_TOKEN, `/v9/projects/${projectName}`);
      if (r.ok) {
        const realDomain = extractVercelDomain(r.data, projectName);
        // Persist the real domain if it differs from what we have stored
        if (realDomain && realDomain !== project.domain) {
          await supabase.from("projects").update({ domain: realDomain, hosting_platform: "vercel" }).eq("id", project_id);
        }
        return new Response(JSON.stringify({
          status: "linked",
          vercel_project: r.data?.name,
          domain: realDomain,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ status: "not_linked" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACTION: create - create Vercel project linked to GitHub
    if (action === "create") {
      if (!project.github_repo) {
        return new Response(JSON.stringify({ error: "GitHub repo not configured. Set up GitHub first." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const [owner, repo] = String(project.github_repo).split("/");
      if (!owner || !repo) {
        return new Response(JSON.stringify({ error: "Invalid github_repo format. Expected owner/repo." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const projectName = pickProjectName(project);

      // 1. Check if Vercel project with this name already exists
      const existing = await vercelFetch(VERCEL_TOKEN, `/v9/projects/${projectName}`);
      let vercelProject: any;

      if (existing.ok) {
        vercelProject = existing.data;
      } else {
        // 2. Create Vercel project linked to GitHub
        const createRes = await vercelFetch(VERCEL_TOKEN, "/v10/projects", {
          method: "POST",
          body: JSON.stringify({
            name: projectName,
            framework: "astro",
            gitRepository: {
              type: "github",
              repo: `${owner}/${repo}`,
            },
          }),
        });

        if (!createRes.ok) {
          const errMsg = createRes.data?.error?.message || createRes.data?.message || JSON.stringify(createRes.data);
          // Common case: GitHub App not installed
          if (/repo|github|not found|forbidden/i.test(errMsg)) {
            return new Response(JSON.stringify({
              error: "GitHub App not installed",
              hint: "Install Vercel GitHub App at https://vercel.com/new/git/import?s=https://github.com/" + owner + "/" + repo + " (one-time setup, then retry)",
              vercel_error: errMsg,
            }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          return new Response(JSON.stringify({ error: errMsg, vercel_status: createRes.status }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        vercelProject = createRes.data;
      }

      // 3. Trigger production deployment from main branch
      const deployRes = await vercelFetch(VERCEL_TOKEN, "/v13/deployments", {
        method: "POST",
        body: JSON.stringify({
          name: projectName,
          project: vercelProject.id || projectName,
          target: "production",
          gitSource: {
            type: "github",
            ref: "main",
            repoId: vercelProject.link?.repoId,
          },
        }),
      });

      // 4. Resolve canonical domain — re-fetch project to get its real aliases assigned by Vercel
      const refetched = await vercelFetch(VERCEL_TOKEN, `/v9/projects/${vercelProject.id || projectName}`);
      const autoDomain = extractVercelDomain(refetched.ok ? refetched.data : vercelProject, projectName);
      await supabase.from("projects").update({
        domain: autoDomain,
        hosting_platform: "vercel",
      }).eq("id", project_id);

      return new Response(JSON.stringify({
        success: true,
        vercel_project: vercelProject.name,
        domain: autoDomain,
        deployment: deployRes.ok ? { id: deployRes.data?.id, url: deployRes.data?.url } : null,
        deployment_error: deployRes.ok ? null : (deployRes.data?.error?.message || null),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACTION: redeploy - trigger a new deployment
    if (action === "redeploy") {
      const projectName = pickProjectName(project);
      const proj = await vercelFetch(VERCEL_TOKEN, `/v9/projects/${projectName}`);
      if (!proj.ok) {
        return new Response(JSON.stringify({ error: "Vercel project not found. Use action=create first." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const deployRes = await vercelFetch(VERCEL_TOKEN, "/v13/deployments", {
        method: "POST",
        body: JSON.stringify({
          name: projectName,
          project: proj.data.id,
          target: "production",
          gitSource: {
            type: "github",
            ref: "main",
            repoId: proj.data.link?.repoId,
          },
        }),
      });
      if (!deployRes.ok) {
        return new Response(JSON.stringify({ error: deployRes.data?.error?.message || "Redeploy failed", details: deployRes.data }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true, deployment: { id: deployRes.data?.id, url: deployRes.data?.url } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACTION: add_domain - attach a custom domain
    if (action === "add_domain") {
      const { domain } = body;
      if (!domain) {
        return new Response(JSON.stringify({ error: "domain required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const projectName = pickProjectName(project);
      const r = await vercelFetch(VERCEL_TOKEN, `/v10/projects/${projectName}/domains`, {
        method: "POST",
        body: JSON.stringify({ name: domain }),
      });
      if (!r.ok) {
        return new Response(JSON.stringify({ error: r.data?.error?.message || "Add domain failed", details: r.data }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await supabase.from("projects").update({ custom_domain: domain }).eq("id", project_id);
      return new Response(JSON.stringify({ success: true, domain: r.data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action. Use: check | create | redeploy | add_domain" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});