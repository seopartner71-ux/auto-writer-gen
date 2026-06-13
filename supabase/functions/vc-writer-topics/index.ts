// vc.ru topic generator. Returns N topic ideas for a niche, each with a suggested format.
// SEO mode: grounds topics in real search queries via Serper (PAA + related + organic titles)
// so the resulting articles can rank in Google/Yandex and host client links naturally.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatJson } from "../_shared/aiClient.ts";
import { pickVcModel, ruEReplace, isVcFormat } from "../_shared/vcWriterCore.ts";
import { withTimeout } from "../_shared/withTimeout.ts";

const SERPER_TIMEOUT_MS = 10000;

type SerperResp = {
  organic?: Array<{ title?: string; snippet?: string }>;
  peopleAlsoAsk?: Array<{ question?: string }>;
  relatedSearches?: Array<{ query?: string }>;
};

async function serperQuery(apiKey: string, q: string, gl: string, hl: string): Promise<SerperResp> {
  try {
    const res = await withTimeout(
      fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q, gl, hl, num: 10 }),
      }),
      SERPER_TIMEOUT_MS,
      "serper",
    );
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

function harvestQueries(resp: SerperResp): string[] {
  const out: string[] = [];
  for (const p of resp.peopleAlsoAsk ?? []) if (p.question) out.push(p.question);
  for (const r of resp.relatedSearches ?? []) if (r.query) out.push(r.query);
  for (const o of resp.organic ?? []) if (o.title) out.push(o.title);
  return out
    .map((s) => ruEReplace(s).trim())
    .filter((s) => s.length >= 8 && s.length <= 120);
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const niche = String(body.niche || "").trim();
    if (niche.length < 3) return errorResponse("niche required", 400);
    const count = Math.min(15, Math.max(3, Number(body.count) || 10));
    const preferredFormat = isVcFormat(body.preferred_format) ? body.preferred_format : null;
    const model = pickVcModel(body.model);
    const seoMode = body.seo_mode !== false; // default ON
    const seedKeywords: string[] = String(body.keywords || "")
      .split(/[\n,;]+/).map((s) => s.trim()).filter((s) => s.length >= 3).slice(0, 6);

    const admin = adminClient();
    const { data: orRow } = await admin
      .from("api_keys").select("api_key")
      .eq("provider", "openrouter").eq("is_valid", true).maybeSingle();
    const apiKey = orRow?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OpenRouter key not configured", 500);

    // ===== SEO mode: harvest real search queries via Serper =====
    let realQueries: string[] = [];
    let serperUsed = false;
    if (seoMode) {
      const { data: serperRow } = await admin
        .from("api_keys").select("api_key")
        .eq("provider", "serper").eq("is_valid", true).maybeSingle();
      const serperKey = serperRow?.api_key || Deno.env.get("SERPER_API_KEY");
      if (serperKey) {
        const seeds = (seedKeywords.length ? seedKeywords : [niche]).slice(0, 4);
        const results = await Promise.all(seeds.map((s) => serperQuery(serperKey, s, "ru", "ru")));
        const pool = new Set<string>();
        for (const r of results) for (const q of harvestQueries(r)) pool.add(q.toLowerCase());
        realQueries = Array.from(pool).slice(0, 60);
        serperUsed = realQueries.length > 0;
      }
    }

    const seoBlock = serperUsed
      ? `\nРЕАЛЬНЫЕ ПОИСКОВЫЕ ЗАПРОСЫ (из Google по этой нише, выбирай и группируй из них):\n${realQueries.map((q) => `- ${q}`).join("\n")}\n`
      : "";

    const system = seoMode
      ? `Ты SEO-редактор vc.ru. Твоя задача - предложить ${count} тем статей, которые: (а) залетят в топ vc.ru, (б) одновременно ранжируются в Google/Yandex по реальным коммерческим/информационным запросам. Для каждой темы указывай target_query - конкретный поисковый запрос (3-7 слов), под который оптимизируется статья. target_query ОБЯЗАТЕЛЬНО должен естественно входить в заголовок (точно или почти точно). Пиши на русском, БЕЗ буквы ё. Используй ТОЛЬКО обычный дефис "-", запрещены — и –.`
      : `Ты главред vc.ru. Твоя задача - предложить ${count} тем для статей в нише пользователя, которые залетят в топ vc.ru. Темы конкретные (с цифрами/конфликтом/неожиданным углом). Пиши на русском, БЕЗ буквы ё. Используй ТОЛЬКО обычный дефис "-".`;

    const seedBlock = seedKeywords.length ? `\nКлючевые слова от пользователя: ${seedKeywords.join(", ")}\n` : "";

    const user = `Ниша: ${niche}${seedBlock}${preferredFormat ? `Желаемый формат всех тем: ${preferredFormat}.\n` : "Подбери разные форматы (guide, rating, review, case) под характер темы.\n"}${seoBlock}\nВерни строго JSON:\n{\n  "topics": [\n    {\n      "topic": "заголовок-крючок (содержит target_query почти дословно)",\n      "format": "guide|rating|review|case",\n      "thesis": "что именно докажет статья, 1 предложение",\n      "target_query": "поисковый запрос 3-7 слов под который оптимизируем",\n      "intent": "informational|commercial|comparison|howto",\n      "search_volume_guess": "low|medium|high"\n    }\n  ]\n}\nРовно ${count} тем. ${serperUsed ? "Каждый target_query бери из списка реальных запросов выше (можно слегка перефразировать)." : "target_query формулируй как реальный поисковый запрос пользователя (без штампов, в нижнем регистре)."} Приоритет коммерческим и how-to запросам - они конвертят в клики по ссылкам. Не повторяй target_query между темами.`;

    const result = await chatJson<{
      topics: Array<{ topic: string; format: string; thesis: string; target_query?: string; intent?: string; search_volume_guess?: string }>;
    }>({
      apiKey, model, system, user,
      temperature: seoMode ? 0.7 : 0.95, maxTokens: 3000, timeoutMs: 90_000,
      appTitle: "vc.ru Topics", retries: 1,
    });

    const raw = Array.isArray(result.data?.topics) ? result.data.topics : [];
    const topics = raw.slice(0, count).map((t: any) => ({
      topic: ruEReplace(String(t?.topic || "")).slice(0, 180),
      format: isVcFormat(t?.format) ? t.format : (preferredFormat || "guide"),
      thesis: ruEReplace(String(t?.thesis || "")).slice(0, 300),
      target_query: ruEReplace(String(t?.target_query || "")).toLowerCase().slice(0, 120),
      intent: ["informational", "commercial", "comparison", "howto"].includes(String(t?.intent)) ? String(t?.intent) : "informational",
      search_volume_guess: ["low", "medium", "high"].includes(String(t?.search_volume_guess)) ? String(t?.search_volume_guess) : "medium",
    })).filter((t: any) => t.topic.length >= 5);

    return jsonResponse({ ok: true, topics, model: result.model, seo_mode: seoMode, serper_used: serperUsed, real_queries_count: realQueries.length });
  } catch (e: any) {
    console.error("[vc-writer-topics]", e?.message || e);
    const status = e?.status || (e?.kind === "budget" ? 402 : e?.kind === "rate_limit" ? 429 : 500);
    return errorResponse(e?.message || "Unknown error", status);
  }
});