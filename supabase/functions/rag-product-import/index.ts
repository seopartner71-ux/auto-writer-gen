// Admin-only helper: reads product pages through the r.jina.ai reader and asks
// OpenRouter to extract catalogue fields (name, price, specs, supplier) as JSON.
// Pure data-prep for the RAG generator form: it never touches scoring or ZIP logic.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdminOrStaff } from "../_shared/auth.ts";
import { withTimeout } from "../_shared/withTimeout.ts";
import { logLLM } from "../_shared/costLogger.ts";

interface ReqBody { urls?: unknown }

interface ProductOut {
  product_name: string;
  brand: string;
  category: string;
  price: string;
  unit: string;
  specs: string;
  supplier_name: string;
  product_url: string;
}

const MAX_URLS = 12;
const PAGE_CHARS = 6000;

const SYSTEM_PROMPT = `Ты неумолимый движок извлечения данных. На вход ты получаешь текст нескольких веб-страниц.
Твоя задача - извлечь Товар или Услугу из текста КАЖДОЙ страницы, как бы плохо ни была сверстана страница.
Многие B2B и промышленные сайты - это обычные текстовые страницы с таблицами, без карточек товара. Это нормально.

Ты извлекаешь данные для строгой реляционной базы данных (CSV, Schema.org), а не пишешь обзорную статью. Каждое поле - это ячейка базы, а не связный текст.

Правила извлечения:
1. product_name: если явного названия товара нет - возьми главный заголовок страницы (H1), Title или выведи название из основной темы текста (например "Гранитный щебень"). Без рекламных слов.
2. price (СТРОГО Schema.org): ТОЛЬКО ЧИСЛО, например "800", "3715", "1500.50". Удали все слова, символы валют и префиксы ("от", "руб", "₽", пробелы). Если цен несколько - верни наименьшее базовое число. Если цены нет совсем - верни "0". ЗАПРЕЩЕН любой текст в этом поле.
3. unit: единица измерения цены (шт, кг, м, тонна, м3). Если неясно - пустая строка.
4. specs (СТРОГО факты, ноль болтовни): ТОЛЬКО список технических фактов через точку с запятой, например "Материал: сталь; Диаметр: 4 мм; ГОСТ 10299-80". ЗАПРЕЩЕНЫ вводные фразы, предупреждения и отсылки к источнику ("на сайте указано", "цена уточняется", "в описании сказано" и т.п.). Если списка характеристик нет - извлеки 2-4 ключевых факта из текста в том же формате "Свойство: значение".
5. brand (НЕ МОЖЕТ быть пустым): производитель или бренд со страницы. Если бренд не найден - поставь то же значение, что и supplier_name, либо домен сайта.
6. supplier_name: выведи из домена, подвала страницы или упоминаний "О компании" в тексте.
7. product_url: URL исходной страницы, переданный тебе.

КРИТИЧЕСКОЕ ПРАВИЛО: НИКОГДА не возвращай пустой результат и не пиши "товар не найден". Даже если это просто информационная статья о материале - считай этот материал Товаром, извлеки его название и характеристики в JSON. Всегда возвращай массив products, по одному элементу на каждую страницу.

В тексте не используй букву "ё", пиши "е". Не используй markdown и жирный шрифт.

Ответь СТРОГО валидным JSON без markdown:
{"products":[{"product_name":"","brand":"","category":"","price":"","unit":"","specs":"","supplier_name":"","product_url":""}]}`;

