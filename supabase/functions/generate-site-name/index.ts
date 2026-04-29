import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { topic, language } = await req.json();
    if (!topic || typeof topic !== "string") {
      return new Response(JSON.stringify({ error: "topic required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

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
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limit", message: "AI rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "payment_required", message: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error ${aiRes.status}: ${t}`);
    }

    const data = await aiRes.json();
    let name = String(data?.choices?.[0]?.message?.content || "").trim();
    name = name.replace(/^["'«»`]+|["'«»`.\s]+$/g, "").split(/[\n\r]/)[0].trim();
    if (name.length > 30) name = name.slice(0, 30).trim();
    if (!name) name = topic.slice(0, 20);

    return new Response(JSON.stringify({ name }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-site-name error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});