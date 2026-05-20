// Deploy a generated static site (Фабрика сайтов) to GitHub Pages.
// Strategy:
//   1. Render the same static HTML bundle via deploy-cloudflare-direct in
//      build_only mode (reuses ALL templates, anti-fp, cookie banner, etc.).
//   2. Ensure a dedicated repo exists in the authenticated user's GitHub
//      account (created via the project's stored GitHub PAT).
//   3. Push all files in a single commit to the `gh-pages` branch via the
//      Git Trees API (force-update, no history accumulation).
//   4. Enable GitHub Pages for that repo if not already enabled.
//
// Body: { project_id: string, generate_images?: boolean, image_count?: number }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function transliterate(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "j", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
    ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return text.toLowerCase().split("").map((c) => map[c] ?? c).join("");
}

function sanitizeRepoName(name: string, projectId: string): string {
  const base = transliterate(name || "")
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
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const GH_HEADERS_BASE = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "seo-module-sitefactory",
};

async function gh(token: string, path: string, init: RequestInit = {}) {
  const headers = {
    ...GH_HEADERS_BASE,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(init.headers || {}),
  };
  const res = await fetch(`https://api.github.com${path}`, { ...init, headers });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, data, text };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    console.log("[deploy-github-pages] started");
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const projectId: string = body.project_id;
    const generateImages: boolean = body.generate_images !== false;
    const imageCount: number = Math.max(1, Math.min(10, Number(body.image_count) || 1));
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing project_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load project + GitHub token.
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, name, github_token, domain")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ghToken = (project.github_token || "").trim();
    if (!ghToken) {
      return new Response(JSON.stringify({
        error: "github_token_missing",
        message: "Добавьте GitHub Personal Access Token в настройках проекта (Settings → GitHub). Нужны права repo и workflow.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1. Resolve GitHub user login.
    const meRes = await gh(ghToken, "/user");
    if (!meRes.ok || !meRes.data?.login) {
      return new Response(JSON.stringify({
        error: "github_auth_failed",
        message: `GitHub /user failed: ${meRes.status} ${meRes.text.slice(0, 200)}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const ghLogin: string = String(meRes.data.login);
    console.log("[deploy-github-pages] github login:", ghLogin);

    // 2. Ensure repo exists (reuse if already present).
    const repoName = sanitizeRepoName(project.name || "site", projectId);
    const fullRepo = `${ghLogin}/${repoName}`;
    const checkRepo = await gh(ghToken, `/repos/${fullRepo}`);
    if (!checkRepo.ok && checkRepo.status === 404) {
      console.log("[deploy-github-pages] creating repo:", fullRepo);
      const createRes = await gh(ghToken, `/user/repos`, {
        method: "POST",
        body: JSON.stringify({
          name: repoName,
          description: `Site Factory: ${project.name || repoName}`,
          private: false,
          auto_init: true,
          has_issues: false,
          has_projects: false,
          has_wiki: false,
        }),
      });
      if (!createRes.ok) {
        return new Response(JSON.stringify({
          error: "github_repo_create_failed",
          message: `GitHub repo create failed: ${createRes.status} ${createRes.text.slice(0, 300)}`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Repo created with `main` branch; give GitHub a moment to settle.
      await new Promise((r) => setTimeout(r, 1500));
    } else if (!checkRepo.ok) {
      return new Response(JSON.stringify({
        error: "github_repo_check_failed",
        message: `GitHub repo check failed: ${checkRepo.status} ${checkRepo.text.slice(0, 300)}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. Build the site bundle via deploy-cloudflare-direct (build_only mode).
    const targetDomain = `${ghLogin}.github.io/${repoName}`;
    console.log("[deploy-github-pages] building files via cf-direct, domain:", targetDomain);
    const buildRes = await fetch(`${supabaseUrl}/functions/v1/deploy-cloudflare-direct`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        project_id: projectId,
        build_only: true,
        domain_override: targetDomain,
        generate_images: generateImages,
        image_count: imageCount,
      }),
    });
    const buildText = await buildRes.text();
    let buildJson: any = null;
    try { buildJson = JSON.parse(buildText); } catch { /* ignore */ }
    if (!buildRes.ok || !buildJson?.files) {
      return new Response(JSON.stringify({
        error: "build_failed",
        message: `Site build failed: ${buildRes.status} ${buildText.slice(0, 500)}`,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const files: Record<string, string> = buildJson.files;
    console.log("[deploy-github-pages] files built:", Object.keys(files).length);

    // 4. Push all files to `gh-pages` via Git Trees API (force-update branch).
    // 4a. Resolve a base commit/tree (use default branch as parent if first deploy).
    const ghPagesRef = await gh(ghToken, `/repos/${fullRepo}/git/ref/heads/gh-pages`);
    let parentCommitSha: string | null = null;
    let baseTreeSha: string | null = null;
    if (ghPagesRef.ok) {
      parentCommitSha = ghPagesRef.data?.object?.sha || null;
      if (parentCommitSha) {
        const cr = await gh(ghToken, `/repos/${fullRepo}/git/commits/${parentCommitSha}`);
        if (cr.ok) baseTreeSha = cr.data?.tree?.sha || null;
      }
    } else {
      // No gh-pages yet — start from default branch's commit (auto_init created `main`).
      const repoMeta = await gh(ghToken, `/repos/${fullRepo}`);
      const defaultBranch = repoMeta.data?.default_branch || "main";
      const mainRef = await gh(ghToken, `/repos/${fullRepo}/git/ref/heads/${defaultBranch}`);
      if (mainRef.ok) {
        parentCommitSha = mainRef.data?.object?.sha || null;
        if (parentCommitSha) {
          const cr = await gh(ghToken, `/repos/${fullRepo}/git/commits/${parentCommitSha}`);
          if (cr.ok) baseTreeSha = cr.data?.tree?.sha || null;
        }
      }
    }

    // 4b. Create a blob for each file (chunked to avoid rate limits).
    const entries = Object.entries(files);
    const treeItems: { path: string; mode: string; type: "blob"; sha: string }[] = [];
    const CHUNK = 8;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      const results = await Promise.all(chunk.map(async ([path, content]) => {
        const r = await gh(ghToken, `/repos/${fullRepo}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: utf8ToBase64(content), encoding: "base64" }),
        });
        if (!r.ok) throw new Error(`blob ${path} failed: ${r.status} ${r.text.slice(0, 200)}`);
        return { path, mode: "100644", type: "blob" as const, sha: r.data.sha };
      }));
      treeItems.push(...results);
      console.log("[deploy-github-pages] blobs uploaded:", treeItems.length, "/", entries.length);
    }

    // Add a .nojekyll marker so GitHub Pages serves files as-is (no Jekyll).
    {
      const r = await gh(ghToken, `/repos/${fullRepo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: "", encoding: "utf-8" }),
      });
      if (r.ok) treeItems.push({ path: ".nojekyll", mode: "100644", type: "blob", sha: r.data.sha });
    }

    // 4c. Create a tree. Omit base_tree to fully replace the working set so
    //     deleted/renamed posts disappear on re-deploy.
    const treeRes = await gh(ghToken, `/repos/${fullRepo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ tree: treeItems }),
    });
    if (!treeRes.ok) {
      return new Response(JSON.stringify({
        error: "github_tree_failed",
        message: `Create tree failed: ${treeRes.status} ${treeRes.text.slice(0, 300)}`,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const newTreeSha = treeRes.data.sha;

    // 4d. Create commit.
    const commitBody: any = {
      message: `[Site Factory] deploy ${new Date().toISOString()}`,
      tree: newTreeSha,
    };
    if (parentCommitSha) commitBody.parents = [parentCommitSha];
    const commitRes = await gh(ghToken, `/repos/${fullRepo}/git/commits`, {
      method: "POST",
      body: JSON.stringify(commitBody),
    });
    if (!commitRes.ok) {
      return new Response(JSON.stringify({
        error: "github_commit_failed",
        message: `Create commit failed: ${commitRes.status} ${commitRes.text.slice(0, 300)}`,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const newCommitSha = commitRes.data.sha;

    // 4e. Update or create the gh-pages ref (force).
    let refUpdate: any;
    if (ghPagesRef.ok) {
      refUpdate = await gh(ghToken, `/repos/${fullRepo}/git/refs/heads/gh-pages`, {
        method: "PATCH",
        body: JSON.stringify({ sha: newCommitSha, force: true }),
      });
    } else {
      refUpdate = await gh(ghToken, `/repos/${fullRepo}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: "refs/heads/gh-pages", sha: newCommitSha }),
      });
    }
    if (!refUpdate.ok) {
      return new Response(JSON.stringify({
        error: "github_ref_update_failed",
        message: `Ref update failed: ${refUpdate.status} ${refUpdate.text.slice(0, 300)}`,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 5. Enable GitHub Pages from gh-pages branch (idempotent — 409 = already on).
    const pagesRes = await gh(ghToken, `/repos/${fullRepo}/pages`, {
      method: "POST",
      body: JSON.stringify({ source: { branch: "gh-pages", path: "/" } }),
    });
    if (!pagesRes.ok && pagesRes.status !== 409) {
      console.warn("[deploy-github-pages] Pages enable warning:", pagesRes.status, pagesRes.text.slice(0, 200));
    }

    const siteUrl = `https://${ghLogin}.github.io/${repoName}/`;
    const blogUrl = `${siteUrl}blog`;
    console.log("[deploy-github-pages] success:", siteUrl);

    // Persist domain + repo info on the project so UI shows the live URL.
    await supabaseAdmin.from("projects").update({
      domain: `${ghLogin}.github.io/${repoName}/blog`,
      github_repo: fullRepo,
      hosting_platform: "github_pages",
    }).eq("id", projectId);

    return new Response(JSON.stringify({
      success: true,
      url: siteUrl,
      blog_url: blogUrl,
      repo: fullRepo,
      files_count: treeItems.length,
      message: `Сайт опубликован на GitHub Pages. URL появится в течение 1-2 минут: ${siteUrl}`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("[deploy-github-pages] ERROR:", err?.message, err?.stack);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});