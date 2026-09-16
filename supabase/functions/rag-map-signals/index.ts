// Admin-only helper: maps automatically collected public signals (HTTPS, schema markup,
// contacts, speed, crawlability, domain age) onto the analyst's scoring metrics, so measured
// values can populate the score matrix instead of manual guessing.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdminOrStaff } from "../_shared/auth.ts";
import { withTimeout } from "../_shared/withTimeout.ts";
import { logLLM } from "../_shared/costLogger.ts";

interface MetricIn { name: string; description?: string }
interface SignalIn { key: string; label: string }
interface ReqBody { metrics?: MetricIn[]; signals?: SignalIn[] }

const SYSTEM_PROMPT = `Ты Senior Data Scientist. Тебе дан список метрик скоринговой модели и список измеренных публичных сигналов сайта.

Задача: сопоставить каждой метрике максимум один сигнал, который действительно измеряет ту же сущность.

ПРАВИЛА:
1. Если ни один сигнал не измеряет метрику по существу - верни signal_key = null. Ложное сопоставление хуже отсутствия.
2. Один сигнал можно назначить только одной метрике.
3. Штрафные и рисковые метрики (Penalty, Risk, Probability) почти никогда не измеряются техническими сигналами сайта - для них обычно null.
4. confidence - число от 0 до 1.

Ответь СТРОГО валидным JSON без markdown:
{"mapping":[{"metric":"Infrastructure_Capacity_Index","signal_key":"Site_Structure_Score","confidence":0.7,"rationale":"краткое пояснение"}]}`;

function parseMapping(text: string): Array<{ metric: string; signal_key: string | null; confidence: number; rationale: string }> {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch { return []; }
  const arr = (parsed as { mapping?: unknown })?.mapping;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((raw) => ({
      metric: String((raw as any)?.metric ?? "").trim(),
      signal_key: (raw as any)?.signal_key ? String((raw as any).signal_key).trim() : null,
      confidence: Math.min(1, Math.max(0, Number((raw as any)?.confidence) || 0)),
      rationale: String((raw as any)?.rationale ?? "").trim().replace(/ё/g, "е").replace(/Ё/g, "Е"),
    }))
    .filter((m) => m.metric.length > 0);
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

    const metrics = (body.metrics ?? []).filter((m) => m?.name).slice(0, 12);
    const signals = (body.signals ?? []).filter((s) => s?.key).slice(0, 20);
    if (metrics.length === 0 || signals.length === 0) {
      return errorResponse("Нужны метрики и собранные сигналы", 400);
    }

    const sb = adminClient();
    const { data: rateOk } = await sb.rpc("check_rate_limit", {
      p_user_id: auth.userId,
      p_action: "rag_map_signals",
      p_max_requests: 40,
      p_window_minutes: 60,
    });
    if (rateOk === false) return errorResponse("Слишком много запросов. Попробуйте позже.", 429);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OPENROUTER_API_KEY not configured", 500);

    const user = [
      "МЕТРИКИ МОДЕЛИ:",
      ...metrics.map((m) => `- ${m.name}${m.description ? ` (${m.description})` : ""}`),
      "",
      "ИЗМЕРЕННЫЕ СИГНАЛЫ:",
      ...signals.map((s) => `- ${s.key}: ${s.label}`),
    ].join("\n");

    const upstream = await withTimeout(
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://seo-modul.pro",
          "X-Title": "SEO-Module RAG Signal Mapping",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: 1200,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: user },
          ],
        }),
      }),
      45_000,
      "rag signal mapping timeout",
    );

    if (!upstream.ok) {
      const t = await upstream.text().catch(() => "");
      return errorResponse(`Upstream ${upstream.status}: ${t.slice(0, 200)}`, 502);
    }

    const json = await upstream.json();
    try {
      logLLM({
        functionName: "rag-map-signals",
        model: (json as any)?.model as string,
        tokensIn: Number((json as any)?.usage?.prompt_tokens || 0),
        tokensOut: Number((json as any)?.usage?.completion_tokens || 0),
        userId: auth.userId,
      });
    } catch (_) { /* noop */ }

    const text = String(json?.choices?.[0]?.message?.content || "").trim();
    const raw = parseMapping(text);

    // Keep only known names and enforce one signal per metric.
    const metricNames = new Set(metrics.map((m) => m.name));
    const signalKeys = new Set(signals.map((s) => s.key));
    const used = new Set<string>();
    const mapping = raw
      .filter((m) => metricNames.has(m.metric))
      .map((m) => {
        const key = m.signal_key && signalKeys.has(m.signal_key) && !used.has(m.signal_key) ? m.signal_key : null;
        if (key) used.add(key);
        return { ...m, signal_key: key };
      });

    return jsonResponse({ mapping });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});
