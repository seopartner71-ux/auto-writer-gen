// Vercel Direct Upload deployment for Site Factory bulk grid.
// Mirrors deploy-cloudflare-direct: builds files via cf-direct in build_only
// mode (reuses all templates, SEO, anti-fp), then uploads to Vercel via the
// v13 Deployments API with inline files (no GitHub repo required).
//
// Body: { project_id: string, template_key?: string, site_name?: string,
//         site_about?: string, topic?: string, region?: string,
//         services?: string, audience?: string, business_type?: string,
//         language?: string, starter_article_count?: number,
//         generate_images?: boolean, image_count?: number }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth } from "../_shared/auth.ts";
import { logCost } from "../_shared/costLogger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

function sanitizeVercelName(name: string, projectId: string): string {
  const base = transliterate(name)
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

async function resolveVercelToken(
  supabase: any,
  project: any,
): Promise<{ token: string; source: "project" | "shared" } | null> {
  if (project?.vercel_token) {
    const { data: dec, error } = await supabase.rpc("decrypt_sensitive", { ciphertext: project.vercel_token });
    if (!error && typeof dec === "string" && dec.trim()) {
      return { token: dec.trim(), source: "project" };
    }
  }
  const shared = (Deno.env.get("VERCEL_API_TOKEN") || "").trim();
  if (shared) return { token: shared, source: "shared" };
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    console.log("[deploy-vercel-direct] started");
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const __auth = await verifyAuth(req);
    if (__auth instanceof Response) return __auth;
    const user = { id: __auth.userId };

    const body = await req.json().catch(() => ({}));
    const projectId: string = body.project_id;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing project_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: project, error: projErr } = await supabaseAdmin
      .from("projects")
      .select("id, name, user_id, vercel_token, domain, custom_domain")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (project.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokenInfo = await resolveVercelToken(supabaseAdmin, project);
    if (!tokenInfo) {
      return new Response(JSON.stringify({
        error: "vercel_token_missing",
        message: "Нет Vercel-токена. Подключите личный токен в панели Vercel проекта или задайте общий VERCEL_API_TOKEN.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const vercelToken = tokenInfo.token;

    const vercelProjectName = sanitizeVercelName(project.name || body.site_name || "site", projectId);
    const targetDomain = `${vercelProjectName}.vercel.app`;
    console.log("[deploy-vercel-direct] target:", targetDomain, "tokenSource:", tokenInfo.source);

    // 1. Build files via deploy-cloudflare-direct in build_only mode.
    const buildBody: Record<string, unknown> = {
      project_id: projectId,
      build_only: true,
      domain_override: targetDomain,
      template_key: body.template_key,
      site_name: body.site_name,
      site_about: body.site_about,
      topic: body.topic,
      region: body.region,
      services: body.services,
      audience: body.audience,
      business_type: body.business_type,
      language: body.language,
      starter_article_count: body.starter_article_count,
      generate_images: body.generate_images,
      image_count: body.image_count,
    };
    const buildRes = await fetch(`${supabaseUrl}/functions/v1/deploy-cloudflare-direct`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify(buildBody),
    });
    const buildText = await buildRes.text();
    let buildJson: any = null;
    try { buildJson = JSON.parse(buildText); } catch { /* ignore */ }
    if (!buildRes.ok || !buildJson?.files) {
      console.log("[deploy-vercel-direct] build failed:", buildRes.status, buildText.slice(0, 400));
      return new Response(JSON.stringify({
        error: "build_failed",
        message: `Site build failed: ${buildRes.status} ${buildText.slice(0, 400)}`,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let files: Record<string, string> = buildJson.files;
    const fileCount = Object.keys(files).length;
    console.log("[deploy-vercel-direct] files built:", fileCount);

    const deployFiles = async (siteFiles: Record<string, string>) => {
      const vercelFiles = Object.entries(siteFiles).map(([path, content]) => ({
        file: path,
        data: utf8ToBase64(content),
        encoding: "base64",
      }));

      const deployPayload = {
        name: vercelProjectName,
        files: vercelFiles,
        target: "production",
        projectSettings: {
          framework: null,
          buildCommand: null,
          installCommand: null,
          devCommand: null,
          outputDirectory: null,
        },
      };

      const res = await fetch(`${VERCEL_API}/v13/deployments?forceNew=1`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${vercelToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(deployPayload),
      });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* ignore */ }
      return { res, text, json };
    };

    const firstDeploy = await deployFiles(files);
    let deployJson: any = firstDeploy.json;
    let deployText = firstDeploy.text;
    console.log("[deploy-vercel-direct] deploy status:", firstDeploy.res.status, "ok:", firstDeploy.res.ok);
    if (!firstDeploy.res.ok) {
      const err = deployJson?.error?.message || deployJson?.error?.code || deployText.slice(0, 400);
      return new Response(JSON.stringify({
        error: "vercel_deploy_failed",
        message: `Vercel deployment failed: ${firstDeploy.res.status} ${err}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Disable Vercel deployment protection (SSO/Password) so the public URL
    // opens the site instead of Vercel's login page. On Pro/Team accounts new
    // projects inherit team-level protection by default.
    try {
      const teamId: string | undefined = deployJson?.team?.id || deployJson?.ownerId;
      const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
      const patchRes = await fetch(`${VERCEL_API}/v9/projects/${encodeURIComponent(vercelProjectName)}${qs}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${vercelToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ssoProtection: null,
          passwordProtection: null,
        }),
      });
      console.log("[deploy-vercel-direct] protection disable status:", patchRes.status);
      if (!patchRes.ok) {
        const t = await patchRes.text();
        console.log("[deploy-vercel-direct] protection disable body:", t.slice(0, 300));
      }
    } catch (e) {
      console.log("[deploy-vercel-direct] protection disable error:", (e as Error).message);
    }

    // For Direct Upload under Team accounts Vercel's public URL is often the
    // deployment/project scoped host: "<name>-<team>.vercel.app". The shorter
    // "<project>.vercel.app" can point at Vercel auth/protection, so the URL
    // we persist and bake into sitemap/canonical must be the actual deployment
    // host returned by Vercel, not a guessed clean alias.
    // Determine the STABLE production alias. Vercel returns a deployment-scoped
    // URL (with a per-build hash like `-8jjml4kj4-`) in deployJson.url that
    // changes on every redeploy — we must NOT bake that into sitemap/canonical.
    // Priority:
    //   1. custom_domain from project (if set)
    //   2. project-scoped alias from /v9/projects/<name>/domains (first
    //      non-preview, non-hash alias)
    //   3. targetDomain fallback (`<vercelProjectName>.vercel.app`)
    const deploymentId: string | undefined = deployJson?.id || deployJson?.uid;
    const customHost = normalizeHost((project as any).custom_domain);
    let prodAlias = customHost || targetDomain;

    // Vercel's actual project name can differ from what we requested
    // (name collisions add `-pi`, `-2` etc.). Read the deployment's real
    // project name and use that as the alias base.
    const teamIdFromDeploy: string | undefined = deployJson?.team?.id || deployJson?.ownerId;
    const realProjectName: string =
      deployJson?.name ||
      (typeof deployJson?.projectName === "string" ? deployJson.projectName : "") ||
      vercelProjectName;
    console.log("[deploy-vercel-direct] realProjectName:", realProjectName, "requested:", vercelProjectName);
    if (!customHost && realProjectName) {
      // Fallback base = `<realName>.vercel.app`. Will be refined below from
      // the deployment's own alias array once available.
      prodAlias = `${realProjectName.toLowerCase()}.vercel.app`;
    }

    // Wait for deployment READY and pull the stable alias from its `alias`
    // array (Vercel lists every alias pointing at this deployment; the shortest
    // `*.vercel.app` without the deployment hash is the production alias).
    if (deploymentId) {
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const qs = teamIdFromDeploy ? `?teamId=${encodeURIComponent(teamIdFromDeploy)}` : "";
          const statusRes = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}${qs}`, {
            headers: { Authorization: `Bearer ${vercelToken}` },
          });
          if (!statusRes.ok) continue;
          const statusJson = await statusRes.json().catch(() => null);
          const state = statusJson?.readyState || statusJson?.status;
          const aliases: string[] = Array.isArray(statusJson?.alias) ? statusJson.alias : [];
          if (!customHost && aliases.length) {
            // Pick the shortest `*.vercel.app` alias — that's the project-scoped
            // production alias (`<project>.vercel.app`) rather than the
            // deployment-scoped `<project>-<hash>-<team>.vercel.app`.
            const vercelAliases = aliases
              .map((a) => normalizeHost(a))
              .filter((a) => a.endsWith(".vercel.app"));
            if (vercelAliases.length) {
              vercelAliases.sort((a, b) => a.length - b.length);
              prodAlias = vercelAliases[0];
            }
          }
          console.log("[deploy-vercel-direct] poll", attempt, "state:", state, "alias:", prodAlias, "count:", aliases.length);
          if (state === "READY") break;
          if (state === "ERROR" || state === "CANCELED") break;
        } catch (e) {
          console.log("[deploy-vercel-direct] poll error:", (e as Error).message);
        }
      }
    }

    // If the real public host differs from the initially guessed host, rewrite
    // every generated artifact (sitemap.xml, robots.txt, canonical, og:url,
    // JSON-LD, rss, llms.txt) and deploy once more so the live site references
    // itself everywhere.
    if (prodAlias !== targetDomain) {
      files = replaceHostInFiles(files, targetDomain, prodAlias);
      const finalDeploy = await deployFiles(files);
      deployJson = finalDeploy.json;
      deployText = finalDeploy.text;
      console.log("[deploy-vercel-direct] final deploy status:", finalDeploy.res.status, "ok:", finalDeploy.res.ok);
      if (!finalDeploy.res.ok) {
        const err = deployJson?.error?.message || deployJson?.error?.code || deployText.slice(0, 400);
        return new Response(JSON.stringify({
          error: "vercel_deploy_failed",
          message: `Vercel final deployment failed: ${finalDeploy.res.status} ${err}`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // prodAlias is the stable project-scoped alias; do NOT overwrite it with
      // the deployment-scoped url from the final deployJson.
    }

    const publicUrl = `https://${prodAlias}`;
    const finalDeploymentUrl = normalizeHost(deployJson?.url) ? `https://${normalizeHost(deployJson?.url)}` : publicUrl;
    console.log("[deploy-vercel-direct] final publicUrl:", publicUrl, "deployment:", finalDeploymentUrl);

    // 3. Persist project state.
    await supabaseAdmin.from("projects").update({
      domain: prodAlias,
      hosting_platform: "vercel",
      last_deploy_at: new Date().toISOString(),
      last_ping_status: "online",
      last_ping_at: new Date().toISOString(),
    }).eq("id", projectId);

    void logCost(supabaseAdmin, {
      project_id: projectId,
      user_id: user.id,
      operation_type: "vercel_deploy",
      model: "vercel-direct",
      cost_usd: 0,
      metadata: { url: publicUrl, files: fileCount, token_source: tokenInfo.source },
    });

    return new Response(JSON.stringify({
      success: true,
      url: publicUrl,
      deployment_url: finalDeploymentUrl,
      project_name: vercelProjectName,
      files: fileCount,
      token_source: tokenInfo.source,
      message: `Vercel Direct Upload deployed: ${publicUrl}`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[deploy-vercel-direct] ERROR:", err?.message, err?.stack);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});