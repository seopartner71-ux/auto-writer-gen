// Topical Map: cluster keywords by intent into a content map.
// Body: { topic: string, geo?: string, language?: string }
// Returns: { ok, map_id, clusters, total_keywords, main_topic }

import { corsHeaders, jsonResponse, errorResponse, handlePreflight } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { withTimeout } from "../_shared/withTimeout.ts";

const SERPER_TIMEOUT_MS = 12000;
const AI_TIMEOUT_MS = 60000;

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
    if (!res.ok) {
      console.warn("[topical-map] serper", res.status, q);
      return {};
    }
    return await res.json();
  } catch (e) {
    console.warn("[topical-map] serper exception", e);
    return {};
  }
}

function extractKeywords(serp: SerperResp): string[] {
  const out: string[] = [];
  for (const o of serp.organic ?? []) {
    if (o.title) out.push(o.title);
  }
  for (const p of serp.peopleAlsoAsk ?? []) {
    if (p.question) out.push(p.question);
  }
  for (const r of serp.relatedSearches ?? []) {
    if (r.query) out.push(r.query);
  }
  return out;
}

function dedupeNormalize(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of items) {
    const norm = String(raw).trim().replace(/\s+/g, " ").toLowerCase();
    if (norm.length < 3 || norm.length > 120) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push(String(raw).trim());
  }
  return result.slice(0, 120);
}

async function clusterWithAI(topic: string, keywords: string[], lang: string): Promise<any> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");

  const langName = lang === "ru" ? "русском" : "английском";
  const system =
    "Ты SEO-эксперт. Кластеризуй ключевые слова по поисковому интенту и теме. Верни строго валидный JSON без markdown.";
  const user = `Кластеризуй эти ключевые слова для темы "${topic}". Сгруппируй по смыслу и интенту. Названия кластеров и ключи на ${langName} языке.

Ключевые слова:
${keywords.map((k, i) => `${i + 1}. ${k}`).join("\n")}

Верни JSON строго в формате (без обёрток, без markdown):
{
  "clusters": [
    {
      "name": "название кластера",
      "icon": "одиночное эмодзи",
      "intent": "informational|commercial|transactional",
      "keywords": [
        { "keyword": "запрос", "volume": "high|medium|low", "difficulty": "easy|medium|hard" }
      ]
    }
  ],
  "total_keywords": число,
  "main_topic": "главная тема"
}`;

  const res = await withTimeout(
    fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    }),
    AI_TIMEOUT_MS,
    "ai-gateway",
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI gateway ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "{}";
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("AI response not valid JSON");
  }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;

    const body = await req.json().catch(() => ({}));
    const topic = String(body.topic || "").trim();
    const geo = String(body.geo || "ru").toLowerCase();
    const language = String(body.language || "ru").toLowerCase();
    if (topic.length < 2 || topic.length > 120) {
      return errorResponse("topic required (2-120 chars)", 400);
    }

    const admin = adminClient();

    // Get Serper key
    const { data: serperRow } = await admin
      .from("api_keys")
      .select("api_key")
      .eq("provider", "serper")
      .eq("is_valid", true)
      .limit(1)
      .maybeSingle();
    if (!serperRow?.api_key) {
      return errorResponse("Serper API key not configured", 400);
    }

    // 5 search queries
    const queries = [
      topic,
      `как ${topic}`,
      `${topic} цена`,
      `${topic} отзывы`,
      `${topic} выбрать`,
    ];
    const serpResults = await Promise.all(
      queries.map((q) => serperQuery(serperRow.api_key, q, geo, language)),
    );

    const all: string[] = [];
    for (const r of serpResults) all.push(...extractKeywords(r));
    const keywords = dedupeNormalize(all);

    if (keywords.length < 5) {
      return errorResponse("Слишком мало запросов найдено для темы. Попробуйте более общую формулировку.", 400);
    }

    // Cluster with AI
    const clustered = await clusterWithAI(topic, keywords, language);
    const clusters = Array.isArray(clustered?.clusters) ? clustered.clusters : [];
    const totalKw = clusters.reduce(
      (s: number, c: any) => s + (Array.isArray(c?.keywords) ? c.keywords.length : 0),
      0,
    );

    if (clusters.length === 0) {
      return errorResponse("AI не смог кластеризовать запросы", 500);
    }

    // Save
    const { data: saved, error: saveErr } = await admin
      .from("topical_maps")
      .insert({
        user_id: userId,
        topic,
        geo,
        language,
        clusters,
        total_keywords: totalKw,
      })
      .select("id")
      .single();
    if (saveErr) {
      console.error("[topical-map] save error", saveErr);
      return errorResponse(`Save failed: ${saveErr.message}`, 500);
    }

    return jsonResponse({
      ok: true,
      map_id: saved.id,
      clusters,
      total_keywords: totalKw,
      main_topic: clustered?.main_topic || topic,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[topical-map] error", msg);
    return errorResponse(msg, 500);
  }
});