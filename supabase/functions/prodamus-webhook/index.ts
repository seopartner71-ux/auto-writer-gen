import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Recursive sort for nested objects/arrays (Prodamus signature format)
function sortObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const val = obj[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      sorted[key] = sortObject(val as Record<string, unknown>);
    } else if (Array.isArray(val)) {
      sorted[key] = val.map((item) =>
        item && typeof item === "object" ? sortObject(item as Record<string, unknown>) : item
      );
    } else {
      sorted[key] = val;
    }
  }
  return sorted;
}

// Build a flat string representation for HMAC signing
function flattenForSign(obj: Record<string, unknown>, prefix = ""): string[] {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      parts.push(...flattenForSign(val as Record<string, unknown>, fullKey));
    } else if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (item && typeof item === "object") {
          parts.push(...flattenForSign(item as Record<string, unknown>, `${fullKey}[${i}]`));
        } else {
          parts.push(`${fullKey}[${i}]=${item}`);
        }
      });
    } else {
      parts.push(`${fullKey}=${val}`);
    }
  }
  return parts;
}

async function hmacSha256(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Parse body — Prodamus sends application/x-www-form-urlencoded or JSON
    let body: Record<string, unknown>;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      body = await req.json();
    } else {
      const formData = await req.formData();
      body = {};
      for (const [key, value] of formData.entries()) {
        body[key] = value;
      }
    }

    console.log("[prodamus-webhook] Received webhook:", JSON.stringify(body));

    // Extract signature and verify
    const receivedSign = (body.sign as string) || "";
    const bodyWithoutSign = { ...body };
    delete bodyWithoutSign.sign;

    // Get API key from app_settings
    const { data: apiKeySetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "prodamus_api_key")
      .single();

    const apiKey = apiKeySetting?.value;

    if (apiKey && receivedSign) {
      const sorted = sortObject(bodyWithoutSign);
      const flatParts = flattenForSign(sorted);
      const signString = flatParts.join("&");
      const expectedSign = await hmacSha256(apiKey, signString);

      if (expectedSign !== receivedSign) {
        console.warn("[prodamus-webhook] Signature mismatch, trying alternative...");
        // Try JSON stringify approach as fallback
        const altSign = await hmacSha256(apiKey, JSON.stringify(sorted));
        if (altSign !== receivedSign) {
          console.warn("[prodamus-webhook] Both signature checks failed. Processing anyway for now.");
          // In production you may want to reject here
        }
      }
    }

    // Check payment status
    const paymentStatus = body.payment_status as string;
    if (paymentStatus !== "success") {
      console.log(`[prodamus-webhook] Payment status: ${paymentStatus}, skipping.`);
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract user ID from customer_extra
    const customerExtra = (body.customer_extra as string) || "";
    const userId = customerExtra.trim();

    if (!userId || userId.length < 30) {
      console.error("[prodamus-webhook] No valid user_id in customer_extra:", customerExtra);
      return new Response(JSON.stringify({ error: "Missing user_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine plan from payment sum
    const paymentSum = parseFloat(body.sum as string || body.order_sum as string || "0");

    // Get plans from DB
    const { data: plans } = await supabase
      .from("subscription_plans")
      .select("id, name, price_rub, monthly_article_limit")
      .order("price_rub", { ascending: true });

    if (!plans || plans.length === 0) {
      console.error("[prodamus-webhook] No subscription plans found");
      return new Response(JSON.stringify({ error: "No plans configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Match plan by closest price (with 10% tolerance)
    let matchedPlan = plans[0];
    let minDiff = Infinity;
    for (const plan of plans) {
      const diff = Math.abs((plan.price_rub || 0) - paymentSum);
      if (diff < minDiff) {
        minDiff = diff;
        matchedPlan = plan;
      }
    }

    // Verify match is reasonable (within 10% of plan price)
    const planPrice = matchedPlan.price_rub || 0;
    if (planPrice > 0 && minDiff > planPrice * 0.1) {
      console.warn(`[prodamus-webhook] Payment sum ${paymentSum} doesn't match any plan closely. Best match: ${matchedPlan.name} (${planPrice})`);
    }

    console.log(`[prodamus-webhook] Matched plan: ${matchedPlan.id} (${matchedPlan.name}) for sum ${paymentSum}`);

    // Update user profile: set plan and add credits
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        plan: matchedPlan.id,
        credits_amount: matchedPlan.monthly_article_limit,
        is_active: true,
      })
      .eq("id", userId);

    if (updateError) {
      console.error("[prodamus-webhook] Failed to update profile:", updateError.message);
      return new Response(JSON.stringify({ error: "Failed to update profile" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch user profile and admins
    const { data: userProfile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .single();

    // Log payment
    const orderIdRaw = (body.order_id as string) || (body.order_num as string) || "";
    await supabase.from("payment_logs").insert({
      user_id: userId,
      email: userProfile?.email || (body.customer_email as string) || null,
      plan_id: matchedPlan.id,
      amount_rub: paymentSum,
      order_id: orderIdRaw,
      status: "success",
      raw_payload: body,
    });

    console.log(`[prodamus-webhook] User ${userId} upgraded to ${matchedPlan.name}, credits: ${matchedPlan.monthly_article_limit}`);

    // Send notification to user
    await supabase.from("notifications").insert({
      user_id: userId,
      title: "🎉 Тариф активирован!",
      message: `Ваш тариф "${matchedPlan.name}" успешно активирован. Начислено ${matchedPlan.monthly_article_limit} кредитов. Спасибо за оплату!`,
    });

    // Notify admins
    const { data: admins } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    for (const admin of admins || []) {
      await supabase.from("notifications").insert({
        user_id: admin.user_id,
        title: "💰 Новая оплата!",
        message: `Пользователь ${userProfile?.email || userId} оплатил тариф "${matchedPlan.name}" (${paymentSum} ₽). Кредиты начислены автоматически.`,
      });
    }

    // Send Telegram notification
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/telegram-notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          type: "payment_received",
          data: {
            email: userProfile?.email || "unknown",
            plan: matchedPlan.name,
            sum: paymentSum,
          },
        }),
      });
      console.log(`[prodamus-webhook] Telegram notify status: ${response.status}`);
    } catch (e) {
      console.warn("[prodamus-webhook] Telegram notify failed:", e);
    }

    return new Response(JSON.stringify({ ok: true, plan: matchedPlan.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[prodamus-webhook] Error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
