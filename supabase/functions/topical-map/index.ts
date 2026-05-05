// Topical Map: cluster keywords by intent into a content map.
// Body: { topic: string, geo?: string, city?: string, language?: string }
// Returns: { ok, map_id, clusters, total_keywords, main_topic }

import { corsHeaders, jsonResponse, errorResponse, handlePreflight } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { withTimeout, fetchWithTimeout } from "../_shared/withTimeout.ts";

const SERPER_TIMEOUT_MS = 12000;
const AI_TIMEOUT_MS = 60000;
const BUKVARIX_TIMEOUT_MS = 15000;

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

const SPAM_PATTERNS = [
  /ozon|wildberries|dns|eldorado|mvideo|avito/i,
  /всеинструмент|русклимат|юлмарт|ситилинк/i,
  /официальный сайт|интернет-магазин/i,
  /\.(ru|com|рф|net|org)\b/i,
  /[-–—]\s*(эльдорадо|dns|ozon|mvideo|ballu)/i,
  /\b(2024|2025|2026)\s*года?\b/i,
];

const isSpam = (s: string) =>
  SPAM_PATTERNS.some((p) => p.test(s)) || s.length > 65;

function dedupeNormalize(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of items) {
    const norm = String(raw).trim().replace(/\s+/g, " ").toLowerCase();
    if (norm.length < 3 || norm.length > 120) continue;
    if (isSpam(raw)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push(String(raw).trim());
  }
  return result.slice(0, 120);
}

const PROXY_BASE = "https://seo-modul.pro/api/proxy.php";
const BUKVARIX_URL = "https://api.bukvarix.com/v1/mkeywords/";

async function getBukvarixFrequency(keywords: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const batch = keywords.slice(0, 100);
  if (batch.length === 0) return result;

  try {
    const postBody = new URLSearchParams({
      api_key: "free",
      format: "json",
      json_type: "array",
      num: "250",
      q: batch.join("\r\n"),
    });

    const proxyUrl = `${PROXY_BASE}?external_url=${encodeURIComponent(BUKVARIX_URL)}`;

    console.log("[bukvarix] sending", batch.length, "keywords via proxy");
    const res = await fetchWithTimeout(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: postBody.toString(),
      timeoutMs: BUKVARIX_TIMEOUT_MS,
    });

    if (!res.ok) {
      console.warn("[bukvarix] error:", res.status);
      return result;
    }

    const data = await res.json().catch(() => null);
    const items = Array.isArray(data) ? data : [];
    console.log("[bukvarix] received", items.length, "items");
    for (const item of items) {
      if (!Array.isArray(item)) continue;
      const kw = item[0];
      const broad = item[3];
      if (kw && broad != null) {
        result.set(
          String(kw).toLowerCase().trim(),
          Number(broad) || 0,
        );
      }
    }

    console.log("[bukvarix] loaded:", result.size, "frequencies");
  } catch (e) {
    console.warn(
      "[bukvarix] exception:",
      e instanceof Error ? e.message : String(e),
    );
  }

  return result;
}

function freqToVolume(freq: number): { label: string; value: number; display: string } {
  if (freq >= 10000) return { label: "high", value: freq, display: freq.toLocaleString("ru") + "/мес" };
  if (freq >= 1000) return { label: "medium", value: freq, display: freq.toLocaleString("ru") + "/мес" };
  if (freq > 0) return { label: "low", value: freq, display: freq.toLocaleString("ru") + "/мес" };
  return { label: "unknown", value: 0, display: "—" };
}

const STOP_WORDS = new Set([
  "в","на","для","по","из","от","до","за","под","над","при","со","об","о","к","у","с",
  "и","или","а","но","же","ли","бы","как","что","это","то",
]);

function normalizeForMatch(s: string): string {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 4)
    .join(" ");
}

