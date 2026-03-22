import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { keyword_id, author_profile_id, outline, lsi_keywords, competitor_tables, competitor_lists, deep_analysis_context, optimize_instructions, existing_content } = await req.json();
    if (!keyword_id) throw new Error("keyword_id is required");

    // Detect language from keyword
    const keywordText = keyword?.seed_keyword || "";

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1. Get user profile for tier
    const { data: profile } = await supabase.from("profiles").select("plan").eq("id", user.id).single();
    const userPlan = profile?.plan || "basic";

    // 2. Get model assignment based on tier
    const writerTask = userPlan === "pro" ? "writer_pro" : "writer_basic";
    const { data: assignment } = await supabaseAdmin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", writerTask)
      .single();

    // Fallback models by tier
    const fallbackModel = userPlan === "pro" ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash-lite";
    const model = assignment?.model_key || fallbackModel;

    // 3. Get keyword data
    const { data: keyword } = await supabase.from("keywords").select("*").eq("id", keyword_id).single();
    if (!keyword) throw new Error("Keyword not found");

    const isRussian = /[а-яё]/i.test(keyword.seed_keyword);

    // 4. Get SERP results
    const { data: serpResults } = await supabase
      .from("serp_results")
      .select("title, snippet, url")
      .eq("keyword_id", keyword_id)
      .order("position", { ascending: true })
      .limit(10);

    // 5. Get author profile if provided
    let authorStyle = "";
    if (author_profile_id) {
      const { data: author } = await supabase
        .from("author_profiles")
        .select("*")
        .eq("id", author_profile_id)
        .single();
      if (author) {
        const parts = [];
        parts.push(`AUTHOR NAME: ${author.name}`);
        if (author.voice_tone) parts.push(`TONE OF VOICE: ${author.voice_tone}. You MUST write the entire article in this exact tone.`);
        if (author.niche) parts.push(`NICHE EXPERTISE: ${author.niche}. Use domain-specific terminology naturally.`);
        if (author.style_analysis) {
          const sa = author.style_analysis as any;
          if (sa.tone_description) parts.push(`WRITING STYLE: ${sa.tone_description}`);
          if (sa.vocabulary_level) parts.push(`VOCABULARY LEVEL: ${sa.vocabulary_level}`);
          if (sa.paragraph_length) parts.push(`PARAGRAPH LENGTH: ${sa.paragraph_length}`);
          if (sa.sentence_style) parts.push(`SENTENCE STYLE: ${sa.sentence_style}`);
          if (sa.metaphor_usage) parts.push(`METAPHOR USAGE: ${sa.metaphor_usage}`);
          if (sa.formality) parts.push(`FORMALITY: ${sa.formality}`);
          if (sa.emotional_tone) parts.push(`EMOTIONAL TONE: ${sa.emotional_tone}`);
          if (sa.recommended_system_prompt) parts.push(`STYLE DIRECTIVE: ${sa.recommended_system_prompt}`);
        }
        if (author.style_examples) parts.push(`REFERENCE WRITING SAMPLE (mimic this style closely):\n"${author.style_examples.slice(0, 1500)}"`);
        if (author.stop_words?.length) parts.push(`FORBIDDEN WORDS (never use these): ${author.stop_words.join(", ")}`);
        if (author.system_prompt_override) parts.push(`ADDITIONAL AUTHOR INSTRUCTIONS: ${author.system_prompt_override}`);
        authorStyle = parts.join("\n");
      }
    }

    // 6. Build outline string
    const outlineStr = (outline || [])
      .map((o: any) => `${{ h1: "#", h2: "##", h3: "###" }[o.level] || "##"} ${o.text}`)
      .join("\n");

    // 7. Competitor analysis
    const competitorStr = (serpResults || [])
      .map((r: any, i: number) => `${i + 1}. "${r.title}" — ${r.snippet || ""}`)
      .join("\n");

    const lsiStr = (lsi_keywords || keyword.lsi_keywords || []).join(", ");
    const questionsStr = (keyword.questions || []).join("\n- ");

    // Build tables/lists instructions
    let tablesListsInstructions = "";
    if (competitor_tables?.length) {
      tablesListsInstructions += "\n\nTABLES TO INCLUDE (based on competitor analysis):\n";
      competitor_tables.forEach((t: any, i: number) => {
        tablesListsInstructions += `${i + 1}. Table about "${t.topic}" with columns: ${(t.columns || []).join(" | ")}\n`;
      });
      tablesListsInstructions += "Create these tables with real, useful data filled in. Use Markdown table syntax.";
    }
    if (competitor_lists?.length) {
      tablesListsInstructions += "\n\nLISTS TO INCLUDE (based on competitor analysis):\n";
      competitor_lists.forEach((l: any, i: number) => {
        tablesListsInstructions += `${i + 1}. ${l.type === "numbered" ? "Numbered" : l.type === "checklist" ? "Checklist" : "Bullet"} list about "${l.topic}"${l.estimated_items ? ` (~${l.estimated_items} items)` : ""}\n`;
      });
      tablesListsInstructions += "Include these lists naturally within the relevant sections.";
    }

    const systemPrompt = `You are an expert SEO content writer.${authorStyle ? ` You are writing AS the author described below — adopt their voice, tone, vocabulary, and style throughout the ENTIRE article. Every sentence must sound like this author wrote it.` : ""}

${authorStyle ? `\n=== AUTHOR PERSONA (CRITICAL — follow strictly) ===\n${authorStyle}\n=== END AUTHOR PERSONA ===\n` : ""}
RULES:
- Follow the exact heading structure provided
- Naturally incorporate LSI keywords throughout the text
- Write in the same language as the keyword and headings
- Include transition phrases between sections
- Make content informative, engaging, and original
- Aim for the recommended word count
- Format the article in Markdown (# for h1, ## for h2, ### for h3)
- IMPORTANT: Include comparison tables, feature tables, and structured lists where competitors use them. Tables and lists improve readability and SEO ranking.
- Use Markdown table syntax: | Column1 | Column2 | with header separator |---|---|
- Use bullet lists (- item), numbered lists (1. item), or checklists where appropriate
${authorStyle ? "- CRITICAL: Maintain the author's unique voice and style in EVERY paragraph. Do NOT fall into generic AI writing patterns." : ""}
${tablesListsInstructions}
${deep_analysis_context ? `\n${deep_analysis_context}` : ""}

CRITICAL LANGUAGE RULE: The ENTIRE article MUST be written in the SAME language as the keyword "${keyword.seed_keyword}". ${isRussian ? "The keyword is in Russian — write everything in Russian." : "The keyword is NOT in Russian — write in the language of the keyword. Do NOT write in Russian."}

ANTI-AI DETECTION (CRITICAL — follow strictly):
- Write like a real human expert, NOT like an AI. Vary sentence length dramatically: mix very short punchy sentences with longer complex ones.
${isRussian 
  ? `- Use colloquial expressions, idioms, and informal transitions naturally ("Честно говоря", "Давайте разберёмся", "Вот в чём дело").
