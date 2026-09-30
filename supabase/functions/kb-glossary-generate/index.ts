// Admin-only: generates neutral glossary terms for the Knowledge Base (GEO)
// from the client's topic, products and facts via OpenRouter.
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdmin } from "../_shared/auth.ts";
import { withTimeout } from "../_shared/withTimeout.ts";
import { logLLM } from "../_shared/costLogger.ts";

const clean = (v: unknown, max = 400): string =>
  String(v ?? "").replace(/\*\*/g, "").replace(/ё/g, "е").replace(/Ё/g, "Е")
    .replace(/[—–]/g, "-").replace(/\s+/g, " ").trim().slice(0, max);
const BANNED = /(лучш|лидер|надежн|оптимальн|номер один|№\s?1|самы[йе] )/i;

const SYSTEM = `Ты составляешь словарь терминов для открытой технической базы знаний компании.
Дай нейтральные, общепринятые определения терминов по тематике компании: материалы, изделия, единицы измерения, фракции, марки, стандарты, операции.
ЗАПРЕЩЕНО: реклама, оценки, названия конкурентов, цифры и характеристики, которых нет во входных данных, упоминание самой компании в определениях.
Не используй букву "ё", пиши "е". Не используй markdown и жирный шрифт. Вместо длинного тире - дефис.
Ответ строго JSON: {"terms":[{"term":"","definition":"1-2 предложения","context":"где применяется, коротко"}]}`;

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const forbidden = await requireAdmin(auth);
    if (forbidden) return forbidden;

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty */ }
    const topic = clean(body.topic, 1500);
    const products = clean(body.products, 1500);
    const facts = clean(body.facts, 3000);
    const existing = (Array.isArray(body.existing) ? body.existing : []).map((t) => clean(t, 80).toLowerCase()).filter(Boolean);
    const count = Math.min(15, Math.max(5, Number(body.count) || 8));
    if (!topic && !products && !facts) return errorResponse("Заполните описание компании, продукты или факты", 400);

    const sb = adminClient();
    const { data: rateOk } = await sb.rpc("check_rate_limit", {
      p_user_id: auth.userId, p_action: "kb_glossary", p_max_requests: 30, p_window_minutes: 60,
    });
    if (rateOk === false) return errorResponse("Слишком много запросов. Попробуйте позже.", 429);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OPENROUTER_API_KEY not configured", 500);

    const user = `Тематика и описание: ${topic}\nПродукты и услуги: ${products}\nФакты: ${facts}\n` +
      (existing.length ? `Уже есть (не повторять): ${existing.join(", ")}\n` : "") +
      `Нужно терминов: ${count}.`;

    const res = await withTimeout(fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
        "HTTP-Referer": "https://seo-modul.pro", "X-Title": "SEO-Modul KB glossary",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash", temperature: 0.3, max_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
      }),
    }), 60_000, "AI timeout");
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return errorResponse(res.status === 402 ? "Закончился баланс OpenRouter" : `OpenRouter ${res.status}: ${t.slice(0, 200)}`, res.status === 429 ? 429 : 502);
    }
    const json = await res.json();
    logLLM({ functionName: "kb-glossary-generate", model: json?.model, tokensIn: Number(json?.usage?.prompt_tokens || 0), tokensOut: Number(json?.usage?.completion_tokens || 0), userId: auth.userId });
    let raw = String(json?.choices?.[0]?.message?.content || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const a = raw.indexOf("{"); const b = raw.lastIndexOf("}");
    if (a >= 0 && b > a) raw = raw.slice(a, b + 1);
    let parsed: { terms?: unknown[] } = {};
    try { parsed = JSON.parse(raw); } catch { return errorResponse("Модель вернула невалидный ответ, повторите", 502); }
    const seen = new Set(existing);
    const terms = (parsed.terms || []).map((t: any) => ({
      term: clean(t?.term, 80), definition: clean(t?.definition, 400), context: clean(t?.context, 200),
    })).filter((t) => t.term && t.definition && !BANNED.test(t.definition) && !seen.has(t.term.toLowerCase()) && seen.add(t.term.toLowerCase()));
    return jsonResponse({ terms });
  } catch (e) {
    return errorResponse((e as Error)?.message || "error", 500);
  }
});
