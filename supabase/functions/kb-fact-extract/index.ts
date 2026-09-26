// Admin-only: reads client site pages (r.jina.ai reader, direct fetch fallback)
// and asks OpenRouter to extract verifiable facts for the Knowledge Base (GEO)
// generator. Every fact carries its source URL and status "needs_confirmation".
// No ratings, no comparisons, no marketing claims.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdmin } from "../_shared/auth.ts";
import { withTimeout } from "../_shared/withTimeout.ts";
import { logLLM } from "../_shared/costLogger.ts";

const MAX_URLS = 10;
const PAGE_CHARS = 7000;

const SYSTEM_PROMPT = `Ты извлекаешь проверяемые факты для открытой технической базы знаний компании.
На вход - тексты страниц сайта компании с их URL.

Извлекай ТОЛЬКО факты, прямо написанные в тексте: реквизиты, адрес, город, виды услуг, стандарты (ГОСТ, DIN, EN, ISO, SAE), технические параметры с единицами, типы изделий, сертификаты, география поставки.
ЗАПРЕЩЕНО: оценочные слова (лучший, надежный, лидер, оптимальный), сравнения с конкурентами, рейтинги, обещания, домыслы, общие знания не из текста.
Цены, сроки и наличие НЕ извлекай - они проверяются на сайте.

Для каждого факта:
- topic: одно из company | geography | contacts | certification | service | product | standard | parameter | other
- statement: одно короткое утверждение без рекламы
- parameter, unit, value: заполняй, если это технический параметр, иначе пустые строки
- standard: стандарт, если упомянут, иначе ""
- source_url: URL страницы, где найден факт (строго из входа)

Не используй букву "ё", пиши "е". Не используй markdown и жирный шрифт.
Ответ строго валидный JSON:
{"company":{"name":"","legal_name":"","city":"","description":""},"facts":[{"topic":"","statement":"","parameter":"","unit":"","value":"","standard":"","source_url":""}]}
description - 2-3 нейтральных предложения о деятельности без оценок.`;

const clean = (v: unknown, max = 400): string =>
  String(v ?? "").replace(/\*\*/g, "").replace(/ё/g, "е").replace(/Ё/g, "Е")
    .replace(/[—–]/g, "-").replace(/\s+/g, " ").trim().slice(0, max);

const BANNED = /(лучш|лидер|надежн\w* партнер|оптимальн\w* выбор|номер один|№\s?1|самы[йе] )/i;

function htmlToText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

async function readPage(url: string): Promise<{ url: string; text: string; ok: boolean }> {
  const jinaKey = Deno.env.get("JINA_API_KEY");
  try {
    const res = await withTimeout(fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain", "X-Return-Format": "text", ...(jinaKey ? { Authorization: `Bearer ${jinaKey}` } : {}) },
    }), 25_000, "reader timeout");
    if (res.ok) {
      const text = (await res.text()).slice(0, PAGE_CHARS);
      if (text.trim().length > 40) return { url, text, ok: true };
    }
  } catch { /* fallback */ }
  try {
    const res = await withTimeout(fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SeoModuleBot/1.0)" } }), 20_000, "direct timeout");
    if (!res.ok) return { url, text: "", ok: false };
    const text = htmlToText(await res.text()).slice(0, PAGE_CHARS);
    return { url, text, ok: text.length > 40 };
  } catch {
    return { url, text: "", ok: false };
  }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const forbidden = await requireAdmin(auth);
    if (forbidden) return forbidden;

    let body: { urls?: unknown } = {};
    try { body = await req.json(); } catch { /* empty */ }
    const urls = (Array.isArray(body.urls) ? body.urls : [])
      .map((u) => String(u ?? "").trim())
      .filter((u) => /^https?:\/\/[^\s]+$/i.test(u))
      .filter((u, i, a) => a.indexOf(u) === i)
      .slice(0, MAX_URLS);
    if (!urls.length) return errorResponse("Укажите хотя бы одну ссылку (http/https)", 400);

    const sb = adminClient();
    const { data: rateOk } = await sb.rpc("check_rate_limit", {
      p_user_id: auth.userId, p_action: "kb_fact_extract", p_max_requests: 30, p_window_minutes: 60,
    });
    if (rateOk === false) return errorResponse("Слишком много запросов. Попробуйте позже.", 429);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OPENROUTER_API_KEY not configured", 500);

    const pages = await Promise.all(urls.map(readPage));
    const readable = pages.filter((p) => p.ok);
    const failed = pages.filter((p) => !p.ok).map((p) => p.url);
    if (!readable.length) return errorResponse("Не удалось прочитать страницы сайта", 502);

    const user = readable.map((p, i) => `=== СТРАНИЦА ${i + 1} ===\nURL: ${p.url}\nТЕКСТ:\n${p.text}`).join("\n\n");

    const upstream = await withTimeout(fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
        "HTTP-Referer": "https://seo-modul.pro", "X-Title": "SEO-Module Knowledge Base",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        max_tokens: 4000,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: user }],
      }),
    }), 90_000, "fact extract timeout");

    if (!upstream.ok) {
      const t = await upstream.text().catch(() => "");
      return errorResponse(`Модель недоступна (${upstream.status}). ${t.slice(0, 160)}`, 502);
    }
    const json = await upstream.json();
    try {
      logLLM({
        functionName: "kb-fact-extract", model: (json as any)?.model,
        tokensIn: Number((json as any)?.usage?.prompt_tokens || 0),
        tokensOut: Number((json as any)?.usage?.completion_tokens || 0), userId: auth.userId,
      });
    } catch { /* noop */ }

    const raw = String(json?.choices?.[0]?.message?.content || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    let parsed: any = {};
    try { parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { parsed = {}; }

    const allowed = new Set(readable.map((p) => p.url));
    const seen = new Set<string>();
    const facts = (Array.isArray(parsed?.facts) ? parsed.facts : [])
      .map((f: any) => ({
        topic: clean(f?.topic, 30) || "other",
        statement: clean(f?.statement, 300),
        parameter: clean(f?.parameter, 120),
        unit: clean(f?.unit, 30),
        value: clean(f?.value, 120),
        standard: clean(f?.standard, 120),
        source_url: allowed.has(clean(f?.source_url, 500)) ? clean(f?.source_url, 500) : readable[0].url,
      }))
      .filter((f: any) => f.statement && !BANNED.test(f.statement))
      .filter((f: any) => {
        const k = f.statement.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 80);

    const company = {
      name: clean(parsed?.company?.name, 160),
      legal_name: clean(parsed?.company?.legal_name, 200),
      city: clean(parsed?.company?.city, 80),
      description: BANNED.test(String(parsed?.company?.description || "")) ? "" : clean(parsed?.company?.description, 600),
    };

    return jsonResponse({ company, facts, failed });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});