- Include personal opinions, subjective judgments, and first-person perspective ("Я считаю", "По моему опыту", "На мой взгляд").
- Avoid these AI giveaway patterns: "В заключение", "Важно отметить", "Следует подчеркнуть", "Необходимо учитывать", "В современном мире", "Данный", "Является", "Осуществлять", "В рамках", "На сегодняшний день", "Комплексный подход".`
  : `- Use colloquial expressions, idioms, and informal transitions natural to the keyword's language.
- Include personal opinions, subjective judgments, and first-person perspective ("I believe", "In my experience", "From what I've seen").
- Avoid these AI giveaway patterns: "In conclusion", "It's important to note", "It should be emphasized", "It's worth mentioning", "In today's world", "comprehensive", "utilize", "leverage", "streamline".`}
- Add imperfections: occasional rhetorical questions, parenthetical asides (like this one), dashes — for emphasis.
- NEVER start paragraphs with the same word pattern. NEVER use formulaic transitions like "Furthermore", "Moreover", "Additionally", "It's worth noting".
- Use concrete examples, numbers, anecdotes instead of abstract generalizations.
- Vary paragraph length: some 1-2 sentences, others 4-5. Real writers are inconsistent.
- Use active voice predominantly. Avoid passive constructions and nominalized verbs.
- Write with emotional engagement — show enthusiasm, skepticism, surprise where appropriate.

FAQ SECTION (MANDATORY):
- At the end of the article, add a section "${isRussian ? "## Часто задаваемые вопросы (FAQ)" : "## Frequently Asked Questions (FAQ)"}"
- Include at least 5 questions and answers
- Use the provided user questions as a base, and add more relevant questions
- Format each Q&A as: "### <Question>\\n<Answer paragraph>"
- Answers should be 2-4 sentences, concise and informative
- Add structured data hint: wrap the FAQ section with a comment <!-- FAQ Schema -->
- The FAQ must be in the SAME language as the keyword and the article`;

    let userPrompt: string;

    if (optimize_instructions && existing_content) {
      // Optimization mode: rewrite existing article based on benchmark gaps
      userPrompt = `KEYWORD: "${keyword.seed_keyword}"
INTENT: ${keyword.intent || "informational"}

CURRENT ARTICLE (to be improved):
${existing_content}

OPTIMIZATION INSTRUCTIONS (based on TOP-10 benchmark comparison):
${optimize_instructions}

TOP-10 BENCHMARK DATA (apply these recommendations directly when rewriting):
${deep_analysis_context || "No additional TOP-10 benchmark context provided."}

LSI KEYWORDS TO INCLUDE:
${lsiStr || "None"}

USER QUESTIONS TO ANSWER:
${questionsStr ? `- ${questionsStr}` : "None"}

TASK: Rewrite and expand the article above to fix ALL listed problems. Keep the existing good parts, but explicitly use the TOP-10 comparison data to:
- add missing sections and subtopics that leaders cover;
- add missing entities, related terms, and LSI phrases from the benchmark;
- align article depth, structure, and completeness with TOP-10 patterns;
- improve usefulness, specificity, and expert detail where competitors are stronger.

Do not just mention the recommendations — implement them in the rewritten article. Maintain the same language, tone, and style. Output the FULL improved article in Markdown.`;
    } else {
      userPrompt = `KEYWORD: "${keyword.seed_keyword}"
INTENT: ${keyword.intent || "informational"}

ARTICLE OUTLINE:
${outlineStr || "Write a comprehensive article about this keyword"}

COMPETITOR INSIGHTS:
${competitorStr || "No competitor data"}

LSI KEYWORDS TO INCLUDE:
${lsiStr || "None"}

USER QUESTIONS TO ANSWER:
${questionsStr ? `- ${questionsStr}` : "None"}

RECOMMENDED WORD COUNT: ${keyword.difficulty && keyword.difficulty > 50 ? "2000-3000" : "1500-2000"} words

Write the full article now.`;
    }

    // 8. Stream AI response
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    // Log usage (estimate tokens for streaming)
    supabaseAdmin.from("usage_logs").insert({
      user_id: user.id,
      action: "generate_article",
      model_used: model,
      tokens_used: 0, // updated later if needed
    }).then(() => {});

    // Stream response back
    return new Response(aiResponse.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    console.error("generate-article error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
