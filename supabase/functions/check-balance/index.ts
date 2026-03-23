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

    const token = authHeader.replace("Bearer ", "");
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) throw new Error("Unauthorized");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload.sub as string;
    if (!userId) throw new Error("Unauthorized");

    // Check admin role
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .single();
    if (!role) throw new Error("Unauthorized: admin only");

    // Get API keys from DB
    const { data: keys } = await supabaseAdmin
      .from("api_keys")
      .select("provider, api_key")
      .eq("is_valid", true);

    // Also check env for OpenRouter key (edge functions use env as fallback)
    const dbProviders = new Set((keys || []).map((k: any) => k.provider));
    const allKeys: { provider: string; api_key: string }[] = [...(keys || [])];

    if (!dbProviders.has("openrouter")) {
      const envKey = Deno.env.get("OPENROUTER_API_KEY");
      if (envKey) allKeys.push({ provider: "openrouter", api_key: envKey });
    }

    const balances: Record<string, { balance: string; limit: string; usage: string; raw?: any }> = {};

    for (const key of allKeys) {
      try {
        if (key.provider === "openrouter") {
          const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
            headers: { Authorization: `Bearer ${key.api_key}` },
          });
          if (res.ok) {
            const data = await res.json();
            const d = data.data;
            const limit = d.limit ?? null;
            const usage = d.usage ?? 0;
            const remaining = limit !== null ? (limit - usage) : null;
            balances["openrouter"] = {
              balance: remaining !== null ? `$${remaining.toFixed(2)}` : "Unlimited",
              limit: limit !== null ? `$${limit.toFixed(2)}` : "No limit",
              usage: `$${usage.toFixed(2)}`,
              raw: d,
            };
          } else {
            const errText = await res.text();
            console.error("OpenRouter balance check failed:", res.status, errText);
            balances["openrouter"] = { balance: "Error", limit: "—", usage: "—" };
          }
        }

        if (key.provider === "fal_ai") {
          balances["fal_ai"] = {
            balance: "N/A",
            limit: "N/A",
            usage: "Проверьте на fal.ai",
          };
        }
      } catch (e) {
        console.error(`Balance check failed for ${key.provider}:`, e);
        balances[key.provider] = {
          balance: "Error",
          limit: "—",
          usage: "—",
        };
      }
    }

    return new Response(JSON.stringify({ balances }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
