// Improve article SEO by inserting missing NLP terms and adjusting keyword density.
// Body: { article_id, content, keyword, missing_terms[], current_density, target_density, word_count }
// Returns: { ok: true, content, density, covered, score?, improve_count }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPlanLimit, IMPROVE_LIMITS, normalizePlanKey } from "../_shared/planLimits.ts";

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
    h3: (html.match(/<h3[\s>]/gi) || []).length,
    h: (html.match(/<h[1-6][\s>]/gi) || []).length,
    a: (html.match(/<a\s[^>]*href=/gi) || []).length,
    table: (html.match(/<table[\s>]/gi) || []).length,
    ul: (html.match(/<ul[\s>]/gi) || []).length,
    ol: (html.match(/<ol[\s>]/gi) || []).length,
    li: (html.match(/<li[\s>]/gi) || []).length,
    words: stripHtml(html).split(/\s+/).filter(Boolean).length,
  };
}
function htmlIntegrityOk(before: string, after: string): { ok: boolean; reason?: string } {
  const b = countTags(before), a = countTags(after);
  if (a.words < b.words * 0.95) return { ok: false, reason: `text shrunk ${b.words}->${a.words}` };
  if (a.words > b.words * 1.6) return { ok: false, reason: `text inflated ${b.words}->${a.words}` };
  if (a.h2 < b.h2) return { ok: false, reason: `H2 lost ${b.h2}->${a.h2}` };
  if (a.h3 < b.h3) return { ok: false, reason: `H3 lost ${b.h3}->${a.h3}` };
  if (a.h < b.h) return { ok: false, reason: `headings lost ${b.h}->${a.h}` };
  if (a.a < b.a) return { ok: false, reason: `links lost ${b.a}->${a.a}` };
  if (a.table < b.table) return { ok: false, reason: `tables lost ${b.table}->${a.table}` };
  if (a.ul < b.ul) return { ok: false, reason: `UL lost ${b.ul}->${a.ul}` };
  if (a.ol < b.ol) return { ok: false, reason: `OL lost ${b.ol}->${a.ol}` };
  if (a.li < Math.floor(b.li * 0.9)) return { ok: false, reason: `LI lost ${b.li}->${a.li}` };
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

    const { data: profile } = await admin.from("profiles").select("plan").eq("id", user.id).maybeSingle();
    const planRaw = (profile as any)?.plan ?? null;
    const limit = getPlanLimit(planRaw, IMPROVE_LIMITS);
    console.log("[improve-seo][plan-check] user:", user.id, "plan:", planRaw, "key:", normalizePlanKey(planRaw), "limit:", limit, "used:", improveCount);
    if (improveCount >= limit) {
      return json({
        error: `Лимит улучшений для вашего плана исчерпан (${limit}). Обновите тариф для продолжения.`,
        limit_reached: true,
      }, 429);
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

    // ── Параграф-by-параграф подход ──
    // Извлекаем ТОЛЬКО содержимое <p>...</p> (без вложенных таблиц/списков/figure/script).
    // LLM получает массив абзацев и возвращает JSON {id: improved_text}.
    // Вся структура (H2/H3/таблицы/списки/JSON-LD/ссылки внутри других тегов) физически
    // не отдаётся модели и поэтому не может быть потеряна.

    type Para = { id: string; text: string; full: string };
    const paragraphs: Para[] = [];
    const placeholders: string[] = [];
    let pIdx = 0;
    // Match <p ...>...</p> blocks at top level. Skip <p> внутри <li>/<td> по эвристике (если содержит вложенные блочные теги).
    const skeleton = original.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (full, inner) => {
      const inn = String(inner).trim();
      if (!inn) return full;
      // Пропускаем <p> с вложенной разметкой (img/figure/script) — не трогаем
      if (/<\s*(img|figure|script|table|iframe)\b/i.test(inn)) return full;
      // Текст < 30 симв — пропускаем
      const plainLen = inn.replace(/<[^>]+>/g, "").trim().length;
      if (plainLen < 30) return full;
      const id = `__P_${pIdx++}__`;
      paragraphs.push({ id, text: inn, full });
      placeholders.push(id);
      return `<p>${id}</p>`;
    });

    if (paragraphs.length === 0) {
      return json({
        ok: false,
        content: original,
        error: "В статье нет редактируемых абзацев для улучшения.",
      }, 200);
    }

    const sys = `АБСОЛЮТНЫЕ ЗАПРЕТЫ (нарушение = провал задачи):
1. НИКОГДА не изменять содержимое тегов <h1> <h2> <h3> <h4> <h5> <h6>. Заголовки трогать запрещено.
2. Термины вставлять ТОЛЬКО внутрь тегов <p>.
3. Если термин не вписывается органично в <p> — пропустить его, не вставлять насильно.
4. НИКОГДА не использовать английские слова (Honestly, Look, Note, However, Important и т.д.) в русскоязычном тексте.
5. НИКОГДА не обрывать предложения на полуслове, не оставлять висящие союзы и многоточия в конце.

Ты SEO-редактор. Получаешь список абзацев. Для каждого возвращаешь улучшенную версию того же абзаца.

СТРОГИЕ ПРАВИЛА:
- Возвращай ТОЛЬКО валидный JSON вида {"paragraphs":[{"id":"__P_0__","text":"..."},...]}
- Сохраняй ВСЕ inline-теги внутри текста: <strong>, <em>, <a href="..."> — не удаляй и не меняй href.
- НЕ добавляй <p>, <h2>, <ul>, <table>, <script> и любые блочные теги.
- НЕ используй markdown.
- Сохраняй авторский стиль, факты, цифры.
- Длина абзаца не должна сильно отличаться (±40%).
- Если термин не подходит ни в один абзац — лучше пропустить, чем испортить текст.`;

    const tasksHints: string[] = [];
    if (missing_terms.length > 0) {
      tasksHints.push(`Вставь органично эти термины (распредели по разным абзацам, каждый минимум 1 раз):
${missing_terms.map(t => `- ${t}`).join("\n")}`);
    }
    if (keywords_to_add > 0 && keyword) {
      tasksHints.push(`Добавь ключевую фразу "${keyword}" ещё ~${keywords_to_add} раз суммарно по всем абзацам (можно менять падеж). Сейчас вхождений: ${currentKwCount}, цель: ${targetKwCount}. Не более 1 ключа на абзац.`);
    }

    const inputJson = JSON.stringify({
      paragraphs: paragraphs.map(p => ({ id: p.id, text: p.text })),
    });

    const usr = `${tasksHints.join("\n\n")}

Верни JSON для всех ${paragraphs.length} абзацев. ID не менять.

ВХОД:
${inputJson}`;

    let improvedRaw: string | null = null;
    const callModel = async (url: string, key: string, withMaxTokens: boolean) => {
      const body: any = {
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        temperature: 0.5,
        response_format: { type: "json_object" },
      };
      if (withMaxTokens) body.max_tokens = 16000;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) { console.error("[improve-seo] model error", r.status, await r.text().catch(() => "")); return null; }
      const data = await r.json();
      return data?.choices?.[0]?.message?.content || null;
    };
    if (orKey) {
      try { improvedRaw = await callModel("https://openrouter.ai/api/v1/chat/completions", orKey, true); }
      catch (e) { console.error("[improve-seo] OR exception", e); }
    }
    if (!improvedRaw && lovableKey) {
      try { improvedRaw = await callModel("https://ai.gateway.lovable.dev/v1/chat/completions", lovableKey, false); }
      catch (e) { console.error("[improve-seo] gateway exception", e); }
    }
    if (!improvedRaw) {
      return json({ ok: false, content: original, error: "Не удалось получить ответ от модели. Попробуйте снова." }, 200);
    }

    let parsed: any = null;
    try {
      const cleaned = improvedRaw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("[improve-seo] JSON parse failed", e);
      return json({ ok: false, content: original, error: "Модель вернула некорректный ответ. Попробуйте снова." }, 200);
    }
    const improvedList: Array<{ id: string; text: string }> = Array.isArray(parsed?.paragraphs) ? parsed.paragraphs : [];
    const improvedMap = new Map<string, string>();
    for (const it of improvedList) {
      if (it && typeof it.id === "string" && typeof it.text === "string") {
        // Жёстко вычищаем блочные теги, если модель их всё-таки добавила
        const safe = it.text
          .replace(/<\/?(?:h[1-6]|p|div|section|article|table|thead|tbody|tr|td|th|ul|ol|li|figure|figcaption|script|iframe)[^>]*>/gi, "")
          .trim();
        improvedMap.set(it.id, safe);
      }
    }

    // Собираем финальный HTML, подставляя улучшенные абзацы вместо плейсхолдеров.
    let candidate = skeleton;
    let replaced = 0;
    for (const p of paragraphs) {
      const newInner = improvedMap.get(p.id);
      if (newInner && newInner.length >= 10) {
        candidate = candidate.replace(`<p>${p.id}</p>`, `<p>${newInner}</p>`);
        replaced++;
      } else {
        // не заменили — возвращаем оригинальный <p>
        candidate = candidate.replace(`<p>${p.id}</p>`, p.full);
      }
    }

    if (replaced === 0) {
      return json({ ok: false, content: original, error: "Модель не вернула ни одного улучшенного абзаца. Попробуйте снова." }, 200);
    }

    // Контрольная проверка целостности структуры — структура НЕ должна меняться вообще
    const integrity = htmlIntegrityOk(original, candidate);
    if (!integrity.ok) {
      console.warn("[improve-seo] integrity check failed:", integrity.reason);
      return json({
        ok: false,
        content: original,
        error: `Не удалось улучшить без потери форматирования (${integrity.reason}). Попробуйте снова.`,
      }, 200);
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