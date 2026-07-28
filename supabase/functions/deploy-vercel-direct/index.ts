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
      .select("id, name, user_id, vercel_token, domain")
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
    const files: Record<string, string> = buildJson.files;
    const fileCount = Object.keys(files).length;
    console.log("[deploy-vercel-direct] files built:", fileCount);

    // 2. Assemble Vercel deployment payload (inline base64 files).
    const vercelFiles = Object.entries(files).map(([path, content]) => ({
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

    const deployRes = await fetch(`${VERCEL_API}/v13/deployments?forceNew=1`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deployPayload),
    });
    const deployText = await deployRes.text();
    let deployJson: any = null;
    try { deployJson = JSON.parse(deployText); } catch { /* ignore */ }
    console.log("[deploy-vercel-direct] deploy status:", deployRes.status, "ok:", deployRes.ok);
    if (!deployRes.ok) {
      const err = deployJson?.error?.message || deployJson?.error?.code || deployText.slice(0, 400);
      return new Response(JSON.stringify({
        error: "vercel_deploy_failed",
        message: `Vercel deployment failed: ${deployRes.status} ${err}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Vercel returns { url: "<deploymentId>-<hash>.vercel.app", alias: [...] }
    const aliases: string[] = Array.isArray(deployJson?.alias) ? deployJson.alias : [];
    const prodAlias = aliases.find((a) => a === targetDomain)
      || aliases.find((a) => typeof a === "string" && a.endsWith(".vercel.app"))
      || targetDomain;
    const deploymentUrl: string = deployJson?.url ? `https://${deployJson.url}` : `https://${prodAlias}`;
    const publicUrl = `https://${prodAlias}`;

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
      deployment_url: deploymentUrl,
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