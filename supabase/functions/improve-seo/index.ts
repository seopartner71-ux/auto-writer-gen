// Improve article SEO by inserting missing NLP terms and adjusting keyword density.
// Body: { article_id, content, keyword, missing_terms[], current_density, target_density, word_count }
// Returns: { ok: true, content, density, covered, score?, improve_count }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function countTags(html: string) {
  return {
    h2: (html.match(/<h2[\s>]/gi) || []).length,
    h: (html.match(/<h[1-6][\s>]/gi) || []).length,
    a: (html.match(/<a\s[^>]*href=/gi) || []).length,
    table: (html.match(/<table[\s>]/gi) || []).length,
    words: stripHtml(html).split(/\s+/).filter(Boolean).length,
  };
}
function htmlIntegrityOk(before: string, after: string): { ok: boolean; reason?: string } {
  const b = countTags(before), a = countTags(after);
  if (a.words < b.words * 0.95) return { ok: false, reason: `text shrunk ${b.words}->${a.words}` };
  if (a.words > b.words * 1.6) return { ok: false, reason: `text inflated ${b.words}->${a.words}` };
  if (a.h2 < b.h2) return { ok: false, reason: `H2 lost ${b.h2}->${a.h2}` };
  if (a.h < b.h) return { ok: false, reason: `headings lost ${b.h}->${a.h}` };
  if (a.a < b.a) return { ok: false, reason: `links lost ${b.a}->${a.a}` };
  if (a.table < b.table) return { ok: false, reason: `tables lost` };
  return { ok: true };
}

