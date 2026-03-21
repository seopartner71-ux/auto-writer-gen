import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const { content } = await req.json();
    if (!content || content.length < 100) {
      throw new Error("Content too short for analysis");
    }

    // Take first ~3000 chars for analysis
    const sample = content.slice(0, 3000);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `You are a content uniqueness analyzer. Analyze the provided text and return a JSON assessment.
            
Evaluate:
1. overall_score (0-100): How unique/original the text appears
2. ai_probability (0-100): Likelihood the text was AI-generated
3. cliche_phrases: Array of found cliche/template phrases
4. repetitive_patterns: Array of repetitive sentence structures found
5. unique_elements: Array of unique/original elements in the text
6. recommendation: One sentence suggestion to improve uniqueness

Return ONLY valid JSON, no markdown.`
          },
          {
            role: "user",
            content: `Analyze this text for uniqueness:\n\n${sample}`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_uniqueness",
              description: "Report uniqueness analysis results",
              parameters: {
                type: "object",
                properties: {
                  overall_score: { type: "number", description: "Uniqueness score 0-100" },
                  ai_probability: { type: "number", description: "AI-generated probability 0-100" },
                  cliche_phrases: { type: "array", items: { type: "string" }, description: "Found cliché phrases" },
                  repetitive_patterns: { type: "array", items: { type: "string" }, description: "Repetitive patterns" },
                  unique_elements: { type: "array", items: { type: "string" }, description: "Unique elements" },
                  recommendation: { type: "string", description: "Improvement suggestion" },
                },
                required: ["overall_score", "ai_probability", "cliche_phrases", "repetitive_patterns", "unique_elements", "recommendation"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "report_uniqueness" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    let analysis;
    if (toolCall?.function?.arguments) {
      analysis = JSON.parse(toolCall.function.arguments);
    } else {
      // Fallback: try parsing from content
      const content_text = data.choices?.[0]?.message?.content || "{}";
      analysis = JSON.parse(content_text);
    }

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("check-uniqueness error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
