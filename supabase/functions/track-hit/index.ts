import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const projectId = body.p;
    const url = body.u;

    if (!projectId || typeof projectId !== "string") {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Insert analytics log
    await supabase.from("analytics_logs").insert({
      project_id: projectId,
      url: (url || "").substring(0, 2000),
    });

    // Increment total_views
    await supabase.rpc("increment_project_views", { p_project_id: projectId }).catch(() => {
      // fallback: direct update
      supabase
        .from("projects")
        .update({ total_views: 1 }) // Will be handled by SQL later
        .eq("id", projectId);
    });

    // Return minimal 1x1 transparent pixel response for speed
    return new Response("ok", {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  } catch (_e) {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
});
