import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.text();
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

      // Determine which plan was purchased based on product
      const productName = checkout.product?.name?.toLowerCase() ?? "";
      let plan = "basic";
      let credits = 30;

      if (productName.includes("pro")) {
        plan = "pro";
        credits = 100;
      } else if (productName.includes("basic")) {
        plan = "basic";
        credits = 30;
      }

      console.log(`Upgrading user ${userId} to plan: ${plan}, credits: ${credits}`);

      // Update user profile
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ plan, credits_amount: credits })
        .eq("id", userId);

      if (updateError) {
        console.error("Failed to update profile:", updateError);
        throw updateError;
      }

      // Send notification
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
