import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
    const payloadB64 = authHeader.replace("Bearer ", "").split(".")[1];
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload.sub;
    if (!userId) throw new Error("Unauthorized");

    const { article_id, keyword, target_url, geo, language } = await req.json();
    if (!article_id || !keyword || !target_url) {
      return new Response(JSON.stringify({ error: "article_id, keyword, target_url required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: serperKey } = await admin.from("api_keys").select("api_key").eq("provider", "serper").single();
    if (!serperKey?.api_key) throw new Error("Serper API key not configured");

    const r = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": serperKey.api_key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: keyword, gl: geo || "ru", hl: language || "ru", num: 100 }),
    });
    if (!r.ok) throw new Error(`Serper ${r.status}`);
    const data = await r.json();

    const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").toLowerCase();
    const target = norm(target_url);
    let position: number | null = null;
    let foundUrl: string | null = null;
    for (const item of data.organic || []) {
      if (norm(item.link).includes(target) || target.includes(norm(item.link))) {
        position = item.position;
        foundUrl = item.link;
        break;
      }
    }

    await admin.from("serp_positions").insert({
      user_id: userId,
      article_id,
      keyword,
      position,
      url: foundUrl,
      search_engine: "google",
      region: geo || "ru",
    });

    return new Response(JSON.stringify({ position, url: foundUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});