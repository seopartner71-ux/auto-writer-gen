import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const payloadBase64 = token.split(".")[1];
    const payload = JSON.parse(atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload.sub;

    if (!userId) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to get IP from request body (client-side detected) or headers
    let clientIp = "unknown";
    try {
      const body = await req.json();
      if (body?.client_ip && body.client_ip !== "unknown") {
        clientIp = body.client_ip;
      }
    } catch { /* no body */ }

    if (clientIp === "unknown") {
      const cfIp = req.headers.get("cf-connecting-ip");
      const trueClientIp = req.headers.get("true-client-ip");
      const xff = req.headers.get("x-forwarded-for");
      clientIp = cfIp || trueClientIp || (xff ? xff.split(",")[0].trim() : "unknown");
    }

    console.log("Resolved IP:", clientIp);

    const ip = clientIp;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    await supabase
      .from("profiles")
      .update({ last_ip: ip, last_login_at: new Date().toISOString() })
      .eq("id", userId);

    return new Response(JSON.stringify({ ok: true, ip }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
