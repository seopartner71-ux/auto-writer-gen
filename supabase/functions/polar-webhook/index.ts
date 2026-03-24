import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature",
};

function verifyWebhookSignature(body: string, headers: Headers, secret: string): boolean {
  const webhookId = headers.get("webhook-id");
  const webhookTimestamp = headers.get("webhook-timestamp");
  const webhookSignature = headers.get("webhook-signature");

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    console.error("Missing webhook headers");
    return false;
  }

  // Check timestamp is not too old (5 min tolerance)
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(webhookTimestamp, 10);
  if (Math.abs(now - ts) > 300) {
    console.error("Webhook timestamp too old");
    return false;
  }

  // Standard Webhooks: secret must be base64-encoded
  const secretBytes = Uint8Array.from(atob(btoa(secret)), c => c.charCodeAt(0));

  const signedContent = `${webhookId}.${webhookTimestamp}.${body}`;
  const hmac = createHmac("sha256", Buffer.from(secret, "utf-8"));
  hmac.update(signedContent);
  const expectedSignature = hmac.digest("base64");

  // webhook-signature can contain multiple signatures separated by spaces
  const signatures = webhookSignature.split(" ");
  return signatures.some(sig => {
    const sigValue = sig.startsWith("v1,") ? sig.slice(3) : sig;
    return sigValue === expectedSignature;
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.text();

    // Verify webhook signature
    const webhookSecret = Deno.env.get("POLAR_WEBHOOK_SECRET");
    if (webhookSecret) {
      const isValid = verifyWebhookSignature(body, req.headers, webhookSecret);
      if (!isValid) {
        console.error("Invalid webhook signature");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const event = JSON.parse(body);
    console.log("Polar webhook event:", event.type);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Handle checkout completion
    if (event.type === "checkout.updated" && event.data?.status === "succeeded") {
      const checkout = event.data;
      const userId = checkout.metadata?.user_id;

      if (!userId) {
        console.error("No user_id in checkout metadata");
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const productName = checkout.product?.name?.toLowerCase() ?? "";
      let plan = "basic";
      let credits = 30;

      if (productName.includes("pro")) {
        plan = "pro";
        credits = 100;
      }

      console.log(`Upgrading user ${userId} to plan: ${plan}, credits: ${credits}`);

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ plan, credits_amount: credits })
        .eq("id", userId);

      if (updateError) {
        console.error("Failed to update profile:", updateError);
        throw updateError;
      }

      await supabase.from("notifications").insert({
        user_id: userId,
        title: "Подписка оформлена! 🎉",
        message: `Ваш тариф обновлён до ${plan.toUpperCase()}. Начислено ${credits} кредитов.`,
      });

      console.log(`User ${userId} upgraded successfully`);
    }

    // Handle subscription cancellation
    if (event.type === "subscription.canceled" || event.type === "subscription.revoked") {
      const subscription = event.data;
      const userId = subscription.metadata?.user_id;

      if (userId) {
        console.log(`Downgrading user ${userId} to free plan`);

        await supabase
          .from("profiles")
          .update({ plan: "free", credits_amount: 5 })
          .eq("id", userId);

        await supabase.from("notifications").insert({
          user_id: userId,
          title: "Подписка отменена",
          message: "Ваш тариф переключён на Free. Осталось 5 кредитов.",
        });
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("polar-webhook error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
