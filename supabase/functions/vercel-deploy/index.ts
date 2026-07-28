import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VERCEL_API = "https://api.vercel.com";
const GITHUB_API = "https://api.github.com";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deploymentAliasId(deployment: any): string {
  return String(deployment?.id || deployment?.uid || deployment?.url || "").trim();
}

async function waitForDeploymentReady(token: string, deployment: any): Promise<any> {
  const id = deploymentAliasId(deployment);
  if (!id) return deployment;
  for (let attempt = 0; attempt < 50; attempt++) {
    const status = await vercelFetch(token, `/v13/deployments/${encodeURIComponent(id)}`);
    if (!status.ok) {
      console.log("[vercel-deploy] deployment poll failed:", status.status, status.data?.error?.message || status.data?.message || "");
      await sleep(1500);
      continue;
    }
    const state = status.data?.readyState || status.data?.status;
    console.log("[vercel-deploy] deployment poll:", attempt, state || "unknown");
    if (state === "READY") return status.data;
    if (state === "ERROR" || state === "CANCELED") {
      throw new Error(`Vercel deployment ended with state ${state}`);
    }
    await sleep(1500);
  }
  return deployment;
}

async function assignProductionAlias(token: string, deployment: any, aliasHost: string): Promise<void> {
  const alias = normalizeHost(aliasHost);
  if (!alias) return;
  const readyDeployment = await waitForDeploymentReady(token, deployment);
  const id = deploymentAliasId(readyDeployment) || deploymentAliasId(deployment);
  if (!id) {
    console.log("[vercel-deploy] alias skipped: missing deployment id", alias);
    return;
  }
  const assign = await vercelFetch(token, `/v2/deployments/${encodeURIComponent(id)}/aliases`, {
    method: "POST",
    body: JSON.stringify({ alias }),
  });
  if (!assign.ok && assign.status !== 409) {
    throw new Error(`Vercel alias assignment failed for ${alias}: ${assign.status} ${assign.data?.error?.message || assign.data?.message || ""}`);
  }
  console.log("[vercel-deploy] alias assigned:", alias, "deployment:", id, "status:", assign.status);
}

async function githubFetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "seo-modul-vercel-deploy",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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

function isVercelSystemHost(host: string): boolean {
  const value = normalizeHost(host);
  return value.endsWith(".vercel.app") && /-[a-z0-9]+-.*projects\.vercel\.app$/i.test(value);
}

function isCleanVercelHost(host: string): boolean {
  const value = normalizeHost(host);
  return value.endsWith(".vercel.app") && !isVercelSystemHost(value);
}

// Pick the stable public alias, not the deployment-scoped URL. Deployment URLs
// can leak into sitemap.xml and robots.txt, and Vercel may mark them noindex.
function extractVercelDomain(vercelProject: any, fallbackName: string, deployment?: any): string {
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
  const fallbackAlias = `${fallbackName}.vercel.app`;
  const vercelApp = aliases
    .map(normalizeHost)
    .filter(isCleanVercelHost);
  if (vercelApp.includes(fallbackAlias)) return fallbackAlias;
  if (vercelApp.length > 0) return vercelApp.sort((a, b) => a.length - b.length)[0];
  const firstAlias = aliases.map(normalizeHost).find((d) => d && !isVercelSystemHost(d));
  if (firstAlias) return firstAlias;
  const deploymentHost = normalizeHost(deployment?.url);
  if (deploymentHost && !isVercelSystemHost(deploymentHost)) return deploymentHost;
  return `${fallbackName}.vercel.app`;
}

function replaceHostInFiles(files: Record<string, string>, fromHost: string, toHost: string): Record<string, string> {
  if (!fromHost || !toHost || fromHost === toHost) return files;
  const fromHttps = `https://${fromHost}`;
  const fromHttp = `http://${fromHost}`;
  const toHttps = `https://${toHost}`;
  return Object.fromEntries(
    Object.entries(files).map(([path, content]) => [
      path,
      String(content).replaceAll(fromHttps, toHttps).replaceAll(fromHttp, toHttps),
    ]),
  );
}