/** Lowest numeric price from any dirty string ("от 1 500 руб" -> "1500"); "0" when none. */
function sanitizePrice(v: string): string {
  const matches = v.replace(/\u00A0/g, " ").match(/\d[\d\s]*(?:[.,]\d+)?/g);
  if (!matches) return "0";
  const nums = matches
    .map((m) => Number(m.replace(/\s+/g, "").replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (!nums.length) return "0";
  const min = Math.min(...nums);
  return String(Math.round(min * 100) / 100);
}

/** Strip conversational filler the model may leak into factual fields. */
function sanitizeSpecs(v: string): string {
  return v
    .replace(/(на сайте (указано|сказано|написано)[^;.]*[;.]\s*)/gi, "")
    .replace(/(в описании (указано|сказано)[^;.]*[;.]\s*)/gi, "")
    .replace(/(цена (уточняется|по запросу)[^;.]*[;.]\s*)/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[;.\s]+|[;.\s]+$/g, "")
    .trim();
}

const clean = (v: unknown): string =>
  String(v ?? "").replace(/\*\*/g, "").replace(/ё/g, "е").replace(/Ё/g, "Е").replace(/\s+/g, " ").trim();

function parseProducts(text: string): ProductOut[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch { return []; }
  const arr = (parsed as { products?: unknown })?.products;
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, MAX_URLS).map((raw) => {
    const product_url = clean((raw as any)?.product_url).slice(0, 300);
    const supplier_name = clean((raw as any)?.supplier_name).slice(0, 160);
    let host = "";
    try { host = new URL(product_url).hostname.replace(/^www\./, ""); } catch { /* noop */ }
    const brandRaw = clean((raw as any)?.brand).slice(0, 120);
    return {
      product_name: clean((raw as any)?.product_name).slice(0, 160),
      // Brand never empty: fall back to supplier, then to the site domain.
      brand: brandRaw || supplier_name || host,
      category: clean((raw as any)?.category).slice(0, 120),
      price: sanitizePrice(clean((raw as any)?.price)),
      unit: clean((raw as any)?.unit).slice(0, 40),
      specs: sanitizeSpecs(clean((raw as any)?.specs)).slice(0, 2000),
      supplier_name,
      product_url,
    };
  }).filter((p) => p.product_name || p.product_url);
}

/** Strip HTML down to readable text for the direct-fetch fallback. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Read one page: reader service first, plain fetch as fallback. */
async function readPage(url: string): Promise<{ url: string; text: string; ok: boolean; reason?: string }> {
  const jinaKey = Deno.env.get("JINA_API_KEY");
  try {
    const res = await withTimeout(
      fetch(`https://r.jina.ai/${url}`, {
        headers: {
          Accept: "text/plain",
          "X-Return-Format": "text",
          ...(jinaKey ? { Authorization: `Bearer ${jinaKey}` } : {}),
        },
      }),
      25_000,
      "reader timeout",
    );
    if (res.ok) {
      const text = (await res.text()).slice(0, PAGE_CHARS);
      if (text.trim().length > 40) return { url, text, ok: true };
    } else {
      console.log(`[rag-product-import] reader:${res.status} ${url}`);
    }
  } catch (e) {
    console.log(`[rag-product-import] reader:error ${url} ${e instanceof Error ? e.message : "unknown"}`);
  }

  try {
    const res = await withTimeout(
      fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SeoModuleBot/1.0)" } }),
      20_000,
      "direct fetch timeout",
    );
    if (!res.ok) return { url, text: "", ok: false, reason: `http ${res.status}` };
    const text = htmlToText(await res.text()).slice(0, PAGE_CHARS);
    return { url, text, ok: text.trim().length > 40, reason: "empty text" };
  } catch (e) {
    return { url, text: "", ok: false, reason: e instanceof Error ? e.message : "fetch failed" };
  }
}


Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const forbidden = await requireAdminOrStaff(auth);
    if (forbidden) return forbidden;

    let body: ReqBody;
    try { body = await req.json(); } catch { body = {}; }

    const urls = (Array.isArray(body.urls) ? body.urls : [])
      .map((u) => String(u ?? "").trim())
      .filter((u) => /^https?:\/\/[^\s]+$/i.test(u))
      .filter((u, i, a) => a.indexOf(u) === i)
      .slice(0, MAX_URLS);
    if (!urls.length) return errorResponse("Укажите хотя бы одну корректную ссылку (http/https)", 400);

    const sb = adminClient();
    const { data: rateOk } = await sb.rpc("check_rate_limit", {
      p_user_id: auth.userId,
      p_action: "rag_product_import",
      p_max_requests: 30,
      p_window_minutes: 60,
    });
    if (rateOk === false) return errorResponse("Слишком много запросов. Попробуйте позже.", 429);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OPENROUTER_API_KEY not configured", 500);

    const pages = await Promise.all(urls.map(readPage));
    const readable = pages.filter((p) => p.ok);
    const failed = pages.filter((p) => !p.ok).map((p) => p.url);
    console.log(`[rag-product-import] pages: ok=${readable.length} failed=${failed.length}`);
    if (!readable.length) {
      const reasons = pages.map((p) => p.reason).filter(Boolean).join("; ").slice(0, 200);
      return errorResponse(`Не удалось прочитать страницы. ${reasons || "Сайт закрыл доступ роботам."}`, 502);
    }


    const user = readable
      .map((p, i) => `=== СТРАНИЦА ${i + 1} ===\nURL: ${p.url}\nТЕКСТ:\n${p.text}`)
      .join("\n\n");

    const upstream = await withTimeout(
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://seo-modul.pro",
          "X-Title": "SEO-Module RAG Product Import",
        },
        body: JSON.stringify({
          model: "openai/gpt-6-astra",
          max_tokens: 3000,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: user },
          ],
        }),
      }),
      60_000,
      "product import timeout",
    );

    if (!upstream.ok) {
      const t = await upstream.text().catch(() => "");
      console.log(`[rag-product-import] upstream:${upstream.status} ${t.slice(0, 300)}`);
      return errorResponse(`Модель недоступна (${upstream.status}). ${t.slice(0, 160)}`, 502);
    }


    const json = await upstream.json();
    try {
      logLLM({
        functionName: "rag-product-import",
        model: (json as any)?.model as string,
        tokensIn: Number((json as any)?.usage?.prompt_tokens || 0),
        tokensOut: Number((json as any)?.usage?.completion_tokens || 0),
        userId: auth.userId,
      });
    } catch (_) { /* noop */ }

    const text = String(json?.choices?.[0]?.message?.content || "").trim();
    const parsed = parseProducts(text);

    // Bulletproof: гарантируем по одному товару на каждую прочитанную страницу.
    // Если модель пропустила страницу или не заполнила поля - достраиваем из URL и текста.
    const nameFromUrl = (url: string): string => {
      try {
        const seg = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
        const decoded = decodeURIComponent(seg).replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ").trim();
        return decoded ? decoded.charAt(0).toUpperCase() + decoded.slice(1) : "Товар со страницы";
      } catch { return "Товар со страницы"; }
    };

    const used = new Set<number>();
    const products = readable.map((page) => {
      const idx = parsed.findIndex((p, i) =>
        !used.has(i) && (p.product_url === page.url || (!p.product_url && i === readable.indexOf(page))));
      if (idx !== -1) {
        used.add(idx);
        const p = parsed[idx];
        return {
          ...p,
          product_url: page.url,
          product_name: p.product_name || nameFromUrl(page.url),
          price: p.price || "По запросу",
        };
      }
      return {
        product_name: nameFromUrl(page.url),
        brand: "",
        category: "",
        price: "По запросу",
        unit: "",
        specs: page.text.slice(0, 300),
        supplier_name: "",
        product_url: page.url,
      };
    }).slice(0, MAX_URLS);
    if (!products.length) {
      console.log(`[rag-product-import] empty parse, raw=${text.slice(0, 300)}`);
      return errorResponse("Модель не нашла товарных данных на этих страницах", 502);
    }


    return jsonResponse({ products, failed });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});
