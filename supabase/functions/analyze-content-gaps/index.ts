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
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");

    const token = authHeader.replace("Bearer ", "");
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) throw new Error("Unauthorized");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload.sub as string;
    if (!userId) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { keyword_id } = await req.json();
    if (!keyword_id) throw new Error("keyword_id is required");

    // Fetch keyword data
    const { data: kw, error: kwErr } = await supabase
      .from("keywords")
      .select("*")
      .eq("id", keyword_id)
      .single();
    if (kwErr || !kw) throw new Error("Keyword not found");

    // Fetch SERP results
    const { data: serpResults } = await supabase
      .from("serp_results")
      .select("*")
      .eq("keyword_id", keyword_id)
      .order("position", { ascending: true });

    // Get model assignment
    const { data: assignment } = await supabaseAdmin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "researcher")
      .single();
    const model = assignment?.model_key || "google/gemini-2.5-flash";

    // Build context for AI
    const competitorInfo = (serpResults || []).map((sr: any) => 
      `#${sr.position}: "${sr.title}" — ${sr.url}\n   Snippet: ${sr.snippet || "N/A"}`
    ).join("\n\n");

    const mustCover = (kw.must_cover_topics || []).join(", ");
    const existingGaps = (kw.content_gaps as any[] || []).map((g: any) => `${g.topic}: ${g.reason}`).join("\n");
    const recHeadings = (kw.recommended_headings || []).join("\n");
    const questions = (kw.questions || []).join("\n");

    const systemPrompt = `You are an expert SEO content strategist specializing in E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) analysis. Analyze competitor content structure and identify topic coverage patterns. Return structured data via the provided tool.`;

    const userPrompt = `Keyword: "${kw.seed_keyword}"

TOP competitors:
${competitorInfo}

Already identified must-cover topics: ${mustCover}
Already identified content gaps:
${existingGaps}

Recommended headings from initial analysis:
${recHeadings}

User questions:
${questions}

TASK: Perform a deep Content Gap Analysis by comparing all competitor data. Categorize topics into:

1. **Common Topics** — themes covered by MOST competitors (3+ out of top 10). These are baseline requirements.
2. **Unique Topics** — themes covered by only 1-2 competitors. These are differentiation opportunities.
3. **Missing Topics (Gap)** — important topics that NO competitor covers well but would add significant value for the reader. Think about E-E-A-T: personal experience, expert opinions, practical tips, trust signals, data/statistics, case studies.

For each missing topic, explain WHY it matters for E-E-A-T and how it would improve content uniqueness.

Also provide 3-5 "Expert Insight" recommendations — specific E-E-A-T elements the article should include to outrank competitors (e.g., "Add a personal experience section", "Include original data or survey results", "Add expert quotes").

Write ALL output in the same language as the keyword "${kw.seed_keyword}".`;

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
            name: "return_content_gap_analysis",
            description: "Return structured content gap analysis",
            parameters: {
              type: "object",
              properties: {
                common_topics: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      topic: { type: "string" },
                      coverage_count: { type: "number", description: "How many competitors cover this" },
                      importance: { type: "string", enum: ["critical", "high", "medium"] }
                    },
                    required: ["topic", "coverage_count", "importance"]
                  },
                  description: "Topics covered by most competitors"
                },
                unique_topics: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      topic: { type: "string" },
                      found_in: { type: "string", description: "Which competitor(s) cover this" },
                      differentiation_value: { type: "string", enum: ["high", "medium", "low"] }
                    },
                    required: ["topic", "found_in", "differentiation_value"]
                  },
                  description: "Topics covered by only 1-2 competitors"
                },
                missing_topics: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      topic: { type: "string" },
                      why_important: { type: "string" },
                      eeat_aspect: { type: "string", enum: ["experience", "expertise", "authority", "trust"] }
                    },
                    required: ["topic", "why_important", "eeat_aspect"]
                  },
                  description: "Important topics missing from all competitors"
                },
                expert_insights: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      recommendation: { type: "string" },
                      eeat_category: { type: "string", enum: ["experience", "expertise", "authority", "trust"] },
                      impact: { type: "string", enum: ["high", "medium"] }
                    },
                    required: ["recommendation", "eeat_category", "impact"]
                  },
                  description: "E-E-A-T recommendations for outranking competitors"
                }
              },
              required: ["common_topics", "unique_topics", "missing_topics", "expert_insights"],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "return_content_gap_analysis" } },
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
    let analysis;
    if (toolCall?.function?.arguments) {
      analysis = JSON.parse(toolCall.function.arguments);
    } else {
      const content = aiData.choices?.[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
      else throw new Error("Failed to parse AI response");
    }

    // Log usage
    const tokensUsed = aiData.usage?.total_tokens || 0;
    await supabaseAdmin.from("usage_logs").insert({
      user_id: userId,
      action: "content_gap_analysis",
      model_used: model,
      tokens_used: tokensUsed,
    });

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("analyze-content-gaps error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
