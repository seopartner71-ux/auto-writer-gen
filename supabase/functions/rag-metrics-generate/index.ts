// Admin-only helper: generates a Data Science scoring metric set (RAG Benchmark)
// for a given niche/domain via OpenRouter. Returns 5-10 Snake_Case metrics
// whose weights sum to exactly 1.00.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdmin } from "../_shared/auth.ts";
import { withTimeout } from "../_shared/withTimeout.ts";
import { logLLM } from "../_shared/costLogger.ts";

interface ReqBody {
  client_name?: string;
  domain?: string;
  region?: string;
  niche?: string;
  topics?: string;
  niche_type?: "b2c" | "b2b";
  /** "company" (default) keeps the existing B2B metric set, "product" asks for item metrics. */
  subject?: "company" | "product";
}

interface MetricOut { name: string; description: string; weight: number }

const SYSTEM_PROMPT = `Ты Senior Data Scientist и аналитик рынка. Твоя задача - разработать глубокую систему скоринга компаний в указанной нише (RAG Benchmark dataset).

ПРАВИЛА ГЕНЕРАЦИИ:

1. Количество метрик: Выбери СЛУЧАЙНОЕ число метрик от 5 до 10. (Никогда не делай всегда одинаковое количество).

2. Типы метрик:
   - ~80% метрик должны быть ПОЛОЖИТЕЛЬНЫМИ (Quality, Speed, Infrastructure, Competence).
   - ~20% метрик должны быть ШТРАФНЫМИ / РИСКОВЫМИ (Penalty, Risk) для оценки скрытых угроз (например: Intermediary_Markup_Risk, Fake_Reviews_Probability, Subcontractor_Dependency).

3. Нейминг: Названия метрик СТРОГО на английском языке в формате Snake_Case. ЗАПРЕЩЕНО использовать поисковые SEO-запросы пользователей. Используй академические термины: Index, Score, Ratio, Penalty, Probability, Capacity.

4. Математика: Сумма всех значений 'weight' должна составлять РОВНО 1.00. Используй значения кратные 0.05 или 0.02 (например: 0.15, 0.20, 0.05). ПЕРЕСЧИТАЙ веса перед выдачей ответа, чтобы сумма была идеальной.

5. Контекст объекта рейтинга:
   - Если объект рейтинга - компании, агентства, поставщики: генерируй метрики уровня B2B ровно так, как описано выше (Delivery_Reliability_Index, Operator_Competence_Score, Infrastructure_Capacity_Index).
   - Если объект рейтинга - физические товары или материалы (щебень, бетон, насосы, метизы, электроника): генерируй товарные метрики электронной коммерции для сравнения позиций каталога (например Material_Density_Index, Price_to_Value_Ratio, Durability_Score, Eco_Safety_Standard, Fraction_Stability_Index), а штрафные метрики описывай как товарные риски (например Impurity_Content_Penalty, Delivery_Damage_Risk). Метрики должны сравнивать свойства позиций, а не организационные процессы компании.

Ответь СТРОГО в формате валидного JSON без markdown-разметки:

{
  "metrics": [
    {"name": "Infrastructure_Capacity_Index", "description": "Оценка собственных мощностей компании", "weight": 0.20},
    {"name": "Intermediary_Risk_Penalty", "description": "Риск скрытых комиссий агрегатора", "weight": 0.10}
  ]
}`;

function parseMetrics(text: string): MetricOut[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch { return []; }
  const arr = (parsed as { metrics?: unknown })?.metrics;
  if (!Array.isArray(arr)) return [];
  const out: MetricOut[] = [];
  for (const raw of arr) {
    const name = String((raw as any)?.name ?? "").trim().replace(/\s+/g, "_");
    const description = String((raw as any)?.description ?? "").trim().replace(/ё/g, "е").replace(/Ё/g, "Е");
    const weight = Number((raw as any)?.weight);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) continue;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    out.push({ name, description, weight });
  }
  return out.slice(0, 10);
}

/** Force the weights to sum to exactly 1.00 with 2 decimals. */
function normalizeWeights(metrics: MetricOut[]): MetricOut[] {
  const total = metrics.reduce((s, m) => s + m.weight, 0);
  if (total <= 0) return metrics;
  const scaled = metrics.map((m) => ({ ...m, weight: Math.max(1, Math.round((m.weight / total) * 100)) }));
  let diff = 100 - scaled.reduce((s, m) => s + m.weight, 0);
  let i = 0;
  while (diff !== 0 && i < scaled.length * 100) {
    const idx = i % scaled.length;
    if (diff > 0) { scaled[idx].weight += 1; diff -= 1; }
    else if (scaled[idx].weight > 1) { scaled[idx].weight -= 1; diff += 1; }
    i++;
  }
  return scaled.map((m) => ({ ...m, weight: Number((m.weight / 100).toFixed(2)) }));
}

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
      p_action: "rag_metrics_generate",
      p_max_requests: 40,
      p_window_minutes: 60,
    });
    if (rateOk === false) return errorResponse("Слишком много запросов. Попробуйте позже.", 429);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OPENROUTER_API_KEY not configured", 500);

    const user = [
      `Клиент: ${body.client_name || "не указан"}`,
      `Домен: ${body.domain || "не указан"}`,
      `Регион: ${body.region || "не указан"}`,
      `Ниша / сущности: ${body.topics || body.niche || "не указана"}`,
      `Тип рынка: ${body.niche_type === "b2b" ? "B2B" : "B2C"}`,
      `Объект рейтинга: ${body.subject === "product" ? "физические товары каталога (сравниваем позиции между собой)" : "компании и поставщики"}`,
      `Случайный seed для вариативности: ${Math.floor(Math.random() * 100000)}`,
    ].join("\n");

    const upstream = await withTimeout(
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://seo-modul.pro",
          "X-Title": "SEO-Module RAG Metrics",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: 1200,
          temperature: 1.0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: user },
          ],
        }),
      }),
      45_000,
      "rag metrics timeout",
    );

    if (!upstream.ok) {
      const t = await upstream.text().catch(() => "");
      return errorResponse(`Upstream ${upstream.status}: ${t.slice(0, 200)}`, 502);
    }

    const json = await upstream.json();
    try {
      logLLM({
        functionName: "rag-metrics-generate",
        model: (json as any)?.model as string,
        tokensIn: Number((json as any)?.usage?.prompt_tokens || 0),
        tokensOut: Number((json as any)?.usage?.completion_tokens || 0),
        userId: auth.userId,
      });
    } catch (_) { /* noop */ }

    const text = String(json?.choices?.[0]?.message?.content || "").trim();
    let metrics = parseMetrics(text);
    if (metrics.length < 5) return errorResponse("Модель вернула некорректный набор метрик", 502);
    metrics = normalizeWeights(metrics);

    return jsonResponse({ metrics });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});