async function clusterWithAI(topic: string, keywords: string[], lang: string): Promise<any> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");

  const langName = lang === "ru" ? "русском" : "английском";
  const system =
    "Ты SEO-эксперт. Кластеризуй ключевые слова по поисковому интенту и теме. Верни строго валидный JSON без markdown.\n\nВАЖНО: в поле keyword должны быть ТОЛЬКО чистые поисковые запросы которые пользователь вводит в поисковик.\nЗАПРЕЩЕНО использовать:\n- Названия сайтов (Профи.ру, OZON, Авито, Wildberries, DNS и т.п.)\n- Заголовки страниц с тире и брендами\n- Слова commercial/transactional/informational в самом keyword\n- Строки длиннее 50 символов\nЕсли исходный запрос содержит название сайта или хвост через тире — очисти его до чистого поискового запроса (2-6 слов).";
  const user = `Кластеризуй эти ключевые слова для темы "${topic}". Сгруппируй по смыслу и интенту. Названия кластеров и ключи на ${langName} языке.

Ключевые слова:
${keywords.map((k, i) => `${i + 1}. ${k}`).join("\n")}

Верни JSON строго в формате (без обёрток, без markdown). Каждое keyword - короткий чистый поисковый запрос (без брендов, без тире, до 50 символов):
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
    const city = String(body.city || "").trim();
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

    // 5 search queries (city-aware if specified)
    const queries = city
      ? [
          `${topic} ${city}`,
          `как ${topic} ${city}`,
          `${topic} цена ${city}`,
          `${topic} отзывы ${city}`,
          `купить ${topic} ${city}`,
        ]
      : [
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
    if (clusters.length === 0) {
      return errorResponse("AI не смог кластеризовать запросы", 500);
    }

    // Enrich with real Bukvarix frequencies (best-effort)
    try {
      const allKws: string[] = [];
      for (const c of clusters) {
        for (const k of (c.keywords || [])) {
          if (k?.keyword) allKws.push(String(k.keyword));
        }
      }
      const freqMap = await getBukvarixFrequency(allKws);
      const lookup = (kw: string): number => {
        const orig = String(kw || "").toLowerCase().trim().replace(/\s+/g, " ");
        if (!orig) return 0;
        // 1) exact original
        let f = freqMap.get(orig) || 0;
        if (f > 0) return f;
        // 2) normalized (no stopwords, base form approximation)
        const norm = normalizeForMatch(kw);
        if (norm) {
          f = freqMap.get(norm) || 0;
          if (f > 0) return f;
        }
        // 3) fuzzy: count matched word stems (>= 60% of significant words)
        const kwWords = (norm || orig).split(" ").filter((w) => w.length > 2);
        if (kwWords.length === 0) return 0;
        const need = Math.max(1, Math.ceil(kwWords.length * 0.6));
        let bestVal = 0;
        for (const [key, val] of freqMap) {
          const keyWords = key.split(" ").filter((w) => w.length > 2);
          if (keyWords.length === 0) continue;
          let matches = 0;
          for (const w of kwWords) {
            const stem = w.slice(0, 5);
            if (keyWords.some((kk) => kk.startsWith(stem) || w.startsWith(kk.slice(0, 5)))) {
              matches++;
            }
          }
          if (matches >= need && val > bestVal) bestVal = val;
        }
        return bestVal;
      };
      for (const c of clusters) {
        let sum = 0;
        for (const k of (c.keywords || [])) {
          const f = lookup(String(k.keyword || ""));
          if (f > 0) {
            const v = freqToVolume(f);
            k.volume = v.label;
            k.frequency = v.value;
            k.frequency_display = v.display;
          } else {
            k.frequency = 0;
            k.frequency_display = "—";
          }
          sum += k.frequency || 0;
        }
        c.avg_frequency = Math.round(sum / Math.max(1, (c.keywords?.length || 1)));
        c.total_frequency = sum;
      }
    } catch (e) {
      console.warn("[topical-map] enrichment failed", e instanceof Error ? e.message : String(e));
    }

    const totalKw = clusters.reduce(
      (s: number, c: any) => s + (Array.isArray(c?.keywords) ? c.keywords.length : 0),
      0,
    );

    // Save
    const { data: saved, error: saveErr } = await admin
      .from("topical_maps")
      .insert({
        user_id: userId,
        topic,
        geo,
        city: city || null,
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