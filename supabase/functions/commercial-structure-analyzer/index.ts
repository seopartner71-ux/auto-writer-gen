// SEO-strategist reverse-engineering analyzer for commercial pages.
// Models how a modern search AI interprets the query and proposes a
// recommended block structure tailored to the page type (product, category,
// service, local). Free (no credit deduction), rate-limited.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdminOrStaff } from "../_shared/auth.ts";
import { withTimeout } from "../_shared/withTimeout.ts";
import { logLLM } from "../_shared/costLogger.ts";

interface ReqBody {
  page_type: "service" | "category" | "product" | "local";
  niche?: string;
  keyword?: string;
  city?: string;
  audience?: string;
  utp?: string;
  benefits?: string[];
}

function stripQuotes(s: string) {
  return s.replace(/ё/g, "е").replace(/Ё/g, "Е");
}

function tryParseJson(text: string): any | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

const FOCUS_HINT: Record<string, string> = {
  product:
    "Это карточка товара интернет-магазина. Сделай акцент на проектирование SEO-текста: это НЕ полотно, а полезный набор блоков (характеристики, выгоды, сценарии использования, сравнение, отзывы, FAQ). Глубокая проработка SEO-структуры.",
  category:
    "Это страница категории интернет-магазина / зона под каталогом. Сделай акцент на проектирование SEO-текста: НЕ полотно, а набор полезных блоков (как выбрать, типы товаров, бренды, фильтры, FAQ). Глубокая проработка SEO.",
  service:
    "Это коммерческая страница услуги. Проработай блоки: оффер, выгоды, этапы работы, кейсы/доверие, цены, FAQ, CTA. Системно и без воды.",
  local:
    "Это локальная коммерческая страница (услуга + город). Проработай гео-блоки: зона охвата, районы, локальные доверительные сигналы, FAQ под локальный интент, гео SEO-текст.",
};

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const forbidden = await requireAdminOrStaff(auth);
    if (forbidden) return forbidden;
    const userId = auth.userId;

    let body: ReqBody;
    try { body = await req.json(); } catch { return errorResponse("Invalid JSON", 400); }
    if (!body?.page_type || !["service", "category", "product", "local"].includes(body.page_type)) {
      return errorResponse("page_type required", 400);
    }
    if (!body.keyword) return errorResponse("keyword required", 400);

    const sb = adminClient();
    const { data: rateOk } = await sb.rpc("check_rate_limit", {
      p_user_id: userId,
      p_action: "commercial_structure_analyzer",
      p_max_requests: 20,
      p_window_minutes: 60,
    });
    if (rateOk === false) return errorResponse("Слишком много запросов. Попробуйте через минуту.", 429);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OPENROUTER_API_KEY not configured", 500);

    const focus = FOCUS_HINT[body.page_type] || "";

    const system = `Ты SEO-стратег, моделирующий внутреннюю интерпретацию запроса современным поисковым ИИ (Трансформеры, Сущности, Онтологии, Таксономии, Внимание) и преобразующий это в прикладные рекомендации по структуре веб-страницы.

Твоя задача — двойной анализ запроса:
1) Реверс-инжиниринг: как ИИ интерпретирует запрос (сущности, атрибуты, таксономия, интент, salience, расширенная форма запроса, чек-лист ожиданий).
2) Прикладные рекомендации: семантическая структура страницы (H1-H3), сущности и атрибуты для раскрытия, типы структурных элементов (таблицы, списки, FAQ, схемы), связи с другими сущностями сайта.

Фокусируйся ТОЛЬКО на семантическом соответствии. Не учитывай другие факторы SEO (ссылки, поведенческие, технические).
Русский язык, региональные особенности РФ. БЕЗ буквы "е с двумя точками" (всегда заменяй на "е"). БЕЗ markdown bold (**).

Верни строго JSON следующего вида (без пояснений, без markdown):
{
  "intent": "краткое описание основного интента",
  "entities": ["сущность 1", "сущность 2", ...],
  "expectations": ["ожидание 1", "ожидание 2", ...],
  "recommended_blocks": [
    { "type": "machine_slug_en", "title": "Заголовок блока (H2)", "h_level": 2, "desc": "что внутри блока", "words": 200, "elements": ["list", "table", "faq"] }
  ],
  "internal_links": ["с какими сущностями/разделами сайта связать"],
  "seo_notes": "1-2 предложения главного вывода для SEO-текста"
}

Минимум 5, максимум 10 блоков. type — короткий латинский slug в snake_case. words — реалистичная оценка (60-700).`;

    const userMsg = `Тип страницы: ${body.page_type}.
${focus}

Запрос/ключ: "${body.keyword}".
Ниша: ${body.niche || "не указана"}.
${body.city ? `Город: ${body.city}.` : ""}
${body.audience ? `Аудитория: ${body.audience}.` : ""}
${body.utp ? `УТП: ${body.utp}.` : ""}
${body.benefits?.length ? `Преимущества: ${body.benefits.join(", ")}.` : ""}

Выполни анализ и верни JSON.`;

    const upstream = await withTimeout(
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://seo-modul.pro",
          "X-Title": "SEO-Module Structure Analyzer",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: 2200,
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMsg },
          ],
        }),
      }),
      45_000,
      "structure analyzer timeout",
    );

    if (!upstream.ok) {
      const t = await upstream.text().catch(() => "");
      return errorResponse(`Upstream ${upstream.status}: ${t.slice(0, 200)}`, 502);
    }
    const json = await upstream.json();
    try { logLLM({ functionName: "commercial-structure-analyzer", model: ((json as any)?.model) as string, tokensIn: Number((json as any)?.usage?.prompt_tokens || 0), tokensOut: Number((json as any)?.usage?.completion_tokens || 0) }); } catch(_) {}
    const text = (json?.choices?.[0]?.message?.content || "").trim();
    const parsed = tryParseJson(text);
    if (!parsed) return errorResponse("Не удалось разобрать ответ модели", 502);

    const blocks = Array.isArray(parsed.recommended_blocks)
      ? parsed.recommended_blocks
          .filter((b: any) => b && typeof b.title === "string")
          .slice(0, 10)
          .map((b: any, i: number) => ({
            type: String(b.type || `ai_block_${i + 1}`).replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 40),
            title: stripQuotes(String(b.title)).slice(0, 120),
            h_level: Number(b.h_level) || 2,
            desc: stripQuotes(String(b.desc || "")).slice(0, 300),
            words: Math.max(60, Math.min(700, Number(b.words) || 200)),
            elements: Array.isArray(b.elements) ? b.elements.slice(0, 5).map(String) : [],
          }))
      : [];

    return jsonResponse({
      intent: stripQuotes(String(parsed.intent || "")),
      entities: Array.isArray(parsed.entities) ? parsed.entities.slice(0, 20).map((s: any) => stripQuotes(String(s))) : [],
      expectations: Array.isArray(parsed.expectations) ? parsed.expectations.slice(0, 20).map((s: any) => stripQuotes(String(s))) : [],
      internal_links: Array.isArray(parsed.internal_links) ? parsed.internal_links.slice(0, 15).map((s: any) => stripQuotes(String(s))) : [],
      seo_notes: stripQuotes(String(parsed.seo_notes || "")),
      recommended_blocks: blocks,
    });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});