function countKeyword(text: string, kw: string): number {
  if (!kw) return 0;
  try {
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return (text.match(re) || []).length;
  } catch { return 0; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const orKey = Deno.env.get("OPENROUTER_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const article_id: string = body.article_id;
    const keyword: string = String(body.keyword || "").trim();
    const missing_terms: string[] = Array.isArray(body.missing_terms) ? body.missing_terms.filter(Boolean).slice(0, 8) : [];
    const current_density = Number(body.current_density || 0);
    const target_density = Number(body.target_density || 1.5);
    const word_count = Number(body.word_count || 0);

    if (!article_id) return json({ error: "article_id required" }, 400);

    const { data: art } = await admin.from("articles")
      .select("id,user_id,content,title,seo_improve_count")
      .eq("id", article_id).maybeSingle();
    if (!art || art.user_id !== user.id) return json({ error: "Article not found" }, 404);

    const improveCount = Number((art as any).seo_improve_count || 0);
    if (improveCount >= 3) {
      return json({ error: "Достигнут лимит улучшений (3). Отредактируйте текст вручную.", limit_reached: true }, 429);
    }

    const original: string = art.content || body.content || "";
    if (!original || original.length < 100) return json({ error: "Статья слишком короткая" }, 400);

    const density_gap = Math.max(0, target_density - current_density);
    const keywords_to_add = Math.max(0, Math.min(20, Math.round((density_gap / 100) * (word_count || stripHtml(original).split(/\s+/).length))));
    const currentKwCount = countKeyword(original, keyword);
    const targetKwCount = currentKwCount + keywords_to_add;

    if (missing_terms.length === 0 && keywords_to_add === 0) {
      return json({ error: "Нечего улучшать — SEO уже в норме" }, 400);
    }

    const sys = "Ты SEO-редактор. Улучшаешь текст органично. Возвращаешь ТОЛЬКО исправленный HTML, без комментариев, объяснений и markdown-обёрток. Сохраняй все HTML теги, заголовки H1/H2/H3, структуру, ссылки и таблицы. Сохраняй авторский стиль и тон. Не меняй факты и цифры.";

    const tasks: string[] = [];
    if (missing_terms.length > 0) {
      tasks.push(`ЗАДАЧА 1 — Вставь эти термины естественно в текст (каждый минимум 1 раз):
${missing_terms.map(t => `- ${t}`).join("\n")}

Правила:
- Только там где это логично по смыслу
- Можно добавить новое предложение или расширить абзац
- Нельзя менять факты, цифры, заголовки H1/H2/H3`);
    }
    if (keywords_to_add > 0 && keyword) {
      tasks.push(`ЗАДАЧА 2 — Добавь ключевую фразу "${keyword}" ещё ${keywords_to_add} раз в текст.
Текущих вхождений: ${currentKwCount}
Целевых вхождений: ${targetKwCount}

Правила:
- Только там где звучит естественно
- Можно менять падеж и форму слова
- Нельзя ставить ключ два раза подряд в одном абзаце
- Нельзя ставить ключ в каждом предложении`);
    }

    const usr = `Улучши SEO текста органично:

${tasks.join("\n\n")}

ИСХОДНЫЙ ТЕКСТ:
${original}`;

    let improved: string | null = null;
    if (orKey) {
      try {
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${orKey}` },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
            max_tokens: 12000,
            temperature: 0.6,
          }),
        });
        if (r.ok) {
          const data = await r.json();
          improved = data?.choices?.[0]?.message?.content || null;
        } else {
          console.error("[improve-seo] OR error", r.status, await r.text());
        }
      } catch (e) { console.error("[improve-seo] OR exception", e); }
    }
    if (!improved && lovableKey) {
      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${lovableKey}` },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
          }),
        });
        if (r.ok) {
          const data = await r.json();
          improved = data?.choices?.[0]?.message?.content || null;
        }
      } catch (e) { console.error("[improve-seo] gateway exception", e); }
    }

    if (!improved || improved.length < 200) {
      return json({ error: "Не удалось получить улучшенную версию от модели" }, 502);
    }

    const candidate = improved.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const integrity = htmlIntegrityOk(original, candidate);
    if (!integrity.ok) {
      console.warn("[improve-seo] rejected:", integrity.reason);
      return json({ error: `Результат отклонён: ${integrity.reason}` }, 422);
    }

    // Validate density not over-spammed
    const newWords = stripHtml(candidate).split(/\s+/).filter(Boolean).length;
    const newKwCount = countKeyword(candidate, keyword);
    const newDensity = newWords > 0 ? (newKwCount / newWords) * 100 : 0;
    if (keyword && Math.abs(newDensity - target_density) > 0.7 && newDensity > target_density) {
      console.warn("[improve-seo] density overshoot", newDensity, "vs target", target_density);
      // soft warning, still accept if not extreme
      if (newDensity > target_density + 1.5) {
        return json({ error: `Переспам ключа: ${newDensity.toFixed(1)}% при цели ${target_density.toFixed(1)}%` }, 422);
      }
    }

    // Snapshot before saving
    try {
      await admin.from("article_versions").insert({
        article_id, user_id: user.id, title: art.title ?? null,
        content: original, reason: "auto",
        word_count: stripHtml(original).split(/\s+/).filter(Boolean).length,
        metadata: { source: "improve-seo", note: "До SEO улучшения (авто)" },
      } as any);
    } catch (e) { console.warn("[improve-seo] snapshot failed", e); }

    await admin.from("articles").update({
      content: candidate,
      seo_improve_count: improveCount + 1,
      updated_at: new Date().toISOString(),
    }).eq("id", article_id);

    // Compute coverage of requested missing terms
    const lower = candidate.toLowerCase();
    const covered = missing_terms.filter(t => lower.includes(t.toLowerCase()));

    return json({
      ok: true,
      content: candidate,
      density: Number(newDensity.toFixed(2)),
      keyword_count: newKwCount,
      word_count: newWords,
      covered_terms: covered,
      improve_count: improveCount + 1,
    });
  } catch (e: any) {
    console.error("[improve-seo] fatal", e);
    return json({ error: e?.message || "Unknown error" }, 500);
  }
});