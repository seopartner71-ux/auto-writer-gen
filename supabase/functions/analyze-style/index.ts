import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type StyleAnalysis = {
  paragraph_length: "short" | "medium" | "long";
  avg_sentences_per_paragraph: number;
  sentence_complexity: "simple" | "moderate" | "complex";
  tone_description: string;
  metaphor_usage: "none" | "rare" | "moderate" | "frequent";
  emoji_frequency: "none" | "rare" | "moderate" | "frequent";
  vocabulary_level: "basic" | "intermediate" | "advanced" | "expert";
  formality: "casual" | "neutral" | "formal" | "academic";
  stop_words: string[];
  stylistic_devices: string[];
  recommended_system_prompt: string;
};

function extractStyleAnalysis(aiData: any): StyleAnalysis {
  const toolArgs = aiData?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (toolArgs) return JSON.parse(toolArgs);

  const rawContent = aiData?.choices?.[0]?.message?.content;
  if (typeof rawContent !== "string" || !rawContent.trim()) {
    throw new Error("Failed to parse AI response");
  }

  let cleaned = rawContent
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  cleaned = cleaned
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, "");

  return JSON.parse(cleaned);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

    if (!supabaseUrl || !serviceRoleKey || !supabaseAnonKey) {
      throw new Error("Backend environment is not configured");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const sample_text = typeof body.sample_text === "string"
      ? body.sample_text
      : typeof body.text === "string"
        ? body.text
        : "";

    if (!sample_text.trim() || sample_text.trim().length < 50) {
      return new Response(
        JSON.stringify({ error: "Текст-образец должен содержать минимум 50 символов" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const normalizedSample = sample_text.trim();
    if (normalizedSample.length > 20000) {
      return new Response(
        JSON.stringify({ error: "Текст-образец слишком длинный (макс. 20 000 символов)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const compactSample = normalizedSample.slice(0, 2500);
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { data: assignment } = await supabaseAdmin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "researcher")
      .single();

    const model = assignment?.model_key || "google/gemini-2.5-flash-lite";
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    const aiUrl = LOVABLE_API_KEY
      ? "https://ai.gateway.lovable.dev/v1/chat/completions"
      : "https://openrouter.ai/api/v1/chat/completions";
    const aiAuthKey = LOVABLE_API_KEY || OPENROUTER_API_KEY;

    if (!aiAuthKey) throw new Error("AI key not configured");

    const systemPrompt = `You are an expert writing style analyst. Analyze the text and return ONLY a valid JSON object with these exact fields: paragraph_length, avg_sentences_per_paragraph, sentence_complexity, tone_description, metaphor_usage, emoji_frequency, vocabulary_level, formality, stop_words, stylistic_devices, recommended_system_prompt. Keep arrays concise and keep recommended_system_prompt practical.`;

    const aiController = new AbortController();
    const aiTimeout = setTimeout(() => aiController.abort(), 15000);

    const response = await fetch(aiUrl, {
      method: "POST",
      signal: aiController.signal,
      headers: {
        Authorization: `Bearer ${aiAuthKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Analyze this text sample and return JSON only:\n\n${compactSample}` },
        ],
        temperature: 0.2,
        max_tokens: 600,
        response_format: { type: "json_object" },
      }),
    });

    clearTimeout(aiTimeout);

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiData = await response.json();
    const styleAnalysis = extractStyleAnalysis(aiData);

    await supabaseAdmin.from("usage_logs").insert({
      user_id: user.id,
      action: "analyze_style",
      model_used: model,
      tokens_used: aiData.usage?.total_tokens || 0,
    });

    return new Response(JSON.stringify({ style_analysis: styleAnalysis, model_used: model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-style error:", e);
    const msg = e instanceof Error
      ? e.name === "AbortError"
        ? "Анализ занял слишком много времени, попробуйте более короткий фрагмент текста"
        : e.message
      : "Unknown error";
    const status = msg.includes("Unauthorized")
      ? 401
      : msg.includes("слишком много времени")
        ? 504
        : 500;

    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});