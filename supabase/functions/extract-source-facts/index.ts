// extract-source-facts: fetches a user-supplied URL, strips HTML, asks AI to
// pull structured facts (USP, key numbers, services, pricing, location,
// unique features), and caches the result for 7 days per (user, url).
//
// Used by generate-article so the writer references the user's own page
// (e.g. "наши походы на 5 дней") instead of generic competitor data.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { chatJson, aiErrorToResponse, AiError } from "../_shared/aiClient.ts";
import { logPipelineEvent, startTimer } from "../_shared/pipelineLogger.ts";
import { verifyAuth } from "../_shared/auth.ts";

const FACTS_PROMPT = `Ты извлекаешь МАКСИМУМ конкретных фактов со страницы сайта пользователя, чтобы AI-писатель опирался на НИХ вместо общих данных конкурентов.

Верни СТРОГО JSON со схемой:
{
  "title": "Заголовок страницы (из h1 или title)",
  "service_name": "Название продукта/услуги/категории",
  "usp": "Главное УТП одной фразой",
  "key_numbers": ["5 дней", "12 человек в группе", "от 35000 руб", "гарантия 3 года"],
  "features": ["конкретная характеристика/преимущество 1", "..."],
  "brands": ["упомянутые бренды/производители/модели"],
  "audience": "Для кого продукт",
  "location": "Гео/город/регион если есть",
  "pricing": "Цены, диапазон цен, условия оплаты",
  "guarantees": "Гарантии, сертификаты, лицензии",
  "delivery": "Доставка, сроки, монтаж, установка",
  "contacts": "Телефон, режим работы, адрес если есть",
  "must_mention": ["обязательно упомянуть в статье - 5-10 конкретных фактов"]
}

ПРАВИЛА:
- ИЗВЛЕКАЙ МАКСИМУМ. Заполняй ВСЕ применимые поля. Пустое поле = только если факта реально нет.
- Используй и meta-теги, и заголовки, и текст, и хлебные крошки.
- Цифры конкретные (5 дней, не "несколько дней"; 17-22 кВт, не "разной мощности").
- В features перечисляй технические характеристики, материалы, особенности конструкции.
- В must_mention - самые важные факты-якори, которые отличают этот сайт от конкурентов.
- Только факты со страницы. НЕ придумывай.
- Без воды, маркетинга, эмодзи. Без 'ё' (только 'е').
- Только JSON, без markdown-обёрток.`;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull <title>, <meta description/keywords>, og:* and h1/h2 separately - they often hold the densest facts. */
function extractMeta(html: string): string {
  const out: string[] = [];
  const grab = (re: RegExp, label: string) => {
    const m = html.match(re);
    if (m && m[1]) out.push(`${label}: ${m[1].trim().slice(0, 300)}`);
  };
  grab(/<title[^>]*>([^<]+)<\/title>/i, "TITLE");
  grab(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i, "DESCRIPTION");
  grab(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i, "KEYWORDS");
  grab(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i, "OG_TITLE");
  grab(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i, "OG_DESCRIPTION");
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripHtml(m[1])).filter(Boolean);
  if (h1s.length) out.push(`H1: ${h1s.slice(0, 3).join(" | ")}`);
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => stripHtml(m[1])).filter(Boolean);
  if (h2s.length) out.push(`H2: ${h2s.slice(0, 12).join(" | ")}`);
  const h3s = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map((m) => stripHtml(m[1])).filter(Boolean);
  if (h3s.length) out.push(`H3: ${h3s.slice(0, 15).join(" | ")}`);
  return out.join("\n");
}

function isValidUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch { return false; }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Unauthorized", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const __auth = await verifyAuth(req);
    if (__auth instanceof Response) return __auth;
    const user = { id: __auth.userId };

    const body = await req.json().catch(() => ({} as any));
    const rawUrl = String(body?.url || "").trim();
    const force = !!body?.force;
    if (!rawUrl) return errorResponse("url is required", 400);
    if (!isValidUrl(rawUrl)) return errorResponse("Invalid URL", 400);
    if (rawUrl.length > 2000) return errorResponse("URL too long", 400);

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Cache lookup
    if (!force) {
      const { data: cached } = await supabaseAdmin
        .from("source_page_cache")
        .select("facts, expires_at")
        .eq("user_id", user.id)
        .eq("url", rawUrl)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (cached?.facts) {
        return jsonResponse({ ok: true, facts: cached.facts, cached: true });
      }
    }

    // Rate-limit: 30/hour per user
    const { data: rateOk } = await supabaseAdmin.rpc("check_rate_limit", {
      p_user_id: user.id,
      p_action: "extract_source_facts",
      p_max_requests: 30,
      p_window_minutes: 60,
    });
    if (rateOk === false) return errorResponse("Превышен лимит. Попробуйте позже.", 429);

    // Fetch page
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    let html = "";
    try {
      const r = await fetch(rawUrl, {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SeoModulBot/1.0)" },
        redirect: "follow",
      });
      if (!r.ok) return errorResponse(`Не удалось загрузить страницу (HTTP ${r.status})`, 400);
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("text/html") && !ct.includes("text/plain")) {
        return errorResponse("Страница не HTML/текст", 400);
      }
      html = await r.text();
    } catch (e: any) {
      return errorResponse(`Ошибка загрузки: ${e?.message || "timeout"}`, 400);
    } finally { clearTimeout(t); }

    const meta = extractMeta(html);
    const pageText = stripHtml(html).slice(0, 20000);
    if (pageText.length < 100 && meta.length < 50) {
      return errorResponse("Слишком мало текста на странице", 400);
    }
    const text = `${meta}\n\n=== ОСНОВНОЙ ТЕКСТ ===\n${pageText}`;

    // AI extraction via unified aiClient (json_object + auto-retry на парсе).
    const aiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!aiKey) return errorResponse("OPENROUTER_API_KEY not configured", 500);

    const elapsed = startTimer();
    let facts: any;
    let modelUsed = "google/gemini-2.5-flash-lite";
    try {
      const r = await chatJson<any>({
        apiKey: aiKey,
        model: modelUsed,
        system: FACTS_PROMPT,
        user: `URL: ${rawUrl}\n\nТЕКСТ СТРАНИЦЫ:\n${text}`,
        temperature: 0.2,
        maxTokens: 2500,
        timeoutMs: 45_000,
        retries: 1,
        appTitle: "extract-source-facts",
      });
      facts = r.data;
      modelUsed = r.model;
      logPipelineEvent({
        stage: "generate",
        user_id: user.id,
        verdict: "pass",
        duration_ms: elapsed(),
        model: r.model,
        tokens_in: r.tokensIn,
        tokens_out: r.tokensOut,
        meta: { fn: "extract-source-facts", url: rawUrl.slice(0, 200) },
      });
    } catch (e) {
      const err = e instanceof AiError ? e : null;
      logPipelineEvent({
        stage: "generate",
        user_id: user.id,
        verdict: "fail",
        duration_ms: elapsed(),
        model: modelUsed,
        error_kind: err?.kind || "upstream",
        error_message: (e as Error)?.message,
        meta: { fn: "extract-source-facts", url: rawUrl.slice(0, 200) },
      });
      return aiErrorToResponse(e, corsHeaders);
    }
    if (!facts || typeof facts !== "object") {
      return errorResponse("Не удалось распознать факты страницы", 500);
    }

    // Upsert cache
    await supabaseAdmin.from("source_page_cache").upsert({
      user_id: user.id,
      url: rawUrl,
      facts,
      raw_text: text.slice(0, 5000),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,url" });

    return jsonResponse({ ok: true, facts, cached: false });
  } catch (e: any) {
    console.error("[extract-source-facts] exception:", e?.message || e);
    return errorResponse(e?.message || "Internal error", 500);
  }
});