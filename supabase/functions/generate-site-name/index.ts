import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logCost } from "../_shared/costLogger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getOpenRouterKey(): Promise<string> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);
    const { data } = await admin.from("api_keys").select("api_key").eq("provider", "openrouter").eq("is_valid", true).single();
    if (data?.api_key) return data.api_key;
  } catch (_) { /* ignore */ }
  const envKey = Deno.env.get("OPENROUTER_API_KEY");
  if (envKey) return envKey;
  throw new Error("OpenRouter API key not configured");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Brand-style fallback name from topic (no AI required)
  const fallbackName = (topic: string, lang: string): string => {
    const t = String(topic || "site").trim();
    const isRu = lang === "ru";
    if (!t) return isRu ? "СайтПро" : "SitePro";
    const firstWord = t.split(/[\s,;\-—]+/)[0] || t;
    const cleaned = firstWord.replace(/[^\p{L}\p{N}]/gu, "");
    const cap = cleaned.charAt(0).toLocaleUpperCase() + cleaned.slice(1).toLocaleLowerCase();
    const suffix = isRu
      ? ["Хаб", "Про", "Лаб", "Гид", "Маркет"][Math.floor(Math.random() * 5)]
      : ["Hub", "Pro", "Lab", "Hq", "Spot"][Math.floor(Math.random() * 5)];
    const base = cap.slice(0, 10) || (isRu ? "Сайт" : "Site");
    return `${base}${suffix}`;
  };

  let topicForFallback = "";
  let langForFallback = "ru";

  try {
    const { topic, language } = await req.json();
    topicForFallback = topic || "";
    langForFallback = (language || "ru").toLowerCase().startsWith("ru") ? "ru" : "en";
    if (!topic || typeof topic !== "string") {
      return new Response(JSON.stringify({ error: "topic required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let OPENROUTER_API_KEY: string;
    try {
      OPENROUTER_API_KEY = await getOpenRouterKey();
    } catch (_) {
      return new Response(JSON.stringify({ name: fallbackName(topic, langForFallback), fallback: true, reason: "no_api_key" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lang = (language || "ru").toLowerCase().startsWith("ru") ? "ru" : "en";
    const systemPrompt = lang === "ru"
      ? "Ты — креативный нейминг-эксперт. Создавай короткие брендовые названия сайтов (1-2 слова, 4-14 символов). Без кавычек, без пояснений. Можно RU/EN или микс. Примеры: DachaLife, TractorPro, СадТехника, BikeLab, КофеХаус."
      : "You are a creative naming expert. Generate short brand names for websites (1-2 words, 4-14 chars). No quotes, no explanations. Examples: DachaLife, TractorPro, BikeLab, CoffeeHouse.";

    const userPrompt = lang === "ru"
      ? `Тема: ${topic}\nВерни ТОЛЬКО одно название, без точки в конце.`
      : `Topic: ${topic}\nReturn ONLY one name, no trailing period.`;

    const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Module Site Name",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 1.0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("OpenRouter error:", aiRes.status, t);
      // Graceful fallback for billing/rate-limit/server errors so the grid creator keeps working
      const reason =
        aiRes.status === 402 ? "ai_credits_exhausted" :
        aiRes.status === 429 ? "ai_rate_limit" :
        `ai_error_${aiRes.status}`;
      return new Response(JSON.stringify({ name: fallbackName(topic, lang), fallback: true, reason }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiRes.json();
    let name = String(data?.choices?.[0]?.message?.content || "").trim();
    name = name.replace(/^["'«»`]+|["'«»`.\s]+$/g, "").split(/[\n\r]/)[0].trim();
    if (name.length > 30) name = name.slice(0, 30).trim();
    if (!name) name = fallbackName(topic, lang);

    // Best-effort cost log (uses service-role admin client; never throws)
    try {
      const url = Deno.env.get("SUPABASE_URL");
      const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (url && svc) {
        const admin = createClient(url, svc);
        const usage = data?.usage || {};
        void logCost(admin, {
          operation_type: "site_generation",
          model: "google/gemini-2.5-flash",
          tokens_input: Number(usage.prompt_tokens || 0),
          tokens_output: Number(usage.completion_tokens || 0),
          metadata: { context: "site_name" },
        });
      }
    } catch (_) { /* ignore */ }

    return new Response(JSON.stringify({ name }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-site-name error:", e);
    return new Response(
      JSON.stringify({ name: fallbackName(topicForFallback, langForFallback), fallback: true, reason: "service_failed" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});