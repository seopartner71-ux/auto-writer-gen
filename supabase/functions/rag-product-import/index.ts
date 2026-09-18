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

const SYSTEM_PROMPT = `Ты парсер карточек товаров. На вход ты получаешь текст нескольких страниц каталога.
Для каждой страницы извлеки данные строго из текста, не выдумывай значения. Если данных нет - верни пустую строку.

Правила:
- product_name: точное название позиции без рекламных слов.
- brand: производитель или бренд, если он указан.
- category: короткая товарная категория (например "Щебень", "Саморезы").
- price: только число с валютой, как на странице (например "1890 руб"), без диапазонов текста.
- unit: единица измерения цены (шт, кг, м, тонна, м3).
- specs: характеристики одной строкой через точку с запятой, например "Материал: сталь; Диаметр: 4 мм; ГОСТ 10299-80".
- supplier_name: название компании-продавца со страницы.
- product_url: URL исходной страницы, переданный тебе.

В тексте не используй букву "ё", пиши "е". Не используй markdown и жирный шрифт.

Ответь СТРОГО валидным JSON без markdown:
{"products":[{"product_name":"","brand":"","category":"","price":"","unit":"","specs":"","supplier_name":"","product_url":""}]}`;

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
  return arr.slice(0, MAX_URLS).map((raw) => ({
    product_name: clean((raw as any)?.product_name).slice(0, 160),
    brand: clean((raw as any)?.brand).slice(0, 120),
    category: clean((raw as any)?.category).slice(0, 120),
    price: clean((raw as any)?.price).slice(0, 40),
    unit: clean((raw as any)?.unit).slice(0, 40),
    specs: clean((raw as any)?.specs).slice(0, 2000),
    supplier_name: clean((raw as any)?.supplier_name).slice(0, 160),
    product_url: clean((raw as any)?.product_url).slice(0, 300),
  })).filter((p) => p.product_name || p.product_url);
}

/** Read one page through the LLM-friendly reader; failures degrade to an empty page. */
async function readPage(url: string): Promise<{ url: string; text: string; ok: boolean }> {
  try {
    const res = await withTimeout(
      fetch(`https://r.jina.ai/${url}`, { headers: { Accept: "text/plain", "X-Return-Format": "text" } }),
      25_000,
      "reader timeout",
    );
    if (!res.ok) return { url, text: "", ok: false };
    const text = (await res.text()).slice(0, PAGE_CHARS);
    return { url, text, ok: text.trim().length > 40 };
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
    if (!readable.length) return errorResponse("Не удалось прочитать ни одну страницу. Проверьте ссылки.", 502);

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
          model: "google/gemini-2.5-flash",
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
      return errorResponse(`Upstream ${upstream.status}: ${t.slice(0, 200)}`, 502);
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
    const products = parseProducts(text).map((p, i) => ({
      ...p,
      product_url: p.product_url || readable[i]?.url || "",
    }));
    if (!products.length) return errorResponse("Модель не нашла товарных данных на этих страницах", 502);

    return jsonResponse({ products, failed });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});