function rewriteGeneratedVercelHosts(
  files: Record<string, string>,
  toHost: string,
  knownHosts: string[],
): { files: Record<string, string>; changed: boolean; replacedHosts: string[] } {
  const targetHost = normalizeHost(toHost);
  if (!targetHost) return { files, changed: false, replacedHosts: [] };

  const hosts = new Set<string>();
  for (const h of knownHosts) {
    const host = normalizeHost(h);
    if (host && host !== targetHost) hosts.add(host);
  }

  const absoluteVercelUrl = /https?:\/\/([a-z0-9][a-z0-9.-]*\.vercel\.app)(?=[/:?#"'<)\s]|$)/gi;
  for (const content of Object.values(files)) {
    for (const match of String(content).matchAll(absoluteVercelUrl)) {
      const host = normalizeHost(match[1]);
      if (host && host !== targetHost) hosts.add(host);
    }
  }

  let changed = false;
  let next = files;
  const replacedHosts = [...hosts];
  for (const host of replacedHosts) {
    const before = next;
    next = replaceHostInFiles(next, host, targetHost);
    if (next !== before) changed = true;
  }

  const toHttps = `https://${targetHost}`;
  const normalized = Object.fromEntries(
    Object.entries(next).map(([path, content]) => {
      const rewritten = String(content).replace(absoluteVercelUrl, toHttps);
      if (rewritten !== content) changed = true;
      return [path, rewritten];
    }),
  );

  return { files: normalized, changed, replacedHosts };
}

async function pushFilesToGithub(
  token: string,
  repoFullName: string,
  files: Record<string, string>,
  message: string,
): Promise<{ branch: string; commit: string; repoId: number | string | null }> {
  const repoRes = await githubFetch(token, `/repos/${repoFullName}`);
  if (!repoRes.ok) throw new Error(`GitHub repo unavailable: ${repoRes.status}`);
  const branch = repoRes.data?.default_branch || "main";
  const repoId = repoRes.data?.id || null;

  const refRes = await githubFetch(token, `/repos/${repoFullName}/git/ref/heads/${branch}`);
  if (!refRes.ok || !refRes.data?.object?.sha) throw new Error(`GitHub branch unavailable: ${branch}`);
  const baseCommitSha = refRes.data.object.sha;

  const commitBase = await githubFetch(token, `/repos/${repoFullName}/git/commits/${baseCommitSha}`);
  if (!commitBase.ok || !commitBase.data?.tree?.sha) throw new Error("GitHub base tree unavailable");

  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const [path, content] of Object.entries(files)) {
    const blobRes = await githubFetch(token, `/repos/${repoFullName}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: utf8ToBase64(String(content)), encoding: "base64" }),
    });
    if (!blobRes.ok || !blobRes.data?.sha) {
      throw new Error(`GitHub blob failed for ${path}: ${blobRes.status}`);
    }
    treeEntries.push({ path, mode: "100644", type: "blob", sha: blobRes.data.sha });
  }

  const treeRes = await githubFetch(token, `/repos/${repoFullName}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: commitBase.data.tree.sha, tree: treeEntries }),
  });
  if (!treeRes.ok || !treeRes.data?.sha) throw new Error(`GitHub tree failed: ${treeRes.status}`);

  const commitRes = await githubFetch(token, `/repos/${repoFullName}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: treeRes.data.sha, parents: [baseCommitSha] }),
  });
  if (!commitRes.ok || !commitRes.data?.sha) throw new Error(`GitHub commit failed: ${commitRes.status}`);

  const updateRes = await githubFetch(token, `/repos/${repoFullName}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commitRes.data.sha, force: false }),
  });
  if (!updateRes.ok) throw new Error(`GitHub ref update failed: ${updateRes.status}`);

  return { branch, commit: commitRes.data.sha, repoId };
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

    const fetchVercelProject = async (preferredName: string) => {
      const candidates = [
        preferredName,
        normalizeHost(project.domain).replace(/\.vercel\.app$/, ""),
        normalizeHost(project.custom_domain).replace(/\.vercel\.app$/, ""),
      ].filter(Boolean);
      const seen = new Set<string>();
      for (const candidate of candidates) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        const result = await vercelFetch(VERCEL_TOKEN, `/v9/projects/${candidate}`);
        if (result.ok) return result;
      }
      return { ok: false, status: 404, data: null };
    };

    const buildAndPushGithubFiles = async (publicHost: string, message: string) => {
      if (!project.github_repo || !project.github_token) return null;

      let githubToken = String(project.github_token || "").trim();
      const { data: decryptedGithubToken } = await supabase.rpc("decrypt_sensitive", { ciphertext: githubToken });
      if (typeof decryptedGithubToken === "string" && decryptedGithubToken.trim()) {
        githubToken = decryptedGithubToken.trim();
      }
      if (!githubToken) return null;

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const finalHost = normalizeHost(project.custom_domain) || normalizeHost(publicHost);
      const buildRes = await fetch(`${supabaseUrl}/functions/v1/deploy-cloudflare-direct`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({
          project_id,
          build_only: true,
          domain_override: finalHost,
        }),
      });
      const buildText = await buildRes.text();
      let buildJson: any = null;
      try { buildJson = JSON.parse(buildText); } catch { /* ignore */ }
      if (!buildRes.ok || !buildJson?.files) {
        throw new Error(`Build failed before Vercel deployment: ${buildRes.status} ${buildText.slice(0, 300)}`);
      }

      let files: Record<string, string> = buildJson.files;
      files["vercel.json"] = JSON.stringify({ cleanUrls: true, trailingSlash: false }, null, 2);
      if (!files["README.md"]) {
        files["README.md"] = `# ${project.name || publicHost}\n\nStatic site generated by SEO-Module.\n`;
      }

      const rewrite = rewriteGeneratedVercelHosts(files, finalHost, [
        project.domain,
        project.custom_domain,
        buildJson?.domain,
        publicHost,
      ]);
      files = rewrite.files;
      console.log("[vercel-deploy] github files rewrite:", {
        finalHost,
        changed: rewrite.changed,
        replacedHosts: rewrite.replacedHosts,
      });

      return await pushFilesToGithub(githubToken, String(project.github_repo), files, message);
    };

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

      const refetchedBeforeDeploy = await vercelFetch(VERCEL_TOKEN, `/v9/projects/${vercelProject.id || projectName}`);
      let autoDomain = extractVercelDomain(refetchedBeforeDeploy.ok ? refetchedBeforeDeploy.data : vercelProject, projectName);
      const pushed = await buildAndPushGithubFiles(autoDomain, `Update generated site for ${autoDomain}`);

      // 3. Trigger production deployment from the branch containing freshly generated files
      const deployRes = await vercelFetch(VERCEL_TOKEN, "/v13/deployments", {
        method: "POST",
        body: JSON.stringify({
          name: projectName,
          project: vercelProject.id || projectName,
          target: "production",
          gitSource: {
            type: "github",
            ref: pushed?.branch || "main",
            repoId: vercelProject.link?.repoId || pushed?.repoId,
          },
        }),
      });
      let activeDeployRes = deployRes;

      // 4. Resolve canonical domain — re-fetch project to get its real aliases assigned by Vercel
      const refetched = await vercelFetch(VERCEL_TOKEN, `/v9/projects/${vercelProject.id || projectName}`);
      const finalDomain = normalizeHost(project.custom_domain) || extractVercelDomain(refetched.ok ? refetched.data : vercelProject, projectName);
      if (finalDomain && finalDomain !== autoDomain) {
        const repushed = await buildAndPushGithubFiles(finalDomain, `Rewrite SEO host to ${finalDomain}`);
        if (repushed) {
          activeDeployRes = await vercelFetch(VERCEL_TOKEN, "/v13/deployments", {
            method: "POST",
            body: JSON.stringify({
              name: projectName,
              project: vercelProject.id || projectName,
              target: "production",
              gitSource: {
                type: "github",
                ref: repushed.branch,
                repoId: vercelProject.link?.repoId || repushed.repoId || pushed?.repoId,
              },
            }),
          });
        }
        autoDomain = finalDomain;
      } else {
        autoDomain = finalDomain || autoDomain;
      }
      if (activeDeployRes.ok) {
        await assignProductionAlias(VERCEL_TOKEN, activeDeployRes.data, autoDomain);
      }
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
      const proj = await fetchVercelProject(projectName);
      if (!proj.ok) {
        return new Response(JSON.stringify({ error: "Vercel project not found. Use action=create first." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const stableDomain = normalizeHost(project.custom_domain)
        || normalizeHost(project.domain)
        || extractVercelDomain(proj.data, projectName);
      const pushed = await buildAndPushGithubFiles(stableDomain, `Update generated site for ${stableDomain}`);
      const deployRes = await vercelFetch(VERCEL_TOKEN, "/v13/deployments", {
        method: "POST",
        body: JSON.stringify({
          name: projectName,
          project: proj.data.id,
          target: "production",
          gitSource: {
            type: "github",
            ref: pushed?.branch || "main",
            repoId: proj.data.link?.repoId || pushed?.repoId,
          },
        }),
      });
      let activeDeployRes = deployRes;
      if (!deployRes.ok) {
        return new Response(JSON.stringify({ error: deployRes.data?.error?.message || "Redeploy failed", details: deployRes.data }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const refetched = await vercelFetch(VERCEL_TOKEN, `/v9/projects/${proj.data.id || projectName}`);
      let autoDomain = normalizeHost(project.custom_domain)
        || extractVercelDomain(refetched.ok ? refetched.data : proj.data, projectName)
        || stableDomain;
      if (!normalizeHost(project.custom_domain) && normalizeHost(project.domain)) {
        autoDomain = normalizeHost(project.domain);
      }
      if (isVercelSystemHost(autoDomain)) {
        autoDomain = stableDomain;
      }
      if (autoDomain && autoDomain !== stableDomain) {
        const repushed = await buildAndPushGithubFiles(autoDomain, `Rewrite SEO host to ${autoDomain}`);
        if (repushed) {
          activeDeployRes = await vercelFetch(VERCEL_TOKEN, "/v13/deployments", {
            method: "POST",
            body: JSON.stringify({
              name: projectName,
              project: proj.data.id,
              target: "production",
              gitSource: {
                type: "github",
                ref: repushed.branch,
                repoId: proj.data.link?.repoId || repushed.repoId || pushed?.repoId,
              },
            }),
          });
        }
      } else {
        autoDomain = stableDomain;
      }
      if (activeDeployRes.ok) {
        await assignProductionAlias(VERCEL_TOKEN, activeDeployRes.data, autoDomain);
      }
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