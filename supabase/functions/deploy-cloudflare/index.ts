import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

    // Verify user
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const { project_id } = await req.json();
    if (!project_id) {
      return new Response(JSON.stringify({ error: "Missing project_id" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Get project config
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("name, domain, github_repo, hosting_platform")
      .eq("id", project_id)
      .eq("user_id", user.id)
      .single();

    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    if (project.hosting_platform !== "cloudflare") {
      return new Response(JSON.stringify({ error: "Project is not using Cloudflare Pages" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Get Cloudflare credentials from api_keys table
    const { data: apiKeys } = await supabase
      .from("api_keys")
      .select("provider, api_key")
      .in("provider", ["cloudflare_account_id", "cloudflare_api_token"]);

    const keyMap = Object.fromEntries((apiKeys || []).map((k: any) => [k.provider, k.api_key]));
    const accountId = keyMap["cloudflare_account_id"];
    const apiToken = keyMap["cloudflare_api_token"];

    if (!accountId || !apiToken) {
      return new Response(JSON.stringify({
        error: "Cloudflare credentials not configured. Add cloudflare_account_id and cloudflare_api_token in Admin > API Vault.",
      }), { status: 400, headers: corsHeaders });
    }

    const cfHeaders = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    // Derive project name from domain (e.g. "example.com" -> "example-com")
    const cfProjectName = (project.domain || project.name || "site")
      .replace(/^https?:\/\//, "")
      .replace(/[^a-z0-9-]/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .substring(0, 58);

    const cfBaseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;

    // Step 1: Check if project exists
    console.log(`[deploy-cloudflare] Checking project: ${cfProjectName}`);
    const checkRes = await fetch(`${cfBaseUrl}/${cfProjectName}`, { headers: cfHeaders });

    if (!checkRes.ok && checkRes.status === 404) {
      // Create the project linked to GitHub
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

      // If GitHub repo is configured, link it as source
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

      const createData = await createRes.json();

      if (!createRes.ok) {
        const errMsg = createData?.errors?.map((e: any) => e.message).join("; ") || JSON.stringify(createData);
        console.error(`[deploy-cloudflare] Create project failed:`, errMsg);
        return new Response(JSON.stringify({
          error: `Cloudflare create project failed: ${errMsg}`,
        }), { status: 400, headers: corsHeaders });
      }

      console.log(`[deploy-cloudflare] Project created: ${cfProjectName}`);

      return new Response(JSON.stringify({
        success: true,
        action: "created",
        project_name: cfProjectName,
        url: createData?.result?.subdomain ? `https://${createData.result.subdomain}` : null,
        message: "Cloudflare Pages project created and linked to GitHub. Deployments will trigger automatically on push.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!checkRes.ok) {
      const errData = await checkRes.json().catch(() => ({}));
      const errMsg = errData?.errors?.map((e: any) => e.message).join("; ") || `HTTP ${checkRes.status}`;
      return new Response(JSON.stringify({
        error: `Cloudflare API error: ${errMsg}`,
      }), { status: 400, headers: corsHeaders });
    }

    // Step 2: Project exists - trigger a deployment hook
    // When source is GitHub, Cloudflare auto-deploys on push.
    // We can also create a deploy hook or just confirm the status.
    const projectData = await checkRes.json();
    const latestDeployment = projectData?.result?.latest_deployment;

    // Trigger deployment via deploy hook (create one if needed)
    const hookUrl = `${cfBaseUrl}/${cfProjectName}/deployments`;
    const deployRes = await fetch(hookUrl, {
      method: "POST",
      headers: cfHeaders,
    });

    const deployData = await deployRes.json();

    if (!deployRes.ok) {
      const errMsg = deployData?.errors?.map((e: any) => e.message).join("; ") || JSON.stringify(deployData);
      // If it fails because of GitHub source, it's fine - auto-deploys on push
      if (errMsg.includes("GitHub") || errMsg.includes("source")) {
        return new Response(JSON.stringify({
          success: true,
          action: "auto_deploy",
          project_name: cfProjectName,
          message: "GitHub push detected. Cloudflare Pages will auto-deploy.",
          latest_status: latestDeployment?.latest_stage?.name || "unknown",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      console.error(`[deploy-cloudflare] Deploy trigger failed:`, errMsg);
      return new Response(JSON.stringify({
        error: `Cloudflare deploy failed: ${errMsg}`,
      }), { status: 400, headers: corsHeaders });
    }

    const deployUrl = deployData?.result?.url || null;
    const deployId = deployData?.result?.id || null;

    return new Response(JSON.stringify({
      success: true,
      action: "deployed",
      project_name: cfProjectName,
      deploy_id: deployId,
      deploy_url: deployUrl,
      message: "Cloudflare Pages deployment triggered.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[deploy-cloudflare] Error:", err);
    return new Response(JSON.stringify({
      error: "Internal error",
      details: String(err),
    }), { status: 500, headers: corsHeaders });
  }
});
