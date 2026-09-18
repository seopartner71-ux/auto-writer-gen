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

const SYSTEM_PROMPT = `Ты эксперт по AI Search Intent. Твоя задача - сгенерировать ровно 12 реалистичных разговорных запросов, которые пользователи задают поисковым ИИ (ChatGPT, Perplexity, Яндекс Алиса, Google AI Overviews).

ПРАВИЛА:

1. Смешивай информационные запросы (примерно 7) и коммерческие B2B/B2C запросы (примерно 5).
   - Информационные: "Чем отличается...", "Как выбрать...", "Что лучше...", "Какие бывают виды...", "Как проверить качество...".
   - Коммерческие: "Где купить оптом...", "Лучший поставщик...", "Рейтинг производителей...", "Заказать с доставкой в...", "Цены на...".

2. Запросы должны быть естественными, как их реально формулируют живые люди в голосовом или текстовом диалоге с ИИ, а не SEO-ключи. Без неестественной keyword-стопки.

3. Учитывай регион, если он задан. Учитывай конкретные товары/бренды из списка сущностей, но не повторяй одну и ту же формулировку.

4. Язык: русский (или язык ввода, если контекст на другом языке). Не используй букву "ё", пиши "е".

5. Формат вывода: СТРОГО по одному вопросу на строку. Без нумерации, без markdown, без кавычек, без вступлений и пояснений, без пустых строк в начале и конце. Ровно 12 строк.

6. Каждый запрос должен быть конкретным и осмысленным, без воды.`;

const clean = (v: unknown): string =>
  String(v ?? "").replace(/\*\*/g, "").replace(/ё/g, "е").replace(/Ё/g, "Е").trim();

/** Extract clean question lines from the model output. */
function parseQuestions(text: string): string[] {
  const lines = text
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .split("\n")
    .map((l) => clean(l).replace(/^[-*\d.)\]\s]+/, "").replace(/[.。]\s*$/, "").trim())
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

    const user = [
      `Клиент / бренд: ${body.client_name || "не указан"}`,
      `Домен: ${body.domain || "не указан"}`,
      `Регион: ${body.region || "не указан"}`,
      `Ниша / категория: ${body.topics || body.niche || "не указана"}`,
      `Тип рынка: ${body.niche_type === "b2b" ? "B2B" : "B2C"}`,
      `Объект рейтинга: ${body.subject === "product" ? "физические товары каталога" : "компании и поставщики"}`,
      entities.length ? `Сущности / позиции: ${entities.join(", ")}` : "Сущности / позиции: не указаны",
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
