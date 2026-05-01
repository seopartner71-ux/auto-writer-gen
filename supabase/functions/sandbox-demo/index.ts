import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + "sandbox-salt");
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";
    const ipHash = await hashIp(ip);
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Rate limit: 5 per hour per IP
    const windowStart = new Date();
    windowStart.setMinutes(0, 0, 0);

    const { data: existing } = await admin
      .from("sandbox_rate_limits")
      .select("request_count")
      .eq("ip_hash", ipHash)
      .eq("window_start", windowStart.toISOString())
      .maybeSingle();

    if (existing && existing.request_count >= 5) {
      return new Response(
        JSON.stringify({ error: "Превышен лимит демо. Попробуйте через час или зарегистрируйтесь." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (existing) {
      await admin
        .from("sandbox_rate_limits")
        .update({ request_count: existing.request_count + 1 })
        .eq("ip_hash", ipHash)
        .eq("window_start", windowStart.toISOString());
    } else {
      await admin.from("sandbox_rate_limits").insert({
        ip_hash: ipHash,
        window_start: windowStart.toISOString(),
        request_count: 1,
      });
    }

    const body = await req.json();
    const keyword = String(body.keyword || "").trim().slice(0, 100);
    if (keyword.length < 2) throw new Error("Введите ключевое слово");

    // Call Gemini Flash Lite
    const prompt = `Ты SEO-эксперт. По ключевому запросу "${keyword}" дай краткий анализ строго в JSON:
{
  "intent": "Информационный|Коммерческий|Транзакционный|Навигационный",
  "competition": "Низкая|Средняя|Высокая",
  "estimated_difficulty": число от 0 до 100,
  "outline": ["заголовок 1", "заголовок 2", "заголовок 3", "заголовок 4", "заголовок 5"],
  "lsi_keywords": ["ключ 1", "ключ 2", "ключ 3", "ключ 4", "ключ 5"],
  "ai_score_sample": число от 70 до 95 (имитация AI-Score нашей системы),
  "seo_score_sample": число от 75 до 95
}
Только JSON, без markdown.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      throw new Error(`AI error ${aiResp.status}: ${errText}`);
    }

    const aiData = await aiResp.json();
    const content = aiData.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Не удалось распознать ответ AI");

    const result = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify({ result, remaining: 5 - ((existing?.request_count || 0) + 1) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});