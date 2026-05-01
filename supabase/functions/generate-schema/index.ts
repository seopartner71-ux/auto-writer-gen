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

    const { title, content, keyword, questions, lsi_keywords, mode, skip_schema } = await req.json();
    if (!content) throw new Error("Content is required");

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: assignment } = await supabaseAdmin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "researcher")
      .single();
    const model = assignment?.model_key || "google/gemini-2.5-flash";

    // Detect language from content
    const isRussian = /[а-яё]/i.test(content.slice(0, 500));
    const lang = isRussian ? "русском" : "English";

    // Extract existing FAQ section from content
    const faqMatch = content.match(/##\s*(?:Часто задаваемые вопросы|FAQ|Вопросы и ответы|Frequently Asked Questions)[\s\S]*/i);
    const faqSection = faqMatch ? faqMatch[0] : "";

    const isSerpDominance = mode === "serp-dominance";
    const skipSchema = skip_schema === true;

    // --- SYSTEM PROMPT ---
    // When skipSchema=true (e.g. Telegra.ph publishing), only the markdown FAQ block is needed —
    // Telegra.ph strips <script type="application/ld+json"> so JSON-LD would just bloat the response.
    const systemPromptSkipSchema = `You are an SEO FAQ expert for Telegra.ph. Telegra.ph does NOT support JSON-LD structured data, so DO NOT generate any schema.

Return a JSON object with EXACTLY ONE key:

"faq_text_block": A Markdown string starting with "## ${isRussian ? "Часто задаваемые вопросы (FAQ)" : "Frequently Asked Questions (FAQ)"}" followed by 3-5 "### Question" headings and answer paragraphs (Direct Answer First pattern, 150-300 chars per answer).

Do NOT include "article_schema" or "faq_schema" keys. Write in ${lang} language.`;

    const systemPrompt = skipSchema
      ? systemPromptSkipSchema
      : isSerpDominance
      ? `### SYSTEM INSTRUCTION FOR СЕО-Модуль FAQ ENGINE v2.0 ###

CONTEXT:
You are the "Information Gain Engine" of СЕО-Модуль. Your goal is to generate a FAQ section that guarantees high visibility in Google SGE, AI Overviews, and featured snippets (2026 standards).

TASK:
Based on the provided article content, keyword, and People Also Ask data, generate 3-5 high-intent questions and expert answers, then wrap them in JSON-LD Schema.org FAQPage markup.

CRITICAL REQUIREMENTS:
1. **INFORMATION GAIN**: Every answer MUST contain a specific detail, statistic, expert insight, or unique perspective NOT commonly found in generic top-10 SERP results. Add "Information Gain" — data that supplements, not duplicates, what AI models already know.
2. **SEMANTIC DENSITY (LSI 2.0)**: Naturally weave primary and secondary entities (LSI keywords) into answers to boost topical authority. The FAQ block should "fill semantic gaps" that the main article text didn't fully cover.
3. **SGE-READY FORMATTING**: Each answer MUST follow the "Direct Answer First" pattern — start with a clear, direct answer (1 sentence), then provide a brief expert clarification. Google's AI Overviews prioritize this structure.
4. **CONCISE EXPERTISE**: Answers must be 150-300 characters long — optimized for snippet boxes and AI citations.
5. **E-E-A-T SIGNALS**: Frame answers as if written by a subject-matter expert. Use authoritative language, reference methodologies or data where appropriate.

OUTPUT: Return a JSON object with exactly three keys:

"article_schema": A complete Article JSON-LD: {"@context":"https://schema.org","@type":"Article","headline":"...","description":"...","datePublished":"${new Date().toISOString().split("T")[0]}","author":{"@type":"Person","name":"Author"},"keywords":"..."}

"faq_schema": A complete FAQPage JSON-LD: {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"...","acceptedAnswer":{"@type":"Answer","text":"..."}}]}

"faq_text_block": A Markdown string with the FAQ section formatted as:
## ${isRussian ? "Часто задаваемые вопросы (FAQ)" : "Frequently Asked Questions (FAQ)"}
### Question text
Answer paragraph (Direct Answer First pattern).
...

ALL content must be in ${lang} language. NEVER return empty objects or placeholder text.`
      : `You are an SEO schema markup and FAQ expert. Respond with a JSON object containing exactly three keys:

"article_schema": A complete Article JSON-LD object: {"@context":"https://schema.org","@type":"Article","headline":"...","description":"...","datePublished":"${new Date().toISOString().split("T")[0]}","author":{"@type":"Person","name":"Author"}}

"faq_schema": A complete FAQPage JSON-LD object: {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"question text","acceptedAnswer":{"@type":"Answer","text":"answer text"}}, ...]}. Generate 3-5 FAQ questions based on article content, keyword, and People Also Ask data.

"faq_text_block": A Markdown string starting with "## ${isRussian ? "Часто задаваемые вопросы (FAQ)" : "Frequently Asked Questions (FAQ)"}" followed by "### Question" and answer paragraphs.

ALL fields must contain real data from the article. NEVER return empty objects. Write in ${lang} language.`;

    // --- USER PROMPT ---
    const lsiBlock = (lsi_keywords && lsi_keywords.length > 0)
      ? `\nLSI/Secondary keywords to weave into answers: ${lsi_keywords.slice(0, 15).join(", ")}`
      : "";

    const userPrompt = isSerpDominance
      ? `Generate SERP-Dominance FAQ with Information Gain and JSON-LD for this article:

Title: ${title || "Untitled"}
Primary Keyword: ${keyword || ""}
People Also Ask questions: ${(questions || []).slice(0, 10).join("; ") || "None provided"}${lsiBlock}

Article content (first 3000 chars):
${content.slice(0, 3000)}

${faqSection ? `\nEXISTING FAQ SECTION (improve, enhance with Information Gain, and expand):\n${faqSection.slice(0, 2000)}` : "\nNo existing FAQ — generate 3-5 high-intent questions with expert-level Information Gain answers."}

REMEMBER:
- Each answer must contain a UNIQUE insight not found in generic search results
- Use "Direct Answer First" format: [Direct answer]. [Expert clarification with specific data/methodology].
- Inject LSI keywords naturally to fill semantic gaps
- Answers: 150-300 characters, optimized for featured snippets`
      : `Generate JSON-LD structured data and FAQ for this article:

Title: ${title || "Untitled"}
Keyword: ${keyword || ""}
People Also Ask questions: ${(questions || []).slice(0, 10).join("; ") || "None provided"}

Article content (first 2000 chars):
${content.slice(0, 2000)}

${faqSection ? `\nEXISTING FAQ SECTION IN ARTICLE (use it as base, improve and expand):\n${faqSection.slice(0, 3000)}` : "\nNo existing FAQ section — generate 3-5 new FAQ questions and answers."}

Generate:
1. Article schema (@type: Article with headline, description, datePublished, author)
2. FAQPage schema with 3-5 questions and answers
3. A standalone FAQ text block in Markdown format (## FAQ / ### Q / A)`;

    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
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
    console.log("AI response status:", aiResponse.status);
    const rawContent = aiData.choices?.[0]?.message?.content || "";
    console.log("AI raw content length:", rawContent.length);
    
    let result;
    try {
      result = JSON.parse(rawContent);
    } catch {
      const m = rawContent.match(/\{[\s\S]*\}/);
      if (m) result = JSON.parse(m[0]);
      else throw new Error("Failed to parse AI response");
    }
    
    console.log("Parsed keys:", Object.keys(result));

    // Schema 3.0 Validation: basic structure checks
    if (result.faq_schema) {
      const faq = result.faq_schema;
      if (!faq["@context"]) faq["@context"] = "https://schema.org";
      if (!faq["@type"]) faq["@type"] = "FAQPage";
      if (Array.isArray(faq.mainEntity)) {
        faq.mainEntity = faq.mainEntity.filter((q: any) =>
          q && q["@type"] === "Question" && q.name && q.acceptedAnswer?.text
        );
      }
    }

    if (result.article_schema) {
      const art = result.article_schema;
      if (!art["@context"]) art["@context"] = "https://schema.org";
      if (!art["@type"]) art["@type"] = "Article";
    }

    // Add mode indicator to response
    result.mode = isSerpDominance ? "serp-dominance" : "standard";

    await supabaseAdmin.from("usage_logs").insert({
      user_id: user.id,
      action: isSerpDominance ? "generate_schema_serp_dominance" : "generate_schema",
      model_used: model,
      tokens_used: aiData.usage?.total_tokens || 0,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-schema error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: msg.includes("Unauthorized") ? 401 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
