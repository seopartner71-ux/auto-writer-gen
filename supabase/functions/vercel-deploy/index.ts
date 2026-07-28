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

function normalizeHost(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  }
}

// Pick a domain that is known to be reachable. Team Vercel projects often do
// not expose the short "<project>.vercel.app" host publicly, so prefer the
// deployment URL returned by Vercel over guessed aliases.
function extractVercelDomain(vercelProject: any, fallbackName: string, deployment?: any): string {
  const deploymentHost = normalizeHost(deployment?.url);
  if (deploymentHost) return deploymentHost;
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
  const vercelApp = aliases.map(normalizeHost).filter((d) => d.endsWith(".vercel.app"));
  if (vercelApp.length > 0) return vercelApp[0];
  const firstAlias = aliases.map(normalizeHost).find(Boolean);
  if (firstAlias) return firstAlias;
  return `${fallbackName}.vercel.app`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SHARED_VERCEL_TOKEN = Deno.env.get("VERCEL_API_TOKEN") || "";

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
      .select("id, name, user_id, github_repo, github_token, domain, custom_domain, vercel_token")
      .eq("id", project_id)
      .maybeSingle();

    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (project.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACTION: token_status — does this project have its own Vercel token?
    if (action === "token_status") {
      return new Response(JSON.stringify({
        has_custom_token: !!project.vercel_token,
        shared_token_available: !!SHARED_VERCEL_TOKEN,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACTION: save_token — attach a personal Vercel token to this project (encrypted)
    if (action === "save_token") {
      const { token } = body || {};
      if (!token || typeof token !== "string" || token.length < 10) {
        return new Response(JSON.stringify({ error: "Invalid Vercel token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Validate against Vercel API before saving
      const who = await vercelFetch(token.trim(), "/v2/user");
      if (!who.ok) {
        return new Response(JSON.stringify({ error: "Vercel rejected the token", details: who.data }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: enc, error: encErr } = await supabase.rpc("encrypt_sensitive", { plaintext: token.trim() });
      if (encErr) {
        return new Response(JSON.stringify({ error: "Failed to encrypt token", details: encErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await supabase.from("projects").update({ vercel_token: enc }).eq("id", project_id);
      return new Response(JSON.stringify({ success: true, account: who.data?.user?.username || who.data?.user?.email || null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACTION: clear_token — remove the personal token and fall back to shared account
    if (action === "clear_token") {
      await supabase.from("projects").update({ vercel_token: null }).eq("id", project_id);
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Resolve which Vercel token to use for deploy actions: per-project overrides shared.
    let VERCEL_TOKEN = SHARED_VERCEL_TOKEN;
    if (project.vercel_token) {
      const { data: dec, error: decErr } = await supabase.rpc("decrypt_sensitive", { ciphertext: project.vercel_token });
      if (decErr || !dec) {
        return new Response(JSON.stringify({ error: "Failed to decrypt project Vercel token" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      VERCEL_TOKEN = String(dec);
    }
    if (!VERCEL_TOKEN) {
      return new Response(JSON.stringify({ error: "No Vercel token available. Add a personal token or configure VERCEL_API_TOKEN." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
      const autoDomain = extractVercelDomain(refetched.ok ? refetched.data : vercelProject, projectName, deployRes.ok ? deployRes.data : null);
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
      const autoDomain = extractVercelDomain(proj.data, projectName, deployRes.data);
      await supabase.from("projects").update({
        domain: autoDomain,
        hosting_platform: "vercel",
      }).eq("id", project_id);
      return new Response(JSON.stringify({ success: true, domain: autoDomain, deployment: { id: deployRes.data?.id, url: deployRes.data?.url } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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