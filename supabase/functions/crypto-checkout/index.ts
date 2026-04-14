import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "https://deno.land/std@0.119.0/hash/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLAN_PRICES: Record<string, { amount: number; credits: number }> = {
  free: { amount: 19, credits: 5 },
  basic: { amount: 79, credits: 40 },
  pro: { amount: 249, credits: 150 },
};

function md5(input: string): string {
  const hash = createHash("md5");
  hash.update(input);
  return hash.toString("hex");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { plan } = body;

    if (!plan || !PLAN_PRICES[plan]) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch Cryptomus credentials from app_settings
    const adminDb = createClient(supabaseUrl, serviceKey);
    const { data: settingsData } = await adminDb
      .from("app_settings")
      .select("key, value")
      .in("key", ["cryptomus_merchant_id", "cryptomus_api_key"]);

    const settingsMap: Record<string, string> = {};
    (settingsData ?? []).forEach((s: { key: string; value: string }) => {
      settingsMap[s.key] = s.value;
    });

    const merchantId = settingsMap["cryptomus_merchant_id"];
    const apiKey = settingsMap["cryptomus_api_key"];

    if (!merchantId || !apiKey) {
      return new Response(JSON.stringify({ error: "Cryptomus not configured. Admin must add credentials in settings." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { amount, credits } = PLAN_PRICES[plan];
    const orderId = `crypto_${plan}_${user.id}_${Date.now()}`;

    const paymentData: Record<string, string> = {
      amount: amount.toString(),
      currency: "USD",
      order_id: orderId,
      url_callback: `${supabaseUrl}/functions/v1/crypto-webhook`,
      url_return: `${req.headers.get("origin") || "https://seo-modul.pro"}/payment-success?source=crypto`,
      is_payment_multiple: "false",
      additional_data: JSON.stringify({ user_id: user.id, plan, credits }),
    };

    // Cryptomus signing: base64(JSON) + apiKey → MD5
    const jsonBase64 = btoa(JSON.stringify(paymentData));
    const sign = md5(jsonBase64 + apiKey);

    console.log(`Creating Cryptomus payment: plan=${plan}, amount=${amount}, orderId=${orderId}`);

    const cryptoRes = await fetch("https://api.cryptomus.com/v1/payment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        merchant: merchantId,
        sign: sign,
      },
      body: JSON.stringify(paymentData),
    });

    if (!cryptoRes.ok) {
      const errText = await cryptoRes.text();
      console.error("Cryptomus API error:", errText);
      return new Response(JSON.stringify({ error: "Failed to create crypto payment" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await cryptoRes.json();
    console.log("Cryptomus response:", JSON.stringify(result));

    return new Response(JSON.stringify({ url: result.result?.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("crypto-checkout error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
