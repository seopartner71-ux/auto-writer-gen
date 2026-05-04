// AI translation RU<->EN. Saves into translated_title_en / translated_content_en.
// If source language is EN, the translation goes the other way (RU stored in same fields prefixed).
// For simplicity we store EN translation when source is RU, and we do not overwrite when source is EN
// (we return the RU translation in the response and let the client decide).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { articleId, target } = await req.json().catch(() => ({}));
    if (!articleId) return json({ error: "articleId required" }, 400);

    const admin = createClient(url, serviceKey);
    const { data: art } = await admin
      .from("articles")
      .select("id, user_id, title, content, language")
      .eq("id", articleId).maybeSingle();
    if (!art || art.user_id !== user.id) return json({ error: "Not found" }, 404);

    const sourceLang = (art.language || "ru").startsWith("en") ? "en" : "ru";
    const targetLang = target === "ru" || target === "en" ? target : (sourceLang === "ru" ? "en" : "ru");
    if (targetLang === sourceLang) return json({ error: "source equals target" }, 400);

    const html = String(art.content || "");
    if (html.length > 60000) return json({ error: "article too long (max 60k chars)" }, 400);

    const sys = `You are a professional translator. Translate the given HTML article from ${sourceLang.toUpperCase()} to ${targetLang.toUpperCase()}. STRICT rules:
- Preserve ALL HTML tags, attributes, structure exactly.
- Translate only text content, not tag names or attribute values (except alt/title text).
- Keep proper nouns and brand names as-is.
- Natural, fluent prose. No literal word-for-word.
- Output ONLY the translated HTML. No preamble, no markdown fences.`;

    const titleSys = `Translate this title from ${sourceLang.toUpperCase()} to ${targetLang.toUpperCase()}. Output ONLY the translated title, nothing else.`;

    const callAI = async (system: string, content: string) => {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "system", content: system }, { role: "user", content }],
        }),
      });
      if (!r.ok) throw new Error(`AI gateway ${r.status}`);
      const d = await r.json();
      return String(d?.choices?.[0]?.message?.content || "").trim();
    };

    const [translatedTitle, translatedHtml] = await Promise.all([
      callAI(titleSys, String(art.title || "")),
      callAI(sys, html),
    ]);

    if (!translatedHtml) return json({ error: "empty translation" }, 500);

    // Persist EN translation if target is EN; otherwise just return.
    if (targetLang === "en") {
      await admin.from("articles").update({
        translated_title_en: translatedTitle,
        translated_content_en: translatedHtml,
      }).eq("id", articleId);
    }

    return json({ title: translatedTitle, content: translatedHtml, target: targetLang });
  } catch (e: any) {
    console.error("[translate-article]", e);
    return json({ error: e?.message || "Unknown" }, 500);
  }
});