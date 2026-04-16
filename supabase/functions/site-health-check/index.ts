import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Decode user from JWT
    let userId: string | null = null;
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        userId = payload.sub;
      }
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    // Get user's projects with domains
    const { data: projects, error } = await supabase
      .from("projects")
      .select("id, domain, name, hosting_platform, language")
      .eq("user_id", userId);

    if (error) throw error;

    const results: Array<{
      id: string;
      domain: string;
      name: string;
      status: string;
      statusCode: number | null;
      responseTime: number | null;
    }> = [];

    for (const project of projects || []) {
      if (!project.domain) {
        results.push({ id: project.id, domain: "", name: project.name, status: "unknown", statusCode: null, responseTime: null });
        continue;
      }

      const url = project.domain.startsWith("http") ? project.domain : `https://${project.domain}`;
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const resp = await fetch(url, {
          method: "HEAD",
          signal: controller.signal,
          redirect: "follow",
        });
        clearTimeout(timeout);
        const elapsed = Date.now() - start;
        const status = resp.status >= 200 && resp.status < 400 ? "online" : "offline";

        results.push({
          id: project.id,
          domain: project.domain,
          name: project.name,
          status,
          statusCode: resp.status,
          responseTime: elapsed,
        });

        // Update project ping status
        await supabase
          .from("projects")
          .update({ last_ping_status: status, last_ping_at: new Date().toISOString() })
          .eq("id", project.id);

      } catch (_e) {
        results.push({
          id: project.id,
          domain: project.domain,
          name: project.name,
          status: "offline",
          statusCode: null,
          responseTime: null,
        });

        await supabase
          .from("projects")
          .update({ last_ping_status: "offline", last_ping_at: new Date().toISOString() })
          .eq("id", project.id);
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
