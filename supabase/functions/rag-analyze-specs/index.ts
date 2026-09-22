// Admin-only helper for the RAG benchmark generator.
// Replaces the hardcoded positive/negative keyword arrays of the DDF engine with a
// light LLM validator: it reads the free-text `specs` of a catalogue row and returns a
// deterministic anchor score (0/2/4/6/8/10) plus the detected features and a short reason.
//
// The function ONLY produces the L3 expert score input. Evidence caps, the Anti-Opacity
// filter and the seller layer stay in the deterministic client-side calculator.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdmin } from "../_shared/auth.ts";
import { chatJson, AiError } from "../_shared/aiClient.ts";

interface SpecItem { id?: string; specs?: string }
interface ReqBody { items?: SpecItem[]; category?: string }

const MAX_ITEMS = 24;
const MODEL = "google/gemini-2.5-flash";

const SYSTEM_PROMPT = `Ты - строгий детерминированный ИИ-валидатор b2b-датасетов.

Проанализируй технические характеристики товара. Определи категорию товара и оцени качество заполнения технических параметров по шкале от 0 до 10:
- Базовый уровень при наличии названия и цены - 6 баллов.
- Добавляй по +2 балла за каждый весомый, проверяемый технологический или ГОСТ-параметр (сертификаты, марки прочности, наличие документов, улучшенные модификации).
- Вычитай по -2 балла за маркеры б/у, ограничения, отсутствие документов или размытые формулировки.

Итоговый балл округли до одного из значений: 0, 2, 4, 6, 8, 10.
Не используй букву "е" с точками, пиши "е". Без markdown и без звездочек.

Верни ответ строго в формате JSON:
{"score": number, "detected_positive_features": ["строка1"], "detected_negative_features": ["строка1"], "reason": "короткое обоснование для слоя L2"}`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number" },
    detected_positive_features: { type: "array", items: { type: "string" } },
    detected_negative_features: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
  },
  required: ["score", "detected_positive_features", "detected_negative_features", "reason"],
} as const;

const clean = (v: unknown): string =>
  String(v ?? "").replace(/\*\*/g, "").replace(/ё/g, "е").replace(/Ё/g, "Е").trim();

/** Snap any model number to the published anchor scale 0/2/4/6/8/10. */
const toAnchor = (n: unknown): number => {
  const num = Number(n);
  if (!Number.isFinite(num)) return 6;
  return Math.max(0, Math.min(10, Math.round(num / 2) * 2));
};

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => clean(x)).filter(Boolean).slice(0, 8) : [];

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const forbidden = await requireAdmin(auth);
    if (forbidden) return forbidden;

    let body: ReqBody;
    try { body = await req.json(); } catch { body = {}; }

    const sb = adminClient();
    const { data: rateOk } = await sb.rpc("check_rate_limit", {
      p_user_id: auth.userId,
      p_action: "rag_analyze_specs",
      p_max_requests: 40,
      p_window_minutes: 60,
    });
    if (rateOk === false) return errorResponse("Слишком много запросов. Попробуйте позже.", 429);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OPENROUTER_API_KEY not configured", 500);

    const items = (Array.isArray(body.items) ? body.items : [])
      .map((it, i) => ({ id: String(it?.id ?? `R-${i}`), specs: String(it?.specs ?? "").slice(0, 2000).trim() }))
      .slice(0, MAX_ITEMS);
    if (!items.length) return errorResponse("Нет позиций с характеристиками", 400);

    const analyzeOne = async (item: { id: string; specs: string }) => {
      // Rows without specs are never invented: the calculator keeps them at NE.
      if (!item.specs) return { id: item.id, score: null, detected_positive_features: [], detected_negative_features: [], reason: "Характеристики не опубликованы" };
      try {
        const { data } = await chatJson<Record<string, unknown>>({
          apiKey,
          model: MODEL,
          system: SYSTEM_PROMPT,
          user: [
            body.category ? `Категория (подсказка): ${clean(body.category)}` : "",
            `Технические характеристики товара: ${item.specs}`,
          ].filter(Boolean).join("\n"),
          schema: SCHEMA as unknown as Record<string, unknown>,
          schemaName: "spec_analysis",
          temperature: 0,
          maxTokens: 600,
          timeoutMs: 45_000,
          appTitle: "SEO-Module RAG Specs",
          functionName: "rag-analyze-specs",
          userId: auth.userId,
        });
        return {
          id: item.id,
          score: toAnchor(data.score),
          detected_positive_features: list(data.detected_positive_features),
          detected_negative_features: list(data.detected_negative_features),
          reason: clean(data.reason).slice(0, 300),
        };
      } catch (e) {
        // A failed row falls back to the deterministic client-side analyzer.
        console.warn("[rag-analyze-specs] item failed", item.id, (e as Error)?.message);
        return { id: item.id, score: null, detected_positive_features: [], detected_negative_features: [], reason: "", failed: true };
      }
    };

    // Small batches keep the provider rate limit intact.
    const results: unknown[] = [];
    for (let i = 0; i < items.length; i += 4) {
      const chunk = items.slice(i, i + 4);
      results.push(...(await Promise.all(chunk.map(analyzeOne))));
    }

    return jsonResponse({ results });
  } catch (e) {
    const msg = e instanceof AiError ? e.message : (e as Error)?.message || "unknown error";
    console.error("[rag-analyze-specs]", msg);
    return errorResponse(msg, 500);
  }
});
