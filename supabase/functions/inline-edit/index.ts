// Inline AI editor commands: shorter / longer / simpler / example / expert / rewrite.
// Used by the floating toolbar in the article editor. Gemini Flash for speed and cost.
//
// Cost: ~$0.0002 per command, logged with metadata.kind = 'inline_edit'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logCost } from "../_shared/costLogger.ts";
import { buildStealthSystemAddon } from "../_shared/stealth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const COMMANDS: Record<string, { ru: string; en: string }> = {
  shorter: {
    ru: "Сократи этот текст примерно в 2 раза, сохранив главную мысль и факты. Не добавляй ничего нового.",
    en: "Cut this text roughly in half while keeping the main point and the facts. Do not add anything new.",
  },
  longer: {
    ru: "Расширь этот текст, добавив детали, уточнения и 1-2 примера. Сохрани стиль и смысл оригинала.",
    en: "Expand this text by adding details, clarifications and 1-2 examples. Keep the original tone and meaning.",
  },
  simpler: {
    ru: "Перепиши проще - как будто объясняешь школьнику. Короткие предложения, без терминов и канцелярита.",
    en: "Rewrite this in a simpler way, as if explaining to a teenager. Short sentences, no jargon, no bureaucratic phrasing.",
  },
  example: {
    ru: "Добавь к этому тексту один конкретный пример, кейс или мини-сценарий. Не меняй сам текст - добавь пример в конец абзацем.",
    en: "Add one concrete example, case study, or mini-scenario to this text. Do not change the original - append the example as the closing paragraph.",
  },
  expert: {
    ru: "Перепиши более экспертно: добавь профессиональную терминологию, уточни цифры/механизмы, придай авторитетный тон. Без штампов.",
    en: "Rewrite this more expertly: add professional terminology, sharpen the numbers and mechanics, take an authoritative tone. No clichés.",
  },
  rewrite: {
    ru: "Полностью перепиши этот фрагмент своими словами, сохранив смысл и факты. Меняй структуру предложений и формулировки.",
    en: "Fully rewrite this fragment in your own words while keeping the meaning and the facts. Change sentence structures and phrasing.",
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    if (!apiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { text, command, language = "ru" } = body as {
      text?: string; command?: string; language?: string;
    };
    if (!text || typeof text !== "string") return json({ error: "text required" }, 400);
    if (text.length > 6000) return json({ error: "text too long (max 6000 chars)" }, 400);
    if (!command || !COMMANDS[command]) return json({ error: "unknown command" }, 400);

    const lang = language === "en" ? "en" : "ru";
    const instruction = COMMANDS[command][lang];

    const sys = lang === "en"
      ? "You are a precise editor. Output ONLY the rewritten text. No preamble, no quotes, no markdown fences, no commentary."
      : "Ты редактор. Выводи ТОЛЬКО переписанный текст. Без вступлений, кавычек, markdown-блоков и комментариев.";
    const sysWithStealth = `${sys}\n\n${buildStealthSystemAddon(lang)}`;

    const userMsg = `${instruction}\n\n---\n${text}\n---`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sysWithStealth },
          { role: "user", content: userMsg },
        ],
      }),
    });
    if (!res.ok) {
      const errTxt = await res.text();
      console.error("[inline-edit] AI gateway", res.status, errTxt.slice(0, 200));
      return json({ error: "AI gateway error", status: res.status }, 500);
    }
    const data = await res.json();
    const rewritten = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!rewritten) return json({ error: "empty response" }, 500);

    void logCost(admin, {
      user_id: user.id,
      operation_type: "article_generation" as any,
      model: "google/gemini-2.5-flash",
      tokens_input: data?.usage?.prompt_tokens || 0,
      tokens_output: data?.usage?.completion_tokens || 0,
      metadata: { kind: "inline_edit", command, chars_in: text.length, chars_out: rewritten.length },
    });

    return json({ rewritten, command });
  } catch (e: any) {
    console.error("[inline-edit] fatal", e);
    return json({ error: e?.message || "Unknown error" }, 500);
  }
});
