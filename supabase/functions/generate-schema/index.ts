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

    const { title, content, keyword } = await req.json();
    if (!content) throw new Error("Content is required");

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: assignment } = await supabaseAdmin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "researcher")
      .single();
    const model = assignment?.model_key || "google/gemini-2.5-flash";

    // Extract FAQ section from content for explicit FAQ schema generation
    const faqMatch = content.match(/##\s*(?:Часто задаваемые вопросы|FAQ|Вопросы и ответы)[\s\S]*/i);
    const faqSection = faqMatch ? faqMatch[0] : "";
    const faqQuestions = faqSection.match(/###\s*(.+?)(?:\n|\r)([\s\S]*?)(?=###|\s*$)/g) || [];

    const systemPrompt = `You are an SEO schema markup expert. Generate valid JSON-LD schema markup for the given article. Return structured data via the provided tool. Write in the same language as the article content.

CRITICAL RULES for FAQ schema:
- Extract ALL questions from the FAQ section provided
- Each FAQ entry must have "question" and "answer" fields
- The FAQ schema must follow the Google FAQPage specification exactly
- Return the complete FAQ schema with @context, @type, and mainEntity array`;

    const userPrompt = `Generate JSON-LD structured data for this article:

Title: ${title || "Untitled"}
Keyword: ${keyword || ""}

Article content (first 2000 chars):
${content.slice(0, 2000)}

${faqSection ? `\nFAQ SECTION FOUND IN ARTICLE (generate FAQPage schema from this):\n${faqSection.slice(0, 3000)}` : "\nNo FAQ section found in article."}

Generate:
1. Article schema (@type: Article with headline, description, datePublished, author)
2. FAQPage schema with ALL questions and answers from the FAQ section above`;

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
        tools: [{
          type: "function",
          function: {
            name: "return_schema",
            description: "Return JSON-LD schema markup for Article and FAQ",
            parameters: {
              type: "object",
              properties: {
                article_schema: {
                  type: "object",
                  description: "Article JSON-LD schema with @context, @type, headline, description, datePublished, author",
                },
                faq_schema: {
                  type: "object",
                  description: "FAQPage JSON-LD schema with @context: https://schema.org, @type: FAQPage, mainEntity array of {\"@type\":\"Question\",\"name\":\"...\",\"acceptedAnswer\":{\"@type\":\"Answer\",\"text\":\"...\"}}. Must include ALL questions from the FAQ section. Return null only if no FAQ exists.",
                },
              },
              required: ["article_schema", "faq_schema"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_schema" } },
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
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let result;
    if (toolCall?.function?.arguments) {
      result = JSON.parse(toolCall.function.arguments);
    } else {
      const c = aiData.choices?.[0]?.message?.content || "";
      const m = c.match(/\{[\s\S]*\}/);
      if (m) result = JSON.parse(m[0]);
      else throw new Error("Failed to parse AI response");
    }

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
