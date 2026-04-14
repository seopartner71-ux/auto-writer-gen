import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "https://deno.land/std@0.119.0/hash/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const body = await req.json();
    console.log("Cryptomus webhook received:", JSON.stringify(body));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminDb = createClient(supabaseUrl, serviceKey);

    // Fetch API key from app_settings
    const { data: settingsData } = await adminDb
      .from("app_settings")
      .select("key, value")
      .eq("key", "cryptomus_api_key")
      .single();

    const apiKey = settingsData?.value;
    if (!apiKey) {
      console.error("CRYPTOMUS_API_KEY not found in app_settings");
      return new Response("OK", { status: 200 });
    }

    // Verify signature
    const receivedSign = body.sign;
    if (!receivedSign) {
      console.error("No sign in webhook payload");
      return new Response("OK", { status: 200 });
    }

    const payload = { ...body };
    delete payload.sign;

    const sorted: Record<string, unknown> = {};
    Object.keys(payload).sort().forEach((k) => {
      sorted[k] = payload[k];
    });

    const jsonBase64 = btoa(JSON.stringify(sorted));
    const computedSign = md5(jsonBase64 + apiKey);

    if (computedSign !== receivedSign) {
      console.error("Invalid signature", { computedSign, receivedSign });
      return new Response("OK", { status: 200 });
    }

    const status = body.status;
    if (status !== "paid" && status !== "paid_over") {
      console.log("Payment status not paid:", status);
      return new Response("OK", { status: 200 });
    }

    let additionalData: { user_id: string; plan: string; credits: number };
    try {
      additionalData = JSON.parse(body.additional_data || "{}");
    } catch {
      console.error("Failed to parse additional_data");
      return new Response("OK", { status: 200 });
    }

    const { user_id, plan, credits } = additionalData;
    if (!user_id || !plan || !credits) {
      console.error("Missing data in additional_data", additionalData);
      return new Response("OK", { status: 200 });
    }

    const { error: updateError } = await adminDb
      .from("profiles")
      .update({ plan, credits_amount: credits })
      .eq("id", user_id);

    if (updateError) {
      console.error("Failed to update profile:", updateError);
      return new Response("OK", { status: 200 });
    }

    await adminDb.from("payment_logs").insert({
      user_id,
      amount_rub: parseFloat(body.payment_amount_usd || body.amount || "0"),
      status: "success",
      order_id: body.order_id,
      plan_id: plan,
      raw_payload: body,
    });

    await adminDb.from("notifications").insert({
      user_id,
      title: "Payment Successful! 🎉",
      message: `Your ${plan.toUpperCase()} plan has been activated with ${credits} credits. Payment via cryptocurrency.`,
    });

    console.log(`Crypto payment success: user=${user_id}, plan=${plan}, credits=${credits}`);
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("crypto-webhook error:", err);
    return new Response("OK", { status: 200 });
  }
});
