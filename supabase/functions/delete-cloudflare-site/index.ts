// Delete a Cloudflare Pages project + remove related rows from Supabase.
// Body: { project_id: string }  -> { success, deleted_cf, project_name, articles_deleted }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extractCfProjectName(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const host = String(domain).replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
  const m = host.match(/^([a-z0-9-]+)\.pages\.dev$/i);
  return m ? m[1] : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    console.log("[delete-cloudflare-site] started");
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const projectId: string = body.project_id;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing project_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load project (must belong to caller, OR caller is admin).
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, user_id, name, domain, hosting_platform")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr) {
      console.error("[delete-cloudflare-site] project lookup error:", projErr.message);
    }
    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found or access denied" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log("[delete-cloudflare-site] project:", project.id, "domain:", project.domain);

    // Best-effort: try to delete on Cloudflare. We never block the DB cleanup if CF fails.
    let deletedCf = false;
    let cfMessage = "";
    let cfProjectName = extractCfProjectName(project.domain) ||
      (typeof body.cf_project_name === "string" ? body.cf_project_name : null);

    if ((project.hosting_platform || "").toLowerCase() === "cloudflare" || cfProjectName) {
      const { data: apiKeys } = await supabaseAdmin
        .from("api_keys")
        .select("provider, api_key")
        .in("provider", ["cloudflare_account_id", "cloudflare_api_token"]);
      const keyMap = Object.fromEntries((apiKeys || []).map((k: any) => [k.provider, k.api_key]));
      const accountId = keyMap["cloudflare_account_id"];
      const apiToken = keyMap["cloudflare_api_token"];

      if (!accountId || !apiToken) {
        cfMessage = "Cloudflare credentials not configured; skipped CF delete.";
        console.warn("[delete-cloudflare-site]", cfMessage);
      } else if (!cfProjectName) {
        cfMessage = "Could not determine CF project name from domain; skipped CF delete.";
        console.warn("[delete-cloudflare-site]", cfMessage);
      } else {
        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${cfProjectName}`;
        try {
          const res = await fetch(url, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${apiToken}` },
          });
          const text = await res.text();
          console.log("[delete-cloudflare-site] CF DELETE", cfProjectName, "->", res.status, text.slice(0, 200));
          if (res.ok) {
            deletedCf = true;
          } else if (res.status === 404) {
            // Already gone — treat as success.
            deletedCf = true;
            cfMessage = "CF project not found (already deleted).";
          } else {
            cfMessage = `CF delete failed: HTTP ${res.status} ${text.slice(0, 300)}`;
          }
        } catch (e: any) {
          cfMessage = `CF delete error: ${e?.message || String(e)}`;
          console.error("[delete-cloudflare-site]", cfMessage);
        }
      }
    }

    // Delete articles linked to this project (caller-scoped via RLS).
    const { data: deletedArticles, error: artErr } = await supabase
      .from("articles")
      .delete()
      .eq("project_id", projectId)
      .select("id");
    if (artErr) {
      console.error("[delete-cloudflare-site] articles delete error:", artErr.message);
    }
    const articlesDeleted = deletedArticles?.length ?? 0;
    console.log("[delete-cloudflare-site] articles deleted:", articlesDeleted);

    // Delete the project row itself.
    const { error: delErr } = await supabase
      .from("projects")
      .delete()
      .eq("id", projectId);
    if (delErr) {
      console.error("[delete-cloudflare-site] project delete error:", delErr.message);
      return new Response(JSON.stringify({
        error: "Failed to delete project from database",
        message: delErr.message,
        deleted_cf: deletedCf,
        cf_message: cfMessage,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      success: true,
      deleted_cf: deletedCf,
      project_name: cfProjectName,
      articles_deleted: articlesDeleted,
      cf_message: cfMessage || undefined,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[delete-cloudflare-site] ERROR:", err?.message, err?.stack);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});