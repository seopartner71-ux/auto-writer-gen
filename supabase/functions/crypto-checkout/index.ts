import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLAN_PRICES: Record<string, { amount: number; credits: number }> = {
  free: { amount: 19, credits: 5 },
  basic: { amount: 79, credits: 40 },
  pro: { amount: 249, credits: 150 },
};

function md5Hex(data: Uint8Array): string {
  const hashBuffer = new Uint8Array(16);
  // Use SubtleCrypto for hashing
  // Fallback: manual approach not needed, we'll use crypto.subtle
  // Actually Deno supports crypto.subtle
  return "";
}

async function signPayload(payload: string, apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(apiKey),
    { name: "HMAC", hash: "SHA-512" },
  	false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

    const merchantId = Deno.env.get("CRYPTOMUS_MERCHANT_ID");
    const apiKey = Deno.env.get("CRYPTOMUS_API_KEY");
    if (!merchantId || !apiKey) {
      return new Response(JSON.stringify({ error: "Cryptomus not configured" }), {
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

    // Cryptomus uses base64(JSON) + md5 for signing
    const jsonBase64 = btoa(JSON.stringify(paymentData));
    const signString = jsonBase64 + apiKey;
    // MD5 hash
    const encoder = new TextEncoder();
    const hashBuf = await crypto.subtle.digest("MD5", encoder.encode(signString));
    const sign = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

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
