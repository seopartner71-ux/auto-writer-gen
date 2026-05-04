// Auto-generates SEO meta description (and refines title) for an article.
// Uses Lovable AI (Gemini Flash). Saves directly to the articles row.
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

function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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

    const { articleId } = await req.json().catch(() => ({}));
    if (!articleId) return json({ error: "articleId required" }, 400);

    const admin = createClient(url, serviceKey);
    const { data: art } = await admin
      .from("articles")
      .select("id, user_id, title, content, language, keywords")
      .eq("id", articleId).maybeSingle();
    if (!art || art.user_id !== user.id) return json({ error: "Not found" }, 404);

    const lang = (art.language || "ru").startsWith("en") ? "en" : "ru";
    const plain = stripHtml(String(art.content || "")).slice(0, 4000);
    const kws = Array.isArray(art.keywords) ? art.keywords.slice(0, 5).join(", ") : "";

    const sys = lang === "en"
      ? "You are an SEO editor. Output strict JSON only: {\"title\":string,\"description\":string}. Title: 50-60 chars, includes primary keyword. Description: 140-158 chars, compelling, includes keyword, ends with call-to-action verb. No quotes, no markdown."
      : "Ты SEO-редактор. Верни СТРОГО JSON: {\"title\":string,\"description\":string}. Title: 50-60 символов, с главным ключом. Description: 140-158 символов, цепляющий, с ключом, заканчивается глаголом-призывом. Без кавычек и markdown.";

    const usr = `${lang === "en" ? "Current title" : "Текущий заголовок"}: ${art.title || ""}\n${lang === "en" ? "Keywords" : "Ключи"}: ${kws}\n${lang === "en" ? "Article" : "Статья"}:\n${plain}`;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) {
      if (r.status === 429) return json({ error: "Rate limit" }, 429);
      if (r.status === 402) return json({ error: "Payment required" }, 402);
      return json({ error: "AI gateway error" }, 500);
    }
    const data = await r.json();
    let parsed: any = {};
    try { parsed = JSON.parse(String(data?.choices?.[0]?.message?.content || "{}")); } catch {}
    const newTitle = String(parsed.title || "").trim().slice(0, 70);
    const newDesc = String(parsed.description || "").trim().slice(0, 170);
    if (!newDesc) return json({ error: "empty response" }, 500);

    const update: any = { meta_description: newDesc };
    if (newTitle) update.title = newTitle;
    await admin.from("articles").update(update).eq("id", articleId);

    return json({ title: newTitle, meta_description: newDesc });
  } catch (e: any) {
    console.error("[generate-meta-tags]", e);
    return json({ error: e?.message || "Unknown" }, 500);
  }
});