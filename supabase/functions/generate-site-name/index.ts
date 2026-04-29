import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
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

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, t);
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