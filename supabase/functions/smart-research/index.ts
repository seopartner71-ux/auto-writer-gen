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

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { keyword, geo, language } = await req.json();
    if (!keyword || typeof keyword !== "string" || keyword.trim().length < 2) {
      return new Response(JSON.stringify({ error: "Keyword is required (min 2 chars)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1. Get Serper API key from admin vault
    const { data: serperKey } = await supabaseAdmin
      .from("api_keys")
      .select("api_key")
      .eq("provider", "serper")
      .single();

    if (!serperKey?.api_key) {
      return new Response(JSON.stringify({ error: "Serper API key not configured. Ask admin to add it in API Vault." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Query Google via Serper
    console.log("Searching Serper for:", keyword, geo, language);
    const serperResponse = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": serperKey.api_key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: keyword.trim(),
        gl: geo || "us",
        hl: language || "en",
        num: 10,
      }),
    });

    if (!serperResponse.ok) {
      const errText = await serperResponse.text();
      console.error("Serper error:", serperResponse.status, errText);
      if (serperResponse.status === 401 || serperResponse.status === 403) {
        return new Response(JSON.stringify({ error: "Serper API key is invalid" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`Serper API error: ${serperResponse.status}`);
    }

    const serperData = await serperResponse.json();
    const organicResults = serperData.organic || [];
    const peopleAlsoAsk = serperData.peopleAlsoAsk || [];

    // 3. Save keyword to DB
    const { data: keywordRow, error: kwError } = await supabase
      .from("keywords")
      .insert({
        user_id: user.id,
        seed_keyword: keyword.trim(),
        intent: null,
      })
      .select("id")
      .single();

    if (kwError) {
      console.error("Keyword insert error:", kwError);
      throw new Error(`Failed to save keyword: ${kwError.message}`);
    }

    // 4. Save SERP results
    const serpEntries = organicResults.slice(0, 10).map((r: any, i: number) => ({
      keyword_id: keywordRow.id,
      position: i + 1,
      url: r.link || null,
      title: r.title || null,
      snippet: r.snippet || null,
      word_count: null,
      headings: r.sitelinks ? { sitelinks: r.sitelinks } : null,
    }));

    if (serpEntries.length > 0) {
      await supabase.from("serp_results").insert(serpEntries);
    }

    // 5. Get researcher model
    const { data: assignment } = await supabaseAdmin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "researcher")
      .single();
    const model = assignment?.model_key || "google/gemini-2.5-flash";

    // 6. Prepare data for AI analysis
    const competitorSummary = organicResults.slice(0, 10).map((r: any, i: number) => (
      `${i + 1}. "${r.title}" - ${r.link}\n   Snippet: ${r.snippet || "N/A"}`
    )).join("\n\n");

    const paaQuestions = peopleAlsoAsk.map((p: any) => p.question || p.title).filter(Boolean);

    const langName = language === "ru" ? "Russian" : language === "de" ? "German" : language === "fr" ? "French" : language === "es" ? "Spanish" : language === "it" ? "Italian" : language === "pt" ? "Portuguese" : language === "ja" ? "Japanese" : language === "zh" ? "Chinese" : language === "ko" ? "Korean" : language === "ar" ? "Arabic" : language === "tr" ? "Turkish" : language === "pl" ? "Polish" : language === "nl" ? "Dutch" : language === "uk" ? "Ukrainian" : "English";

    const systemPrompt = `You are an expert SEO analyst. Analyze Google search results for the given keyword and provide actionable insights. IMPORTANT: All text output (topics, questions, gaps, keywords, headings) MUST be written in ${langName}. Return structured data via the provided tool.`;

    const userPrompt = `Keyword: "${keyword}"
Geo: ${geo || "US"}, Language: ${language || "en"}

TOP-10 Google Results:
${competitorSummary}

People Also Ask questions found:
${paaQuestions.map((q: string, i: number) => `${i + 1}. ${q}`).join("\n")}

Analyze these results and identify:
1. Must-cover topics that ALL top results address
2. Content gaps - topics that are missing or underserved  
3. The top 5 questions users are asking (from PAA and inferred from content)
4. Search intent classification
5. LSI keywords to include

IMPORTANT: Write ALL output text in ${langName}.`;

    // 7. Call AI
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
            name: "return_serp_analysis",
            description: "Return structured SERP analysis results",
            parameters: {
              type: "object",
              properties: {
                intent: {
                  type: "string",
                  enum: ["informational", "transactional", "navigational", "commercial"],
                  description: "Primary search intent"
                },
                must_cover_topics: {
                  type: "array",
                  items: { type: "string" },
                  description: "Topics that must be covered based on top results"
                },
                content_gaps: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      topic: { type: "string" },
                      reason: { type: "string" }
                    },
                    required: ["topic", "reason"]
                  },
                  description: "Content gaps and opportunities"
                },
                top_questions: {
                  type: "array",
                  items: { type: "string" },
                  description: "Top 5 user questions"
                },
                lsi_keywords: {
                  type: "array",
                  items: { type: "string" },
                  description: "LSI/related keywords to include"
                },
                difficulty_estimate: {
                  type: "string",
                  enum: ["easy", "medium", "hard", "very_hard"],
                  description: "Estimated ranking difficulty"
                },
                recommended_word_count: {
                  type: "number",
                  description: "Recommended article word count"
                },
                recommended_headings: {
                  type: "array",
                  items: { type: "string" },
                  description: "Recommended H2/H3 headings for the article"
                },
                competitor_tables: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      topic: { type: "string", description: "What the table compares or describes" },
                      columns: { type: "array", items: { type: "string" }, description: "Suggested column headers" }
                    },
                    required: ["topic", "columns"]
                  },
                  description: "Tables found or inferred from competitor content that should be included"
                },
                competitor_lists: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      topic: { type: "string", description: "What the list covers" },
                      type: { type: "string", enum: ["bullet", "numbered", "checklist"], description: "List type" },
                      estimated_items: { type: "number", description: "Approximate number of items" }
                    },
                    required: ["topic", "type"]
                  },
                  description: "Lists found or inferred from competitor content that should be included"
                }
              },
              required: ["intent", "must_cover_topics", "content_gaps", "top_questions", "lsi_keywords", "difficulty_estimate", "recommended_word_count", "recommended_headings", "competitor_tables", "competitor_lists"],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "return_serp_analysis" } },
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

    // 8. Update keyword with analysis data
    await supabase.from("keywords").update({
      intent: analysis.intent,
      lsi_keywords: analysis.lsi_keywords,
      questions: analysis.top_questions,
      difficulty: analysis.difficulty_estimate === "easy" ? 20 : analysis.difficulty_estimate === "medium" ? 50 : analysis.difficulty_estimate === "hard" ? 75 : 90,
      must_cover_topics: analysis.must_cover_topics || [],
      content_gaps: analysis.content_gaps || [],
      recommended_headings: analysis.recommended_headings || [],
    }).eq("id", keywordRow.id);

    // 9. Log usage
    const tokensUsed = aiData.usage?.total_tokens || 0;
    await supabaseAdmin.from("usage_logs").insert({
      user_id: user.id,
      action: "smart_research",
      model_used: model,
      tokens_used: tokensUsed,
    });

    return new Response(JSON.stringify({
      keyword_id: keywordRow.id,
      keyword: keyword.trim(),
      competitors: organicResults.slice(0, 10).map((r: any, i: number) => ({
        position: i + 1,
        url: r.link,
        title: r.title,
        snippet: r.snippet,
      })),
      people_also_ask: paaQuestions,
      analysis,
      model_used: model,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("smart-research error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
