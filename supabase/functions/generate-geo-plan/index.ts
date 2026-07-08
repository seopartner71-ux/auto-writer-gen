// Streams a GEO action plan based on radar analysis data via OpenRouter.
// Body: { project_id: string, radar_data: object }
// Returns SSE stream (OpenAI-compatible deltas).

import { corsHeaders, handlePreflight, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { logLLM } from "../_shared/costLogger.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;

    const { project_id, radar_data } = await req.json().catch(() => ({}));
    if (!project_id) return errorResponse("project_id required", 400);

    const admin = adminClient();
    const { data: project } = await admin
      .from("radar_projects")
      .select("id, user_id, brand_name, domain, language")
      .eq("id", project_id)
      .maybeSingle();
    if (!project) return errorResponse("Project not found", 404);
    if (project.user_id !== userId) return errorResponse("Forbidden", 403);

    const lang = project.language === "en" ? "en" : "ru";
    const brand = project.brand_name || "";
    const domain = project.domain || "";

    // Resolve OpenRouter key (DB first, env fallback)
    let openrouterKey: string | null = null;
    try {
      const { data: kRow } = await admin
        .from("api_keys").select("api_key")
        .eq("provider", "openrouter").eq("is_valid", true)
        .limit(1).maybeSingle();
      openrouterKey = kRow?.api_key ?? null;
    } catch { /* ignore */ }
    openrouterKey = openrouterKey || Deno.env.get("OPENROUTER_API_KEY") || null;
    if (!openrouterKey) return errorResponse("OpenRouter API key not configured", 500);

    const sys = lang === "ru"
      ? `Ты GEO-стратег (Generative Engine Optimization). На основе данных аудита AI-видимости бренда составь конкретный пошаговый план действий на 30/60/90 дней для роста видимости в LLM (ChatGPT, Gemini, Claude, Perplexity и др.).
Структура ответа в markdown:
## Краткий диагноз
## Топ-3 приоритета (что делать в первую неделю)
## План на 30 дней
## План на 60 дней
## План на 90 дней
## KPI и контрольные метрики
Будь конкретным: указывай площадки (Reddit, Habr, Wikipedia, отраслевые медиа), форматы контента, типы упоминаний. Без воды, без общих фраз. Не используй жирный шрифт (**). Не используй букву "ё" (только "е"). Заменяй длинные тире на обычный дефис (-).`
      : `You are a GEO (Generative Engine Optimization) strategist. Based on the AI-visibility audit data for the brand, produce a concrete 30/60/90-day action plan to grow visibility in LLMs (ChatGPT, Gemini, Claude, Perplexity, etc.).
Markdown structure:
## Quick diagnosis
## Top-3 priorities (first week)
## 30-day plan
## 60-day plan
## 90-day plan
## KPIs and tracking metrics
Be specific: name platforms (Reddit, Wikipedia, industry media), content formats, mention types. No fluff. Do not use bold (**).`;

    const userPrompt = lang === "ru"
      ? `Бренд: ${brand}\nДомен: ${domain}\n\nДанные аудита GEO Radar (JSON):\n${JSON.stringify(radar_data, null, 2)}\n\nСоставь подробный план действий.`
      : `Brand: ${brand}\nDomain: ${domain}\n\nGEO Radar audit data (JSON):\n${JSON.stringify(radar_data, null, 2)}\n\nProduce a detailed action plan.`;

    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://seo-modul.pro",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        stream: true,
        temperature: 0.6,
        max_tokens: 3000,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const t = await upstream.text().catch(() => "");
      return errorResponse(`OpenRouter HTTP ${upstream.status}: ${t.slice(0, 300)}`, 502);
    }

    // Приближённая оценка стоимости стрима: считаем токены по длине промпта и cap max_tokens.
    // Точных usage-цифр в SSE OpenRouter обычно нет, поэтому пишем оценку — лучше, чем ноль.
    try {
      const promptChars = (sys.length + userPrompt.length);
      const approxIn = Math.round(promptChars / 4);
      logLLM({ functionName: "generate-geo-plan", model: "google/gemini-2.5-flash", tokensIn: approxIn, tokensOut: 3000, extraMeta: { estimated: true } });
    } catch(_) {}

    return new Response(upstream.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    console.error("[generate-geo-plan] fatal:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});