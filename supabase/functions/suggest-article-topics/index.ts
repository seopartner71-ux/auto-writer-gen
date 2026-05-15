import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

/**
 * suggest-article-topics
 * Free for all users. Given a seed keyword, query Serper top-10, then ask
 * Lovable AI Gateway (gemini-3-flash-preview) to return 5 distinct article
 * angles (H1 + intent + angle + reason). No DB writes, no credit charge.
 */
serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const { keyword, geo, language } = await req.json().catch(() => ({}));
    if (!keyword || typeof keyword !== "string" || keyword.trim().length < 2) {
      return errorResponse("Keyword is required (min 2 chars)", 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Serper key from admin vault (same source as smart-research)
    const { data: serperKey } = await supabaseAdmin
      .from("api_keys")
      .select("api_key")
      .eq("provider", "serper")
      .single();

    let serpItems: Array<{ title: string; snippet: string; link: string }> = [];
    if (serperKey?.api_key) {
      try {
        const r = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": serperKey.api_key, "Content-Type": "application/json" },
          body: JSON.stringify({
            q: keyword.trim(),
            gl: geo || (language === "ru" ? "ru" : "us"),
            hl: language || "ru",
            num: 10,
          }),
        });
        if (r.ok) {
          const j = await r.json();
          serpItems = (j.organic || []).slice(0, 10).map((o: any) => ({
            title: String(o.title || ""),
            snippet: String(o.snippet || ""),
            link: String(o.link || ""),
          }));
        } else {
          console.warn("Serper non-OK:", r.status);
        }
      } catch (e) {
        console.warn("Serper failed:", e);
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return errorResponse("LOVABLE_API_KEY not configured", 500);

    const lang = language === "en" ? "en" : "ru";
    const serpBlock = serpItems.length
      ? serpItems.map((i, idx) => `${idx + 1}. ${i.title}\n   ${i.snippet}`).join("\n")
      : "(SERP пуст или недоступен — предложи темы по общему смыслу запроса.)";

    const systemPrompt = lang === "ru"
      ? `Ты SEO-стратег. Анализируешь топ-10 Google по ключу и предлагаешь 5 РАЗНЫХ углов подачи статьи, которые могут обойти топ. Каждая тема - уникальный угол (не дубль конкурентов). Без воды. Без 'ё' (только 'е'). Без bold. Без emoji.`
      : `You are an SEO strategist. Analyze Google top-10 for the keyword and suggest 5 DIFFERENT article angles that could outrank the top. Each topic must be a unique angle, not a copy of competitors. No fluff, no bold, no emoji.`;

    const userPrompt = lang === "ru"
      ? `Ключевой запрос: "${keyword.trim()}"\n\nТоп-10 Google сейчас:\n${serpBlock}\n\nПредложи 5 углов подачи. Верни через tool call.`
      : `Keyword: "${keyword.trim()}"\n\nGoogle top-10 now:\n${serpBlock}\n\nSuggest 5 angles. Return via tool call.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest_topics",
            description: "Return 5 distinct article angles for the keyword.",
            parameters: {
              type: "object",
              properties: {
                topics: {
                  type: "array",
                  minItems: 5,
                  maxItems: 5,
                  items: {
                    type: "object",
                    properties: {
                      h1: { type: "string", description: "Catchy H1 with the keyword inside (60-80 chars)." },
                      angle: { type: "string", description: "Short angle/positioning (1 sentence)." },
                      intent: { type: "string", enum: ["informational", "commercial", "transactional", "comparison", "how-to"] },
                      reason: { type: "string", description: "Why this angle can outrank current top (1 sentence)." },
                    },
                    required: ["h1", "angle", "intent", "reason"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["topics"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_topics" } },
      }),
    });

    if (aiResp.status === 429) return errorResponse("Слишком много запросов, попробуйте позже", 429);
    if (aiResp.status === 402) return errorResponse("Закончились кредиты Lovable AI", 402);
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      return errorResponse("AI gateway error", 500);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    const argsRaw = toolCall?.function?.arguments;
    if (!argsRaw) return errorResponse("No suggestions returned", 500);

    let parsed: any;
    try { parsed = JSON.parse(argsRaw); } catch { return errorResponse("Bad AI output", 500); }
    const topics = Array.isArray(parsed?.topics) ? parsed.topics.slice(0, 5) : [];
    if (topics.length === 0) return errorResponse("Empty topics list", 500);

    return jsonResponse({ topics, serp_used: serpItems.length });
  } catch (e) {
    console.error("suggest-article-topics error:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});
