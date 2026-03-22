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

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { sample_text } = await req.json();
    if (!sample_text || typeof sample_text !== "string" || sample_text.trim().length < 50) {
      return new Response(
        JSON.stringify({ error: "Текст-образец должен содержать минимум 50 символов" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get researcher model from task assignments
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: assignment } = await supabaseAdmin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "researcher")
      .single();

    const model = assignment?.model_key || "google/gemini-2.5-flash";

    const systemPrompt = `You are an expert writing style analyst. Analyze the provided text sample and return a JSON object describing the author's writing style. 

Return ONLY a valid JSON object with these exact fields:
{
  "paragraph_length": "short" | "medium" | "long",
  "avg_sentences_per_paragraph": <number>,
  "sentence_complexity": "simple" | "moderate" | "complex",
  "tone_description": "<string describing the overall tone>",
  "metaphor_usage": "none" | "rare" | "moderate" | "frequent",
  "emoji_frequency": "none" | "rare" | "moderate" | "frequent",
  "vocabulary_level": "basic" | "intermediate" | "advanced" | "expert",
  "formality": "casual" | "neutral" | "formal" | "academic",
  "stop_words": ["<array of filler words or phrases the author overuses>"],
  "stylistic_devices": ["<array of literary devices used: e.g. rhetorical questions, lists, analogies>"],
  "recommended_system_prompt": "<a system prompt instruction that would make an AI write in this style>"
}

Do not include any text outside the JSON.`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Analyze this text sample:\n\n${sample_text.slice(0, 5000)}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_style_analysis",
              description: "Return the structured style analysis of the text",
              parameters: {
                type: "object",
                properties: {
                  paragraph_length: { type: "string", enum: ["short", "medium", "long"] },
                  avg_sentences_per_paragraph: { type: "number" },
                  sentence_complexity: { type: "string", enum: ["simple", "moderate", "complex"] },
                  tone_description: { type: "string" },
                  metaphor_usage: { type: "string", enum: ["none", "rare", "moderate", "frequent"] },
                  emoji_frequency: { type: "string", enum: ["none", "rare", "moderate", "frequent"] },
                  vocabulary_level: { type: "string", enum: ["basic", "intermediate", "advanced", "expert"] },
                  formality: { type: "string", enum: ["casual", "neutral", "formal", "academic"] },
                  stop_words: { type: "array", items: { type: "string" } },
                  stylistic_devices: { type: "array", items: { type: "string" } },
                  recommended_system_prompt: { type: "string" },
                },
                required: [
                  "paragraph_length", "avg_sentences_per_paragraph", "sentence_complexity",
                  "tone_description", "metaphor_usage", "emoji_frequency", "vocabulary_level",
                  "formality", "stop_words", "stylistic_devices", "recommended_system_prompt",
                ],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_style_analysis" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiData = await response.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    let styleAnalysis;
    if (toolCall?.function?.arguments) {
      styleAnalysis = JSON.parse(toolCall.function.arguments);
    } else {
      // Fallback: try parsing content directly
      const content = aiData.choices?.[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        styleAnalysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Failed to parse AI response");
      }
    }

    // Log usage
    const tokensUsed = aiData.usage?.total_tokens || 0;
    await supabaseAdmin.from("usage_logs").insert({
      user_id: user.id,
      action: "analyze_style",
      model_used: model,
      tokens_used: tokensUsed,
    });

    return new Response(JSON.stringify({ style_analysis: styleAnalysis, model_used: model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-style error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
