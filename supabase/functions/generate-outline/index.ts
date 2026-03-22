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

    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    console.log("Auth header present:", !!authHeader, "starts with Bearer:", authHeader?.startsWith("Bearer "));
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");

    const token = authHeader.replace("Bearer ", "");
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) throw new Error("Unauthorized");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const user = { id: payload.sub as string };
    console.log("User ID extracted:", user.id);
    if (!user.id) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { keyword_id, existing_outline, serp_titles, questions, lsi_keywords } = await req.json();

    // Get keyword info
    const { data: keyword, error: kwError } = await supabase
      .from("keywords")
      .select("*")
      .eq("id", keyword_id)
      .single();
    if (kwError || !keyword) throw new Error("Keyword not found");

    // Get researcher model
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: assignment } = await supabaseAdmin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "researcher")
      .single();
    const model = assignment?.model_key || "google/gemini-2.5-flash";

    // Detect language from keyword
    const lang = keyword.intent ? "the same language as the keyword" : "English";

    const systemPrompt = `You are an expert SEO content strategist. Create an optimal article outline (H1, H2, H3 headings) based on SERP analysis data. The outline must be written in the same language as the keyword "${keyword.seed_keyword}". Return structured data via the provided tool.`;

    const userPrompt = `Keyword: "${keyword.seed_keyword}"
Intent: ${keyword.intent || "unknown"}

Competitor titles from TOP-10:
${(serp_titles || []).map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}

User questions (PAA):
${(questions || []).map((q: string, i: number) => `${i + 1}. ${q}`).join("\n")}

LSI keywords to incorporate:
${(lsi_keywords || []).join(", ")}

${existing_outline?.length ? `Current draft outline:\n${existing_outline.map((o: any) => `${o.level}: ${o.text}`).join("\n")}\n\nImprove this outline.` : "Create an ideal article outline from scratch."}

Requirements:
- Exactly 1 H1
- 5-10 H2 sections
- 2-4 H3 subsections where appropriate
- Include FAQ section with questions from PAA
- Ensure all must-cover topics are addressed
- WRITE ALL HEADINGS in the same language as the keyword "${keyword.seed_keyword}"`;

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
            name: "return_article_outline",
            description: "Return structured article outline",
            parameters: {
              type: "object",
              properties: {
                outline: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      text: { type: "string", description: "Heading text" },
                      level: { type: "string", enum: ["h1", "h2", "h3"] },
                    },
                    required: ["text", "level"],
                    additionalProperties: false,
                  },
                  description: "Article outline headings in order",
                },
                lsi_keywords: {
                  type: "array",
                  items: { type: "string" },
                  description: "Updated LSI keywords to use in content",
                },
              },
              required: ["outline", "lsi_keywords"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_article_outline" } },
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

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let result;
    if (toolCall?.function?.arguments) {
      result = JSON.parse(toolCall.function.arguments);
    } else {
      const content = aiData.choices?.[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) result = JSON.parse(jsonMatch[0]);
      else throw new Error("Failed to parse AI response");
    }

    // Log usage
    const tokensUsed = aiData.usage?.total_tokens || 0;
    await supabaseAdmin.from("usage_logs").insert({
      user_id: user.id,
      action: "generate_outline",
      model_used: model,
      tokens_used: tokensUsed,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-outline error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
