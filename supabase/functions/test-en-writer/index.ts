// Standalone test harness for the new EN writer prompts.
// Bypasses auth / DB / credits / SERP research — feeds a minimal fake
// StealthPromptInput through the SAME `generateStealthPrompt` +
// `buildNewArticleUserPrompt` used by generate-article, then calls
// OpenRouter directly and returns the full markdown.
//
// This lets us eyeball the raw prompt output for defect classes
// (anonymous authority, LLM clichés, keyword-stuffing, em-dash abuse,
// numeric inconsistency, symmetric paragraphs) without spinning up a real
// user + keyword + credits + queue pipeline.
//
// NOT for production traffic. `verify_jwt = false`, unauthenticated.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  generateStealthPrompt,
  buildNewArticleUserPrompt,
  type StealthPromptInput,
} from "../_shared/promptBuilder.ts";
import { buildSerpClusterDisciplineAddon } from "../_shared/serpClusterPrompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const seed_keyword = String(body.seed_keyword || "").trim();
    if (!seed_keyword) {
      return new Response(JSON.stringify({ error: "seed_keyword required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const geoLocation = body.geoLocation ?? null;
    const model = body.model || "google/gemini-2.5-pro-preview";
    const language = String(body.language || "en").toLowerCase() === "ru" ? "ru" : "en";

    // Minimal fake context — no SERP/entity/LSI. We are testing the writer
    // prompt's own quality, not the research pipeline.
    const input: StealthPromptInput = {
      authorProfile: null,
      serpData: [],
      lsiKeywords: [],
      userStructure: [],
      keyword: {
        seed_keyword,
        intent: body.intent || "informational",
        difficulty: 40,
        language,
        questions: [],
      },
      geoLocation,
    };
    const { system: baseSystem } = generateStealthPrompt(input);
    // Mirror generate-article's real addon stack so we can reproduce the
    // language-slip bug through the SAME code path (minus SERP entities).
    const system = baseSystem + buildSerpClusterDisciplineAddon(language);
    const user = buildNewArticleUserPrompt(
      input.keyword, "", "", "", "",
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, geoLocation, null,
    );

    // Resolve OpenRouter key from api_keys table (same pattern as generate-article).
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: keyRow } = await supabaseAdmin
      .from("api_keys")
      .select("api_key")
      .eq("provider", "openrouter")
      .eq("is_valid", true)
      .single();
    const OPENROUTER_API_KEY = keyRow?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      return new Response(JSON.stringify({ error: "OpenRouter key missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "test-en-writer",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 6000,
        temperature: 0.8,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: "openrouter_error", detail: data }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const article = data?.choices?.[0]?.message?.content || "";
    return new Response(JSON.stringify({
      seed_keyword,
      model,
      usage: data?.usage,
      article,
      system_prompt_length: system.length,
      user_prompt_length: user.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: "exception", detail: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});