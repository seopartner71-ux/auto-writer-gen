import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const POLAR_ACCESS_TOKEN = Deno.env.get("POLAR_ACCESS_TOKEN");
    if (!POLAR_ACCESS_TOKEN) throw new Error("POLAR_ACCESS_TOKEN not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user auth
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, productId, checkoutId } = await req.json();

    if (action === "create") {
      // Create a Polar checkout session
      if (!productId) throw new Error("productId is required");

      const appUrl = req.headers.get("origin") || "https://id-preview--bbbb80ab-81d3-4691-9752-0fba6c202665.lovable.app";

      const response = await fetch("https://api.polar.sh/v1/checkouts/", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          products: [productId],
          success_url: `${appUrl}/pricing?checkout_id={CHECKOUT_ID}`,
          customer_email: user.email,
          metadata: {
            user_id: user.id,
          },
        }),
      });

      const checkout = await response.json();
      if (!response.ok) {
        console.error("Polar checkout error:", checkout);
        throw new Error(`Polar API error: ${JSON.stringify(checkout)}`);
      }

      return new Response(JSON.stringify({ url: checkout.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify") {
      // Verify a checkout session
      if (!checkoutId) throw new Error("checkoutId is required");

      const response = await fetch(`https://api.polar.sh/v1/checkouts/${checkoutId}`, {
        headers: {
          Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
        },
      });

      const checkout = await response.json();
      if (!response.ok) {
        throw new Error(`Polar API error: ${JSON.stringify(checkout)}`);
      }

      return new Response(JSON.stringify({ status: checkout.status, checkout }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Invalid action. Use 'create' or 'verify'.");
  } catch (error) {
    console.error("polar-checkout error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
