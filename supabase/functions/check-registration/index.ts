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
    const { email, client_ip } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(
        JSON.stringify({ allowed: false, reason: "Invalid email" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prefer client-detected IP, fallback to headers
    let ip = (client_ip && client_ip !== "unknown") ? client_ip : "unknown";
    if (ip === "unknown") {
      ip =
        req.headers.get("cf-connecting-ip") ||
        req.headers.get("true-client-ip") ||
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown";
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Check accounts with this email (Supabase Auth handles exact duplicates,
    // but we also check for "+" alias tricks like user+1@gmail.com)
    const baseEmail = email.split("@")[0].replace(/\+.*$/, "").toLowerCase();
    const domain = email.split("@")[1]?.toLowerCase();

    const { data: emailProfiles, error: emailErr } = await supabase
      .from("profiles")
      .select("id, email")
      .not("email", "is", null);

    if (emailErr) throw emailErr;

    // Count profiles with same base email (ignoring + aliases)
    const sameEmailCount = (emailProfiles || []).filter((p) => {
      if (!p.email) return false;
      const pBase = p.email.split("@")[0].replace(/\+.*$/, "").toLowerCase();
      const pDomain = p.email.split("@")[1]?.toLowerCase();
      return pBase === baseEmail && pDomain === domain;
    }).length;

    if (sameEmailCount >= 2) {
      return new Response(
        JSON.stringify({
          allowed: false,
          reason: "Превышен лимит аккаунтов на один email (максимум 2)",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check accounts from this IP
    if (ip !== "unknown") {
      const { count, error: ipErr } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("registration_ip", ip);

      if (ipErr) throw ipErr;

      if ((count ?? 0) >= 2) {
        return new Response(
          JSON.stringify({
            allowed: false,
            reason: "Превышен лимит регистраций с одного IP адреса (максимум 2)",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ allowed: true, ip }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ allowed: false, reason: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
