// Migrate a Direct Upload Vercel site to a GitHub-linked Vercel deployment.
// Flow:
//   1. Verify the user's personal GitHub token (Vercel Hobby account).
//   2. Create a new public GitHub repo under that account (auto_init).
//   3. Build the current site's static files via deploy-cloudflare-direct
//      in build_only mode (reuses all templates, SEO, anti-fp).
//   4. Push every file in a single commit via the Git Data API.
//   5. Create a Vercel project linked to that repo (framework: null → serves
//      static HTML as-is) and trigger a production deployment.
//   6. Persist github_repo / github_token / hosting_platform on the project so
//      the existing GitHub-linked panel takes over.
//
// After a successful run the site lives at a clean `<repo>.vercel.app` alias
// (no team hash → no X-Robots-Tag: noindex).
//
// Body: { project_id: string, github_token: string, repo_name?: string,
//         private?: boolean }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GITHUB_API = "https://api.github.com";
const VERCEL_API = "https://api.vercel.com";

function transliterate(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "j", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
    ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return (text || "").toLowerCase().split("").map((c) => map[c] ?? c).join("");
}

function slugifyRepoName(raw: string, projectId: string): string {
  const base = transliterate(raw)
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "site";
  const suffix = projectId.replace(/-/g, "").slice(0, 6);
  return `${base}-${suffix}`.replace(/^-|-$/g, "").slice(0, 80);
}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
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

