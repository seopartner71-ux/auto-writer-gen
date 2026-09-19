// Admin-only helper: generates 12 realistic conversational AI-search queries
// (ChatGPT / Perplexity / Alice style) based on the current RAG context.
// Pure data-prep for the "Target AI Questions" textarea - it never touches
// scoring, AI_QUESTIONS_MAP.csv or the ZIP builder.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdminOrStaff } from "../_shared/auth.ts";
import { withTimeout } from "../_shared/withTimeout.ts";
import { logLLM } from "../_shared/costLogger.ts";

interface ReqBody {
  client_name?: string;
  domain?: string;
  region?: string;
  niche?: string;
  topics?: string;
  niche_type?: "b2c" | "b2b";
  subject?: "company" | "product";
  /** Names of products / entities being ranked, if any. */
  entities?: string[];
}

const MAX_QUESTIONS = 12;

const SYSTEM_PROMPT = `Ты - Senior AI Search Intent Analyst. Твоя задача - проанализировать предоставленные [Ниша/Категория] и [Список товаров + характеристики] и сгенерировать ровно 12 максимально реалистичных разговорных поисковых запросов, которые реальные профессионалы или потребители задают поисковым ИИ (ChatGPT, Perplexity, Яндекс Алиса, Google AI Overviews).

КРИТИЧЕСКИЕ ПРАВИЛА ГЕНЕРАЦИИ:

1. НИКАКИХ БРЕНДОВ (ТОЛЬКО НЕБРЕНДОВЫЕ ЗАПРОСЫ). ЗАПРЕЩАЕТСЯ использовать имя клиента, название бренда или конкретное доменное имя в вопросах. Запросы должны звучать так, будто пользователь ищет общее решение, а не конкретную компанию. Небрендовый трафик верхней воронки важнее брендового.

2. Глубокие характеристики и решение проблем. Используй извлеченные характеристики (фракции, ГОСТы, плотность, материалы, допуски и т.п.) для построения сложных, прикладных вопросов. Например: "Какой материал лучше для дренажа в глинистых грунтах?", а НЕ "Купить щебень у [Бренд]".

3. Фокус на реальных сценариях применения. Задавай вопросы ГДЕ, КАК и ДЛЯ КАКОЙ ЦЕЛИ используются эти конкретные товары, исходя из их характеристик.

4. Внутреннее сравнение. Включи запросы, где запрашивается сравнение предоставленных типов товаров между собой по их реальным характеристикам.

5. Геотаргетинг. Если в контексте указан регион/город, включи его в часть коммерческих вопросов (например: "Где купить [тип товара] в [городе]?"). Используй только тип товара и категорию, без названия компании.

6. Без воды и словарной банальщины. Не генерируй базовые словарные вопросы из серии "Что такое X?". Только экспертные, прикладные, предметные запросы, привязанные к конкретным характеристикам и названиям из списка.

7. Запросы должны быть естественными, как их реально формулируют живые люди в голосовом или текстовом диалоге с ИИ, а не SEO-ключи. Без неестественной keyword-стопки. Не повторяй одну и ту же формулировку дважды.

8. Язык: русский (или язык ввода, если контекст на другом языке). Не используй букву "ё", пиши "е".

ФОРМАТ ВЫВОДА: СТРОГО по одному вопросу на строку. Без нумерации, без markdown, без кавычек, без вступлений и пояснений, без пустых строк в начале и конце. Ровно 12 строк.`;

const clean = (v: unknown): string =>
  String(v ?? "").replace(/\*\*/g, "").replace(/ё/g, "е").replace(/Ё/g, "Е").trim();

/** Build a regex that matches any of the provided brand/domain tokens, case-insensitive. */
function buildBrandScrubber(clientName?: string, domain?: string): (s: string) => string {
  const tokens: string[] = [];
  if (domain) {
    const bare = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split(".")[0];
    if (bare.length >= 3) tokens.push(bare, domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]);
  }
  if (clientName && clientName.trim().length >= 3) {
    tokens.push(clientName.trim());
  }
  if (tokens.length === 0) return (s) => s;
  const re = new RegExp(tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  return (s) => s.replace(re, "").replace(/\s{2,}/g, " ").trim();
}

/** Extract clean question lines from the model output. */
function parseQuestions(text: string, scrub?: (s: string) => string): string[] {
  const lines = text
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .split("\n")
    .map((l) => clean(l).replace(/^[-*\d.)\]\s]+/, "").replace(/[.。]\s*$/, "").trim())
    .map((l) => (scrub ? scrub(l) : l).trim())
    .filter((l) => l.length >= 8)
    // drop obvious non-question prose lines
    .filter((l) => !/^(вот|список|вопросы|конечно|ответ|note|вывод)/i.test(l));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const key = l.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
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

    const sb = adminClient();
    const { data: rateOk } = await sb.rpc("check_rate_limit", {
      p_user_id: auth.userId,
      p_action: "rag_questions_generate",
      p_max_requests: 40,
      p_window_minutes: 60,
    });
    if (rateOk === false) return errorResponse("Слишком много запросов. Попробуйте позже.", 429);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OPENROUTER_API_KEY not configured", 500);

    const entities = Array.isArray(body.entities)
      ? body.entities.map((e) => clean(e)).filter(Boolean).slice(0, 12)
      : [];

    // NOTE: намеренно НЕ передаем client_name и domain в модель, чтобы запросы
    // оставались небрендовыми (правило №1 системного промпта). Регион нужен для
    // геотаргетинга коммерческих вопросов.
    const user = [
      `Регион: ${body.region || "не указан"}`,
      `Ниша / категория: ${body.topics || body.niche || "не указана"}`,
      `Тип рынка: ${body.niche_type === "b2b" ? "B2B" : "B2C"}`,
      `Объект рейтинга: ${body.subject === "product" ? "физические товары каталога" : "компании и поставщики"}`,
      entities.length
        ? (body.subject === "product"
            ? `Товары + характеристики: ${entities.join(" || ")}`
            : `Сущности / позиции: ${entities.join(", ")}`)
        : "Сущности / позиции: не указаны",
      `Случайный seed для вариативности: ${Math.floor(Math.random() * 100000)}`,
    ].join("\n");

    const upstream = await withTimeout(
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://seo-modul.pro",
          "X-Title": "SEO-Module RAG Questions",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: 1000,
          temperature: 0.9,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: user },
          ],
        }),
      }),
      45_000,
      "rag questions timeout",
    );

    if (!upstream.ok) {
      const t = await upstream.text().catch(() => "");
      return errorResponse(`Upstream ${upstream.status}: ${t.slice(0, 200)}`, 502);
    }

    const json = await upstream.json();
    try {
      logLLM({
        functionName: "rag-questions-generate",
        model: (json as any)?.model as string,
        tokensIn: Number((json as any)?.usage?.prompt_tokens || 0),
        tokensOut: Number((json as any)?.usage?.completion_tokens || 0),
        userId: auth.userId,
      });
    } catch (_) { /* noop */ }

    const text = String(json?.choices?.[0]?.message?.content || "").trim();
    const questions = parseQuestions(text);
    if (questions.length < 3) {
      return errorResponse("Модель не смогла сгенерировать осмысленные запросы. Попробуйте еще раз.", 502);
    }

    return jsonResponse({ questions });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});
