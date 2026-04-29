// Cloudflare Pages Direct Upload deployment
// Replaces the GitHub-based deploy-cloudflare flow for site-grid generation.
// Reverse-engineered wrangler flow:
//  1. Create empty Pages project (no source.type) -> "Direct Upload" mode
//  2. GET /pages/projects/{name}/upload-token -> JWT
//  3. POST /pages/assets/check-missing { hashes }   (with JWT)
//  4. POST /pages/assets/upload  [{key, value(base64), metadata}]   (with JWT)
//  5. POST /pages/assets/upsert-hashes { hashes }  (with JWT)
//  6. POST /accounts/{id}/pages/projects/{name}/deployments multipart with manifest = {path: hash}

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hash as blake3 } from "npm:blake3-wasm@2.1.5";
import { renderTemplate } from "./templates.ts";
import { ACCENT_COLORS, FONT_PAIRS, pickRandom, type TemplateType } from "./styles.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATES: TemplateType[] = ["minimal", "magazine", "news", "landing"];

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".xml":  "application/xml; charset=utf-8",
  ".txt":  "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
function mimeOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return MIME[path.slice(dot).toLowerCase()] || "application/octet-stream";
}
function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}

function transliterate(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "j",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
    ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return text.toLowerCase().split("").map((c) => map[c] ?? c).join("");
}
function sanitizeProjectName(name: string): string {
  return transliterate(name)
    .replace(/[^a-z0-9\s-]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .substring(0, 50) || "site";
}

// Wrangler hash: blake3(base64(content) + extension).slice(0, 32)
function hashFile(content: string, path: string): string {
  const bytes = new TextEncoder().encode(content);
  // base64 encode
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const ext = extOf(path);
  const input = new TextEncoder().encode(b64 + ext);
  const out = blake3(input); // Uint8Array
  return Array.from(out).map((b: number) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function toBase64(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function tryParseJson(res: Response): Promise<{ ok: boolean; data: any; status: number; text: string }> {
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  return { ok: res.ok, data, status: res.status, text };
}

function cfErr(payload: any, fallback: string, status: number): string {
  if (payload?.errors?.length) return payload.errors.map((e: any) => e.message).join("; ");
  if (payload?.message) return String(payload.message);
  return fallback.trim() || `HTTP ${status}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const projectId: string = body.project_id;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing project_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Allow caller to override; otherwise pick randomly
    const template: TemplateType = TEMPLATES.includes(body.template) ? body.template : pickRandom(TEMPLATES);
    const accent: string = body.accent_color || pickRandom(ACCENT_COLORS);
    const fontPair: [string, string] = Array.isArray(body.font_pair) && body.font_pair.length === 2
      ? body.font_pair
      : pickRandom(FONT_PAIRS[template]);

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("name, domain, custom_domain, site_name, site_about, hosting_platform")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();
    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const topic: string = body.topic || project.site_about || project.name || "блог";
    const siteName: string = body.site_name || project.site_name || project.name || "Сайт";
    const siteAbout: string = body.site_about || project.site_about || `Блог про ${topic}`;

    // Cloudflare credentials
    const { data: apiKeys } = await supabaseAdmin
      .from("api_keys")
      .select("provider, api_key")
      .in("provider", ["cloudflare_account_id", "cloudflare_api_token"]);
    const keyMap = Object.fromEntries((apiKeys || []).map((k: any) => [k.provider, k.api_key]));
    const accountId = keyMap["cloudflare_account_id"];
    const apiToken = keyMap["cloudflare_api_token"];
    if (!accountId || !apiToken) {
      return new Response(JSON.stringify({
        error: "Cloudflare credentials not configured. Add cloudflare_account_id and cloudflare_api_token in Admin.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const cfHeadersJson = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };
    const cfBaseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;

    // 1. Create or reuse Direct Upload project (no source = direct upload mode)
    const baseName = sanitizeProjectName(siteName);
    const idShort = projectId.replace(/-/g, "");
    const candidates = [baseName, `${baseName}-${idShort.slice(0, 6)}`, `${baseName}-${idShort.slice(0, 12)}`];
    let cfProjectName = "";
    let lastErr = "";

    // First check if a project already exists (resolved domain)
    const existingHost = (project.domain || "").replace(/^https?:\/\//, "").split("/")[0];
    const existingMatch = existingHost.match(/^([a-z0-9-]+)\.pages\.dev$/i);
    if (existingMatch) {
      const checkRes = await fetch(`${cfBaseUrl}/${existingMatch[1]}`, { headers: cfHeadersJson });
      if (checkRes.ok) cfProjectName = existingMatch[1];
    }

    if (!cfProjectName) {
      for (const candidate of candidates) {
        console.log(`[direct] creating project ${candidate}`);
        const createRes = await fetch(cfBaseUrl, {
          method: "POST",
          headers: cfHeadersJson,
          body: JSON.stringify({
            name: candidate,
            production_branch: "main",
          }),
        });
        const parsed = await tryParseJson(createRes);
        if (parsed.ok) { cfProjectName = candidate; break; }
        const msg = cfErr(parsed.data, parsed.text, parsed.status);
        lastErr = msg;
        const isConflict = parsed.status === 409 || /already (exists|been taken)/i.test(msg);
        if (!isConflict) {
          return new Response(JSON.stringify({ error: `Cloudflare create failed: ${msg}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      if (!cfProjectName) {
        return new Response(JSON.stringify({ error: "name_conflict", message: lastErr, tried: candidates }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const pagesDevUrl = `https://${cfProjectName}.pages.dev`;
    const domain = `${cfProjectName}.pages.dev`;

    // 2. Render files
    const files = renderTemplate({
      siteName, siteAbout, topic,
      accent, headingFont: fontPair[0], bodyFont: fontPair[1],
      template, domain,
    });

    // 3. Compute manifest { "/path": hash }
    const manifest: Record<string, string> = {};
    const fileByHash: Record<string, { path: string; content: string }> = {};
    for (const [path, content] of Object.entries(files)) {
      const h = hashFile(content, path);
      manifest[`/${path}`] = h;
      fileByHash[h] = { path, content };
    }

    // 4. Get upload JWT
    const tokenRes = await fetch(`${cfBaseUrl}/${cfProjectName}/upload-token`, { headers: cfHeadersJson });
    const tokenParsed = await tryParseJson(tokenRes);
    if (!tokenParsed.ok || !tokenParsed.data?.result?.jwt) {
      return new Response(JSON.stringify({
        error: `upload-token failed: ${cfErr(tokenParsed.data, tokenParsed.text, tokenParsed.status)}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const jwt: string = tokenParsed.data.result.jwt;
    const assetsHeaders = { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };

    // 5. check-missing
    const allHashes = Object.values(manifest);
    const checkRes = await fetch("https://api.cloudflare.com/client/v4/pages/assets/check-missing", {
      method: "POST",
      headers: assetsHeaders,
      body: JSON.stringify({ hashes: allHashes }),
    });
    const checkParsed = await tryParseJson(checkRes);
    if (!checkParsed.ok) {
      return new Response(JSON.stringify({
        error: `check-missing failed: ${cfErr(checkParsed.data, checkParsed.text, checkParsed.status)}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const missing: string[] = checkParsed.data?.result || allHashes;

    // 6. upload missing files
    if (missing.length > 0) {
      const payload = missing.map((h) => {
        const f = fileByHash[h];
        return {
          key: h,
          value: toBase64(f.content),
          metadata: { contentType: mimeOf(f.path) },
          base64: true,
        };
      });
      const upRes = await fetch("https://api.cloudflare.com/client/v4/pages/assets/upload", {
        method: "POST",
        headers: assetsHeaders,
        body: JSON.stringify(payload),
      });
      const upParsed = await tryParseJson(upRes);
      if (!upParsed.ok) {
        return new Response(JSON.stringify({
          error: `assets/upload failed: ${cfErr(upParsed.data, upParsed.text, upParsed.status)}`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // 7. upsert-hashes (registers all hashes for this deployment)
    const upsertRes = await fetch("https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes", {
      method: "POST",
      headers: assetsHeaders,
      body: JSON.stringify({ hashes: allHashes }),
    });
    const upsertParsed = await tryParseJson(upsertRes);
    if (!upsertParsed.ok) {
      console.warn("[direct] upsert-hashes failed (continuing):", cfErr(upsertParsed.data, upsertParsed.text, upsertParsed.status));
    }

    // 8. Create deployment
    const fd = new FormData();
    fd.append("manifest", JSON.stringify(manifest));
    fd.append("branch", "main");

    const deployRes = await fetch(`${cfBaseUrl}/${cfProjectName}/deployments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` }, // let runtime set multipart boundary
      body: fd,
    });
    const deployParsed = await tryParseJson(deployRes);
    if (!deployParsed.ok) {
      return new Response(JSON.stringify({
        error: `deployments failed: ${cfErr(deployParsed.data, deployParsed.text, deployParsed.status)}`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 9. Persist project state
    await supabase.from("projects").update({
      domain,
      hosting_platform: "cloudflare",
      template_type: template,
      accent_color: accent,
      template_font_pair: `${fontPair[0]}|${fontPair[1]}`,
    }).eq("id", projectId);

    return new Response(JSON.stringify({
      success: true,
      project_name: cfProjectName,
      url: pagesDevUrl,
      template, accent_color: accent, font_pair: fontPair,
      deploy_id: deployParsed.data?.result?.id || null,
      message: `Direct Upload deployed: ${pagesDevUrl}`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[deploy-cloudflare-direct] error:", err);
    return new Response(JSON.stringify({ error: "Internal error", details: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});