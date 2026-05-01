import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logCost } from "../_shared/costLogger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Fast outline generator for sectioned streaming.
 *
 * Body:
 *   {
 *     keyword: string,
 *     language?: string,        // 'ru' | 'en' ...
 *     existing_outline?: { text: string }[]   // if provided, just normalize
 *   }
 *
 * Returns:
 *   { h1: string, h2: string[] }
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return j({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return j({ error: "Unauthorized" }, 401);
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload.sub as string;
    if (!userId) return j({ error: "Unauthorized" }, 401);

    const { keyword, language = "ru", existing_outline } = await req.json();
    if (!keyword || typeof keyword !== "string") return j({ error: "keyword required" }, 400);

    // If user already has an outline (from Research step), just reuse it.
    if (Array.isArray(existing_outline) && existing_outline.length >= 3) {
      const items = existing_outline
        .map((x: any) => (typeof x === "string" ? x : (x?.text || x?.title)))
        .filter((s: any) => typeof s === "string" && s.trim().length > 0)
        .map((s: string) => s.replace(/^#+\s*/, "").trim());
      const h1 = items[0];
      const h2 = items.slice(1, 9);
      if (h1 && h2.length >= 2) return j({ h1, h2, source: "existing" });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return j({ error: "LOVABLE_API_KEY not configured" }, 500);

    const langName: Record<string, string> = {
      ru: "русском", en: "English", es: "Spanish", de: "German",
      fr: "French", pt: "Portuguese", uk: "Ukrainian",
    };
    const langLabel = langName[language] || "English";

    const sys = `Ты SEO-редактор. Дай SEO-оптимизированную структуру статьи на ${langLabel} языке.
Жёсткие правила:
- Без жирного, без эмодзи.
- Тире заменяй на дефис (-).
${language === "ru" ? "- В русском НИКОГДА не используй букву 'ё', только 'е'." : ""}`;

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: `Тема: "${keyword}"\nСгенерируй H1 и 5-7 H2 подзаголовков, покрывающих все основные подтемы.`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_outline",
            description: "Return article outline.",
            parameters: {
              type: "object",
              properties: {
                h1: { type: "string" },
                h2: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 8 },
              },
              required: ["h1", "h2"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_outline" } },
      }),
    });

    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => "");
      if (upstream.status === 429) return j({ error: "Rate limit" }, 429);
      if (upstream.status === 402) return j({ error: "Lovable AI credits depleted" }, 402);
      return j({ error: `Gateway ${upstream.status}: ${txt.slice(0, 150)}` }, 500);
    }

    const data = await upstream.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let parsed: any = null;
    try { parsed = JSON.parse(call || "{}"); } catch { /* ignore */ }
    const h1 = String(parsed?.h1 || keyword).replace(/ё/g, "е").replace(/Ё/g, "Е").replace(/[—–]/g, "-").trim();
    const h2 = Array.isArray(parsed?.h2)
      ? parsed.h2.map((s: string) => String(s).replace(/ё/g, "е").replace(/Ё/g, "Е").replace(/[—–]/g, "-").trim()).filter(Boolean)
      : [];

    if (!h1 || h2.length < 2) return j({ error: "Failed to parse outline" }, 500);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await logCost(admin, {
      user_id: userId,
      operation_type: "article_generation",
      model: "google/gemini-2.5-flash-lite",
      tokens_input: data?.usage?.prompt_tokens || 0,
      tokens_output: data?.usage?.completion_tokens || 0,
      metadata: { kind: "outline" },
    });

    return j({ h1, h2, source: "ai" });
  } catch (e) {
    console.error("generate-section-outline error", e);
    return j({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}