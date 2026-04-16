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

  return text
    .toLowerCase()
    .split("")
    .map((c) => map[c] ?? c)
    .join("");
}

function sanitizeProjectName(name: string): string {
  return transliterate(name)
    .replace(/[^a-z0-9\s-]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .substring(0, 58) || "site";
}

function normalizeHost(value: string | null | undefined): string {
  return (value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function extractPagesProjectName(
  domain: string | null | undefined,
  customDomain: string | null | undefined,
  fallbackName: string,
): string {
  const candidates = [domain, customDomain];

  for (const candidate of candidates) {
    const host = normalizeHost(candidate);
    const match = host.match(/^([a-z0-9-]+)\.pages\.dev$/i);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }

  return sanitizeProjectName(fallbackName);
}

function parseJsonSafely(text: string): any | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const cleaned = trimmed
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[\x00-\x1F\x7F]/g, "");

    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

async function readResponsePayload(response: Response): Promise<{ data: any | null; text: string }> {
  const text = await response.text();
  return {
    text,
    data: parseJsonSafely(text),
  };
}

function getCloudflareErrorMessage(payload: any | null, fallbackText: string, status: number): string {
  if (payload?.errors?.length) {
    return payload.errors.map((e: any) => e.message).join("; ");
  }

  if (payload?.message) {
    return String(payload.message);
  }

  if (fallbackText.trim()) {
    return fallbackText.trim();
  }

  return `HTTP ${status}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: corsHeaders,
      });
    }

    const { project_id } = await req.json();
    if (!project_id) {
      return new Response(JSON.stringify({ error: "Missing project_id" }), {
        status: 400, headers: corsHeaders,
      });
    }

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("name, domain, custom_domain, github_repo, hosting_platform")
      .eq("id", project_id)
      .eq("user_id", user.id)
      .single();

    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: corsHeaders,
      });
    }

    if (project.hosting_platform !== "cloudflare") {
      return new Response(JSON.stringify({ error: "Project is not using Cloudflare Pages" }), {
        status: 400, headers: corsHeaders,
      });
    }

    const { data: apiKeys } = await supabase
      .from("api_keys")
      .select("provider, api_key")
      .in("provider", ["cloudflare_account_id", "cloudflare_api_token"]);

    const keyMap = Object.fromEntries((apiKeys || []).map((k: any) => [k.provider, k.api_key]));
    const accountId = keyMap["cloudflare_account_id"];
    const apiToken = keyMap["cloudflare_api_token"];

    if (!accountId || !apiToken) {
      return new Response(JSON.stringify({
        error: "Cloudflare credentials not configured. Add cloudflare_account_id and cloudflare_api_token in Admin > GitHub > Hosting Keys.",
      }), { status: 400, headers: corsHeaders });
    }

    const cfHeaders = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    const cfProjectName = extractPagesProjectName(
      project.domain,
      project.custom_domain,
      project.name || "site",
    );

    if (!cfProjectName) {
      return new Response(JSON.stringify({ error: "Invalid project name. Update the project name in settings." }), {
        status: 400, headers: corsHeaders,
      });
    }

    const pagesDevUrl = `https://${cfProjectName}.pages.dev`;
    const cfBaseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;

    console.log(`[deploy-cloudflare] Checking project: ${cfProjectName}`);
    const checkRes = await fetch(`${cfBaseUrl}/${cfProjectName}`, { headers: cfHeaders });

    if (!checkRes.ok && checkRes.status === 404) {
      console.log(`[deploy-cloudflare] Creating project: ${cfProjectName}`);

      const ghRepo = project.github_repo || "";
      const [ghOwner, ghRepoName] = ghRepo.includes("/") ? ghRepo.split("/") : ["", ghRepo];

      const createBody: Record<string, any> = {
        name: cfProjectName,
        production_branch: "main",
        build_config: {
          build_command: "npm run build",
          destination_dir: "dist",
          root_dir: "/",
        },
      };

      if (ghOwner && ghRepoName) {
        createBody.source = {
          type: "github",
          config: {
            owner: ghOwner,
            repo_name: ghRepoName,
            production_branch: "main",
            deployments_enabled: true,
          },
        };
      }

      const createRes = await fetch(cfBaseUrl, {
        method: "POST",
        headers: cfHeaders,
        body: JSON.stringify(createBody),
      });

      const { data: createData, text: createText } = await readResponsePayload(createRes);

      if (!createRes.ok) {
        const errMsg = getCloudflareErrorMessage(createData, createText, createRes.status);
        console.error(`[deploy-cloudflare] Create project failed:`, errMsg);

        if (errMsg.includes("already exists") || errMsg.includes("already been taken") || createRes.status === 409) {
          return new Response(JSON.stringify({
            error: "name_conflict",
            message: `Project name "${cfProjectName}" is already taken on Cloudflare. Please change the project name in settings.`,
            project_name: cfProjectName,
          }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        return new Response(JSON.stringify({
          error: `Cloudflare create project failed: ${errMsg}`,
        }), { status: 400, headers: corsHeaders });
      }

      console.log(`[deploy-cloudflare] Project created: ${cfProjectName}`);

      return new Response(JSON.stringify({
        success: true,
        action: "created",
        project_name: cfProjectName,
        url: pagesDevUrl,
        message: `Cloudflare Pages project created. Site: ${pagesDevUrl}`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!checkRes.ok) {
      const { data: errData, text: errText } = await readResponsePayload(checkRes);
      const errMsg = getCloudflareErrorMessage(errData, errText, checkRes.status);
      return new Response(JSON.stringify({
        error: `Cloudflare API error: ${errMsg}`,
      }), { status: 400, headers: corsHeaders });
    }

    const hookUrl = `${cfBaseUrl}/${cfProjectName}/deployments`;
    const deployRes = await fetch(hookUrl, {
      method: "POST",
      headers: cfHeaders,
    });

    const { data: deployData, text: deployText } = await readResponsePayload(deployRes);

    if (!deployRes.ok) {
      const errMsg = getCloudflareErrorMessage(deployData, deployText, deployRes.status);
      if (errMsg.includes("GitHub") || errMsg.includes("source")) {
        return new Response(JSON.stringify({
          success: true,
          action: "auto_deploy",
          project_name: cfProjectName,
          url: pagesDevUrl,
          message: `GitHub auto-deploy triggered. Site: ${pagesDevUrl}`,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      console.error(`[deploy-cloudflare] Deploy trigger failed:`, errMsg);
      return new Response(JSON.stringify({
        error: `Cloudflare deploy failed: ${errMsg}`,
      }), { status: 400, headers: corsHeaders });
    }

    return new Response(JSON.stringify({
      success: true,
      action: "deployed",
      project_name: cfProjectName,
      url: pagesDevUrl,
      deploy_id: deployData?.result?.id || null,
      deploy_url: deployData?.result?.url || pagesDevUrl,
      message: `Cloudflare Pages deployment triggered. Site: ${pagesDevUrl}`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[deploy-cloudflare] Error:", err);
    return new Response(JSON.stringify({
      error: "Internal error",
      details: String(err),
    }), { status: 500, headers: corsHeaders });
  }
});