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

    const { title, content, keyword, questions } = await req.json();
    if (!content) throw new Error("Content is required");

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: assignment } = await supabaseAdmin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "researcher")
      .single();
    const model = assignment?.model_key || "google/gemini-2.5-flash";

    // Extract existing FAQ section from content
    const faqMatch = content.match(/##\s*(?:Часто задаваемые вопросы|FAQ|Вопросы и ответы)[\s\S]*/i);
    const faqSection = faqMatch ? faqMatch[0] : "";

    const systemPrompt = `You are an SEO schema markup and FAQ expert. Generate valid JSON-LD schema markup AND a standalone FAQ text block for the given article. Write in the same language as the article content.

CRITICAL RULES for FAQ schema:
- Generate 3-5 FAQ questions based on the article content, the keyword, and provided "People Also Ask" questions
- Each FAQ entry must have "question" and "answer" fields
- The FAQ schema must follow the Google FAQPage specification exactly
- Return the complete FAQ schema with @context, @type, and mainEntity array
- Also return a plain-text FAQ block formatted in Markdown (### Question / Answer) for embedding into the article`;

    const userPrompt = `Generate JSON-LD structured data and FAQ for this article:

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

    await supabaseAdmin.from("usage_logs").insert({
      user_id: user.id,
      action: "generate_schema",
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