async function gh(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "seo-modul-vercel-linker",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function vercel(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${VERCEL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
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
    const status = await vercel(token, `/v13/deployments/${encodeURIComponent(id)}`);
    if (!status.ok) {
      console.log("[vercel-link-github] deployment poll failed:", status.status, status.data?.error?.message || status.data?.message || "");
      await sleep(1500);
      continue;
    }
    const state = status.data?.readyState || status.data?.status;
    console.log("[vercel-link-github] deployment poll:", attempt, state || "unknown");
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
    console.log("[vercel-link-github] alias skipped: missing deployment id", alias);
    return;
  }
  const assign = await vercel(token, `/v2/deployments/${encodeURIComponent(id)}/aliases`, {
    method: "POST",
    body: JSON.stringify({ alias }),
  });
  if (!assign.ok && assign.status !== 409) {
    throw new Error(`Vercel alias assignment failed for ${alias}: ${assign.status} ${assign.data?.error?.message || assign.data?.message || ""}`);
  }
  console.log("[vercel-link-github] alias assigned:", alias, "deployment:", id, "status:", assign.status);
}

function replaceHostInFiles(files: Record<string, string>, from: string, to: string): Record<string, string> {
  if (!from || !to || from === to) return files;
  const fromHttps = `https://${from}`;
  const fromHttp = `http://${from}`;
  const toHttps = `https://${to}`;
  const out: Record<string, string> = {};
  for (const [p, c] of Object.entries(files)) {
    out[p] = String(c).replaceAll(fromHttps, toHttps).replaceAll(fromHttp, toHttps);
  }
  return out;
}

function extractStableVercelDomain(vercelProject: any, fallbackName: string, deployment?: any): string {
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
    .filter((d) => d.endsWith(".vercel.app") && !d.includes("-projects.vercel.app"));
  if (vercelApp.includes(fallbackAlias)) return fallbackAlias;
  if (vercelApp.length > 0) return vercelApp.sort((a, b) => a.length - b.length)[0];
  const firstAlias = aliases.map(normalizeHost).find(Boolean);
  if (firstAlias) return firstAlias;
  const deploymentHost = normalizeHost(deployment?.url);
  if (deploymentHost) return deploymentHost;
  return fallbackAlias;
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    console.log("[vercel-link-github] started");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;

    const body = await req.json().catch(() => ({}));
    const projectId: string = body.project_id;
    const ghToken: string = (body.github_token || "").trim();
    const wantPrivate = !!body.private;
    if (!projectId || !ghToken) {
      return new Response(JSON.stringify({ error: "project_id and github_token are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: project, error: projErr } = await supabaseAdmin
      .from("projects")
      .select("id, name, user_id, domain, custom_domain, vercel_token, github_repo, template_type, hosting_platform")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (project.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Resolve GitHub owner from token.
    const me = await gh(ghToken, "/user");
    if (!me.ok || !me.data?.login) {
      return new Response(JSON.stringify({
        error: "invalid_github_token",
        message: "GitHub отклонил токен. Проверьте scope: repo (для приватных) или public_repo (для публичных).",
        details: me.data,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const owner: string = me.data.login;
    console.log("[vercel-link-github] github user:", owner);

    // 2. Resolve Vercel token (per-project overrides shared).
    let vercelToken = (Deno.env.get("VERCEL_API_TOKEN") || "").trim();
    if (project.vercel_token) {
      const { data: dec } = await supabaseAdmin.rpc("decrypt_sensitive", { ciphertext: project.vercel_token });
      if (typeof dec === "string" && dec.trim()) vercelToken = dec.trim();
    }
    if (!vercelToken) {
      return new Response(JSON.stringify({
        error: "vercel_token_missing",
        message: "Нет Vercel-токена. Сначала подключите личный Vercel-токен к проекту.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const whoVercel = await vercel(vercelToken, "/v2/user");
    if (!whoVercel.ok) {
      return new Response(JSON.stringify({
        error: "invalid_vercel_token",
        message: "Vercel отклонил токен. Обновите его в настройках сайта.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. Pick repo name.
    const repoBase = String(body.repo_name || project.name || "site");
    const repoName = slugifyRepoName(repoBase, projectId);
    console.log("[vercel-link-github] target repo:", `${owner}/${repoName}`);

    // 4. Create GitHub repo (auto_init so we get a base ref immediately).
    const createRepo = await gh(ghToken, "/user/repos", {
      method: "POST",
      body: JSON.stringify({
        name: repoName,
        private: wantPrivate,
        auto_init: true,
        description: `Static site for ${project.name || repoName} — deployed via Vercel`,
      }),
    });
    if (!createRepo.ok) {
      const msg = createRepo.data?.message || JSON.stringify(createRepo.data);
      if (createRepo.status === 422 && /already exists/i.test(msg)) {
        return new Response(JSON.stringify({
          error: "repo_exists",
          message: `Репозиторий ${owner}/${repoName} уже существует. Удалите его на GitHub или укажите другое имя.`,
        }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        error: "github_create_failed",
        message: `GitHub отклонил создание репозитория: ${msg}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const repoFullName: string = createRepo.data.full_name;
    const defaultBranch: string = createRepo.data.default_branch || "main";
    console.log("[vercel-link-github] repo created:", repoFullName, "branch:", defaultBranch);

    // 5. Build static files (temporary host → we'll rewrite after Vercel gives us the real alias).
    const targetHost = `${repoName}.vercel.app`;
    const authHeader = req.headers.get("Authorization") || "";
    const buildRes = await fetch(`${supabaseUrl}/functions/v1/deploy-cloudflare-direct`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        project_id: projectId,
        build_only: true,
        domain_override: normalizeHost(project.custom_domain) || targetHost,
      }),
    });
    const buildText = await buildRes.text();
    let buildJson: any = null;
    try { buildJson = JSON.parse(buildText); } catch { /* ignore */ }
    if (!buildRes.ok || !buildJson?.files) {
      return new Response(JSON.stringify({
        error: "build_failed",
        message: `Build failed: ${buildRes.status} ${buildText.slice(0, 400)}`,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let files: Record<string, string> = buildJson.files;
    const initialRewrite = rewriteGeneratedVercelHosts(files, targetHost, [project.domain, buildJson?.domain]);
    files = initialRewrite.files;

    // Ensure Vercel serves static HTML with no build command / no framework.
    files["vercel.json"] = JSON.stringify({
      cleanUrls: true,
      trailingSlash: false,
    }, null, 2);
    if (!files["README.md"]) {
      files["README.md"] = `# ${project.name || repoName}\n\nStatic site generated by SEO-Module.\n`;
    }
    const fileCount = Object.keys(files).length;
    console.log("[vercel-link-github] files built:", fileCount);

    const pushFilesCommit = async (siteFiles: Record<string, string>, message: string): Promise<{ commit: string; repoId: number | string | null }> => {
      const repoMeta = await gh(ghToken, `/repos/${repoFullName}`);
      const repoId = repoMeta.ok ? repoMeta.data?.id || null : null;
      // 5a. Get current ref (from auto_init) — retry once because GitHub can lag.
      let baseCommitSha = "";
      let baseTreeSha = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        const refRes = await gh(ghToken, `/repos/${repoFullName}/git/ref/heads/${defaultBranch}`);
        if (refRes.ok && refRes.data?.object?.sha) {
          baseCommitSha = refRes.data.object.sha;
          const commitRes = await gh(ghToken, `/repos/${repoFullName}/git/commits/${baseCommitSha}`);
          if (commitRes.ok) baseTreeSha = commitRes.data.tree.sha;
          break;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      if (!baseCommitSha || !baseTreeSha) {
        throw new Error("GitHub base ref not ready");
      }

      // 5b. Create a blob for every file (base64-encoded to preserve binaries/UTF-8).
      const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
      const paths = Object.keys(siteFiles);
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const content = siteFiles[path];
        const blobRes = await gh(ghToken, `/repos/${repoFullName}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: utf8ToBase64(content), encoding: "base64" }),
        });
        if (!blobRes.ok) throw new Error(`blob failed for ${path}: ${blobRes.status} ${JSON.stringify(blobRes.data).slice(0, 200)}`);
        treeEntries.push({ path, mode: "100644", type: "blob", sha: blobRes.data.sha });
      }

      // 5c. Create tree + commit + move ref.
      const treeRes = await gh(ghToken, `/repos/${repoFullName}/git/trees`, {
        method: "POST",
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
      });
      if (!treeRes.ok) throw new Error(`tree failed: ${JSON.stringify(treeRes.data).slice(0, 200)}`);

      const commitRes = await gh(ghToken, `/repos/${repoFullName}/git/commits`, {
        method: "POST",
        body: JSON.stringify({
          message,
          tree: treeRes.data.sha,
          parents: [baseCommitSha],
        }),
      });
      if (!commitRes.ok) throw new Error(`commit failed: ${JSON.stringify(commitRes.data).slice(0, 200)}`);

      const refUpdate = await gh(ghToken, `/repos/${repoFullName}/git/refs/heads/${defaultBranch}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commitRes.data.sha, force: false }),
      });
      if (!refUpdate.ok) throw new Error(`ref update failed: ${JSON.stringify(refUpdate.data).slice(0, 200)}`);
      return { commit: commitRes.data.sha, repoId };
    };

    let initialPush: { commit: string; repoId: number | string | null } | null = null;
    try {
      initialPush = await pushFilesCommit(files, `Initial site content (${fileCount} files)`);
    } catch (err: any) {
      console.error("[vercel-link-github] push failed:", err?.message);
      return new Response(JSON.stringify({
        error: "github_push_failed",
        message: err?.message || String(err),
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 6. Save GitHub link to project BEFORE creating Vercel project so subsequent
    //    redeploys via vercel-deploy find github_repo / github_token.
    await supabaseAdmin.from("projects").update({
      github_repo: repoFullName,
      github_token: ghToken,
      hosting_platform: "vercel",
    }).eq("id", projectId);

    // 7. Create Vercel project linked to the new repo. framework: null keeps
    //    static HTML as-is (no build). rootDirectory unset = repo root.
    let vercelProject: any = null;
    const existingProj = await vercel(vercelToken, `/v9/projects/${repoName}`);
    if (existingProj.ok) {
      vercelProject = existingProj.data;
    } else {
      const createVProj = await vercel(vercelToken, "/v10/projects", {
        method: "POST",
        body: JSON.stringify({
          name: repoName,
          framework: null,
          buildCommand: null,
          outputDirectory: null,
          installCommand: null,
          gitRepository: { type: "github", repo: repoFullName },
        }),
      });
      if (!createVProj.ok) {
        const errMsg = createVProj.data?.error?.message || JSON.stringify(createVProj.data);
        // Common: Vercel GitHub App not installed on this account/repo.
        if (/git.?integration|github|not found|forbidden|repo/i.test(errMsg)) {
          return new Response(JSON.stringify({
            error: "vercel_github_app_missing",
            message: "Vercel не может подключить репозиторий. Установите Vercel GitHub App:",
            hint: `https://vercel.com/new/git/import?s=https://github.com/${repoFullName}`,
            github_repo: repoFullName,
          }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          error: "vercel_create_failed",
          message: errMsg,
          github_repo: repoFullName,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      vercelProject = createVProj.data;
    }

    // 8. Trigger production deployment from main.
    const deployRes = await vercel(vercelToken, "/v13/deployments", {
      method: "POST",
      body: JSON.stringify({
        name: repoName,
        project: vercelProject.id || repoName,
        target: "production",
        gitSource: {
          type: "github",
          ref: defaultBranch,
          repoId: vercelProject.link?.repoId || initialPush?.repoId,
        },
      }),
    });
    let activeDeployRes = deployRes;

    // 9. Persist stable public domain and, if Vercel assigned a different clean
    // alias, rewrite SEO artifacts in GitHub and trigger one more deployment.
    const refetchedProject = await vercel(vercelToken, `/v9/projects/${vercelProject.id || repoName}`);
    const stableHost = normalizeHost(project.custom_domain)
      || extractStableVercelDomain(refetchedProject.ok ? refetchedProject.data : vercelProject, repoName, deployRes.ok ? deployRes.data : null);
    if (stableHost && stableHost !== targetHost) {
      const finalRewrite = rewriteGeneratedVercelHosts(files, stableHost, [targetHost, project.domain, buildJson?.domain, deployRes.data?.url]);
      files = finalRewrite.files;
      const finalPush = await pushFilesCommit(files, `Rewrite SEO host to ${stableHost}`);
      activeDeployRes = await vercel(vercelToken, "/v13/deployments", {
        method: "POST",
        body: JSON.stringify({
          name: repoName,
          project: vercelProject.id || repoName,
          target: "production",
          gitSource: {
            type: "github",
            ref: defaultBranch,
            repoId: vercelProject.link?.repoId || finalPush.repoId || initialPush?.repoId,
          },
        }),
      });
    }
    if (activeDeployRes.ok) {
      await assignProductionAlias(vercelToken, activeDeployRes.data, stableHost);
    }

    const publicUrl = `https://${stableHost}`;
    await supabaseAdmin.from("projects").update({
      domain: stableHost,
      hosting_platform: "vercel",
      last_deploy_at: new Date().toISOString(),
    }).eq("id", projectId);

    console.log("[vercel-link-github] done:", publicUrl);
    return new Response(JSON.stringify({
      success: true,
      github_repo: repoFullName,
      vercel_project: vercelProject.name,
      domain: stableHost,
      url: publicUrl,
      deployment: deployRes.ok ? { id: deployRes.data?.id, url: deployRes.data?.url } : null,
      message: `Site migrated to GitHub-linked Vercel. Live: ${publicUrl}`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[vercel-link-github] ERROR:", err?.message, err?.stack);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});