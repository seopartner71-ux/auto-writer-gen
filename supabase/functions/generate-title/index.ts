import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin0 = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: orKey } = await supabaseAdmin0.from("api_keys").select("api_key").eq("provider", "openrouter").eq("is_valid", true).single();
    const OPENROUTER_API_KEY = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) throw new Error("OpenRouter API key not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { keyword, content, lang, keyword_id } = await req.json();
    if (!content) throw new Error("Content is required");

    // Fetch competitor titles from serp_results
    let competitorTitles: string[] = [];
    if (keyword_id) {
      const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: serp } = await supabaseAdmin
        .from("serp_results")
        .select("title")
        .eq("keyword_id", keyword_id)
        .order("position", { ascending: true })
        .limit(10);
      if (serp) competitorTitles = serp.map((s: any) => s.title).filter(Boolean);
    }

    const snippet = content.slice(0, 1500);
    const isRu = lang === "ru" || /[а-яё]/i.test(snippet.slice(0, 200));

    const systemPrompt = isRu
      ? `Ты — эксперт по SEO-заголовкам. Сгенерируй:
1. Title (тег <title>) — до 60 символов, ключевое слово ближе к началу, без кавычек, без кликбейта, привлекательный
2. H1 (заголовок на странице) — до 80 символов, более развёрнутый и читабельный чем Title, может отличаться формулировкой но сохранять ключевое слово
Проанализируй Title конкурентов из ТОП-10 и создай заголовки, которые выделяются на их фоне.

КРИТИЧЕСКИЕ ПРАВИЛА ОФОРМЛЕНИЯ:
- Заглавная буква ТОЛЬКО в начале заголовка и в именах собственных (названия брендов, городов, имена людей и т.д.). НЕ пиши Каждое Слово С Большой Буквы.
- Используй дефис "-" вместо тире "—". Пример: "Цветы в интерьере - как преобразить каждую комнату"
- Не используй длинное тире (—), только короткий дефис (-)

На русском языке.
Верни JSON: {"title": "...", "h1": "..."} — без пояснений, только JSON.`
      : `You are an SEO title expert. Generate:
1. Title (meta title tag) — max 60 chars, keyword near beginning, no quotes, no clickbait, click-worthy
2. H1 (page heading) — max 80 chars, more descriptive and readable than Title, may differ in phrasing but keep the keyword
Analyze competitor titles from TOP-10 and create titles that stand out while matching search intent.

CRITICAL FORMATTING RULES:
- Use sentence case: capitalize only the first word and proper nouns (brand names, cities, people names). Do NOT Title Case Every Word.
- Use hyphen "-" instead of em dash "—".

In the same language as the content.
Return JSON: {"title": "...", "h1": "..."} — no explanations, only JSON.`;

    const competitorBlock = competitorTitles.length > 0
      ? `\nCompetitor Titles (TOP-10):\n${competitorTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n`
      : "";

    const userPrompt = `Keyword: "${keyword || ""}"
${competitorBlock}
Article excerpt:
${snippet}

Generate Title and H1:`;

    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const raw = (aiData.choices?.[0]?.message?.content || "").trim();
    
    // Parse JSON response, with fallback
    let titleResult = "";
    let h1Result = "";
    try {
      const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      titleResult = (parsed.title || "").replace(/^["']|["']$/g, "").slice(0, 60);
      h1Result = (parsed.h1 || "").replace(/^["']|["']$/g, "").slice(0, 80);
    } catch {
      // Fallback: treat entire response as title
      titleResult = raw.replace(/^["']|["']$/g, "").slice(0, 60);
      h1Result = "";
    }

    return new Response(JSON.stringify({ title: titleResult, h1: h1Result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-title error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: msg.includes("Unauthorized") ? 401 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});