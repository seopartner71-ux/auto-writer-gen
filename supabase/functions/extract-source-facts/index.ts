// extract-source-facts: fetches a user-supplied URL, strips HTML, asks AI to
// pull structured facts (USP, key numbers, services, pricing, location,
// unique features), and caches the result for 7 days per (user, url).
//
// Used by generate-article so the writer references the user's own page
// (e.g. "наши походы на 5 дней") instead of generic competitor data.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

const FACTS_PROMPT = `Ты извлекаешь ключевые факты со страницы сайта пользователя, чтобы AI-писатель использовал ИХ ВМЕСТО общих данных конкурентов.

Верни СТРОГО JSON со схемой:
{
  "title": "Заголовок страницы",
  "service_name": "Название продукта/услуги",
  "usp": "Главное УТП одной фразой",
  "key_numbers": ["5 дней", "12 человек в группе", "от 35000 руб"],
  "features": ["краткая особенность 1", "..."],
  "audience": "Для кого",
  "location": "Гео/регион если есть",
  "pricing": "Цены/формат оплаты если есть",
  "must_mention": ["обязательно использовать в статье", "..."]
}

ПРАВИЛА:
- Только факты со страницы. НЕ придумывай.
- Если поля нет — пустая строка или пустой массив.
- Цифры конкретные (5 дней, не "несколько дней").
- Без воды, маркетинга, эмодзи.
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
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return errorResponse("Unauthorized", 401);

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

    const text = stripHtml(html).slice(0, 12000);
    if (text.length < 100) return errorResponse("Слишком мало текста на странице", 400);

    // AI extraction via Lovable AI Gateway (cheap, fast model)
    const aiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!aiKey) return errorResponse("LOVABLE_API_KEY not configured", 500);

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: FACTS_PROMPT },
          { role: "user", content: `URL: ${rawUrl}\n\nТЕКСТ СТРАНИЦЫ:\n${text}` },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (aiRes.status === 429) return errorResponse("AI rate limit, попробуйте позже", 429);
    if (aiRes.status === 402) return errorResponse("AI credits exhausted", 402);
    if (!aiRes.ok) {
      const errTxt = await aiRes.text().catch(() => "");
      console.error("[extract-source-facts] AI error", aiRes.status, errTxt.slice(0, 200));
      return errorResponse("AI extraction failed", 500);
    }

    const aiData = await aiRes.json();
    const raw = aiData?.choices?.[0]?.message?.content || "{}";
    let facts: any;
    try { facts = JSON.parse(raw); } catch {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
      try { facts = JSON.parse(cleaned); } catch { facts = null; }
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