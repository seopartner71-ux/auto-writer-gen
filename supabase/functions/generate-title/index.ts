import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");

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
      ? `Ты — эксперт по SEO-заголовкам. Сгенерируй один идеальный Title (тег <title>) для статьи. Правила:
- Длина строго до 60 символов
- Ключевое слово как можно ближе к началу
- Без кавычек, без кликбейта
- Привлекательный, информативный, побуждающий к клику
- Проанализируй Title конкурентов из ТОП-10 и создай Title, который выделяется на их фоне и при этом соответствует поисковому интенту
- На русском языке
Верни ТОЛЬКО текст Title, без пояснений.`
      : `You are an SEO title expert. Generate one perfect Title tag for the article. Rules:
- Maximum 60 characters
- Primary keyword near the beginning
- No quotes, no clickbait
- Informative and click-worthy
- Analyze competitor titles from TOP-10 and create a title that stands out while matching search intent
- In the same language as the content
Return ONLY the title text, no explanations.`;

    const competitorBlock = competitorTitles.length > 0
      ? `\nCompetitor Titles (TOP-10):\n${competitorTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n`
      : "";

    const userPrompt = `Keyword: "${keyword || ""}"
${competitorBlock}
Article excerpt:
${snippet}

Generate the Title:`;

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
    const title = (aiData.choices?.[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "").slice(0, 60);

    return new Response(JSON.stringify({ title }), {
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