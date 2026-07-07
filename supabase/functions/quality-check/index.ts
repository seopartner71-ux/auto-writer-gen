// Quality check for articles: SEO-Module Score (Turgenev-like), Text.ru uniqueness, AI-Score (human-likeness).
// Triggered manually from the editor. Spends 1 credit when text.ru uniqueness is requested.
//
// Body: { article_id: string, content: string, checks?: ('score'|'uniqueness'|'ai')[] }
// Returns: { turgenev_score, uniqueness_percent, ai_human_score, quality_badge, details }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logCost } from "../_shared/costLogger.ts";
import { logPipelineEvent, startTimer } from "../_shared/pipelineLogger.ts";
import { ensureHtml, isStaleStatus } from "../_shared/ensureHtml.ts";
import { analyzeSentenceStructure } from "../_shared/sentenceStructure.ts";
import { analyzeCancellary } from "../_shared/validators/cancellaryGuard.ts";
import { analyzeKeywordFrequency } from "../_shared/validators/keywordFrequencyGuard.ts";
import { analyzeDanglingThoughts } from "../_shared/validators/danglingThoughtGuard.ts";
import { analyzeSanity } from "../_shared/contentSanity.ts";
import {
  getStyleProfile,
  sentenceOptionsFromStyleProfile,
  keywordOptionsFromStyleProfile,
  cancellaryOptionsFromStyleProfile,
  type StyleProfile,
} from "../_shared/styleProfile.ts";

async function logErr(admin: any, context: string, message: string, metadata?: Record<string, unknown>) {
  try {
    await admin.from("error_logs").insert({ context, message: String(message).slice(0, 500), metadata: metadata ?? {} });
  } catch (_) { /* never throw from logger */ }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripHtml(s: string): string {
  return s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackAiScore(plain: string): { score: number; verdict: string; reasons: string[] } {
  const sentences = splitSentences(plain);
  const words = plain.split(/\s+/).filter(Boolean);
  const starts = sentences.map((s) => s.split(/\s+/).slice(0, 2).join(" ").toLowerCase()).filter(Boolean);
  const duplicateStarts = starts.length - new Set(starts).size;
  const avgSentence = sentences.length ? words.length / sentences.length : 18;
  const burst = computeBurstiness(plain).sigma;
  const cliches = (plain.match(/\b(следует отметить|стоит отметить|важно понимать|на сегодняшний день|in conclusion|it is important to note|in today's world)\b/gi) || []).length;
  let score = 78;
  if (burst < 5) score -= 18;
  if (avgSentence > 28 || avgSentence < 7) score -= 10;
  score -= Math.min(18, duplicateStarts * 3);
  score -= Math.min(16, cliches * 4);
  score = Math.max(35, Math.min(88, Math.round(score)));
  return {
    score,
    verdict: score >= 70 ? "скорее человек" : score >= 50 ? "погранично" : "скорее AI",
    reasons: ["Локальная эвристика применена из-за временной недоступности AI-проверки"],
  };
}

// Wrap a promise with a hard timeout. Resolves with `null` on timeout.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.error(`[quality-check] ${label} timed out after ${ms}ms`);
      resolve(null);
    }, ms);
    p.then((v) => { clearTimeout(timer); resolve(v); })
     .catch((e) => { clearTimeout(timer); console.error(`[quality-check] ${label} error`, e); resolve(null); });
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Fallback chain for AI scoring calls.
// Если первичная модель отдаёт 402/429/5xx (нет средств/лимит) — пробуем альтернативу.
// Если tool-calling недоступен — пробуем JSON-mode и парсим content.
async function callScoringWithFallback(opts: {
  apiKey: string;
  sys: string;
  user: string;
  toolName: string;
  toolSchema: Record<string, unknown>;
  label: string;
}): Promise<{ data: any; args: string | null }> {
  const { apiKey, sys, user, toolName, toolSchema, label } = opts;
  const attempts: Array<{ model: string; mode: "tools" | "json" }> = [
    { model: "google/gemini-2.5-flash-lite", mode: "tools" },
    { model: "google/gemini-2.5-flash", mode: "tools" },
    { model: "google/gemini-2.5-flash", mode: "json" },
    { model: "openai/gpt-5-nano", mode: "json" },
    // Last-resort: cheap Llama on OpenRouter, JSON mode. Keeps ai_score from
    // becoming NULL when whole Gemini/GPT cascade is down or out of budget.
    { model: "meta-llama/llama-3.3-70b-instruct", mode: "json" },
  ];

  let got402 = false;
  let lastErr = "";

  for (let i = 0; i < attempts.length; i++) {
    const { model, mode } = attempts[i];
    const body: any = {
      model,
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: mode === "json"
            ? `${user}\n\nВерни СТРОГО валидный JSON по схеме: ${JSON.stringify(toolSchema)}. Без markdown, без комментариев.`
            : user,
        },
      ],
    };
    if (mode === "tools") {
      body.tools = [{ type: "function", function: { name: toolName, parameters: toolSchema } }];
      body.tool_choice = { type: "function", function: { name: toolName } };
    } else {
      body.response_format = { type: "json_object" };
    }

    let res: Response;
    try {
      res = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      }, 30000);
    } catch (e) {
      console.error(`[quality-check] ${label} attempt ${i} (${model}/${mode}) network error`, e);
      continue;
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const fallbackable = res.status === 402 || res.status === 429 || res.status >= 500 || res.status === 404;
      console.error(`[quality-check] ${label} attempt ${i} (${model}/${mode}) HTTP ${res.status} ${txt.slice(0, 200)}`);
      if (res.status === 402) got402 = true;
      lastErr = `HTTP ${res.status}: ${txt.slice(0, 120)}`;
      if (!fallbackable) return { data: null, args: null };
      continue;
    }

    const data = await res.json().catch(() => null);
    if (!data) continue;

    let args: string | null = null;
    if (mode === "tools") {
      args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? null;
    } else {
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === "string") {
        const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        args = cleaned;
      }
    }
    if (args) {
      if (i > 0) console.log(`[quality-check] ${label} succeeded via fallback ${i} (${model}/${mode})`);
      return { data, args };
    }
  }

  // Whole cascade exhausted. If we saw at least one 402 (insufficient credit)
  // or all attempts failed, fire a one-shot TG alert (rate-limited via cache
  // Технические TG-алерты отключены по политике уведомлений.
  return { data: null, args: null };
}

// (fireOpenRouterAlert удалён — технические алерты убраны)

// ---- 1. SEO-Module Score (Turgenev-like) ----
async function runSeoModuleScore(plain: string, apiKey: string): Promise<{
  score: number; stylistics: number; water: number; reasons: string[];
  tokens_in: number; tokens_out: number;
} | null> {
  const sample = plain.slice(0, 5000);
  const sys = "Ты строгий редактор. Оцениваешь текст по аналогии с сервисом Тургенев. Выводи только результат через инструмент.";
  const user = `Оцени текст по 3 метрикам:
1) overall_score (0-10) - общий риск, чем меньше тем лучше. <=4 - отлично.
2) stylistics (0-10) - канцелярит, штампы, бюрократизмы. Меньше - лучше.
3) water (0-10) - водянистость, пустые фразы, обороты "стоит отметить", "необходимо понимать". Меньше - лучше.
4) reasons - до 4 коротких пунктов что плохо (если оценка >=3) или почему хорошо.

Текст:
${sample}`;

  const toolSchema = {
    type: "object",
    properties: {
      overall_score: { type: "number" },
      stylistics: { type: "number" },
      water: { type: "number" },
      reasons: { type: "array", items: { type: "string" } },
    },
    required: ["overall_score", "stylistics", "water", "reasons"],
    additionalProperties: false,
  };
  const { data, args } = await callScoringWithFallback({
    apiKey,
    sys,
    user,
    toolName: "report_score",
    toolSchema,
    label: "seo-score",
  });
  if (!args) return null;
  try {
    const p = JSON.parse(args);
    return {
      score: Math.max(0, Math.min(10, Math.round(Number(p.overall_score) || 0))),
      stylistics: Math.max(0, Math.min(10, Math.round(Number(p.stylistics) || 0))),
      water: Math.max(0, Math.min(10, Math.round(Number(p.water) || 0))),
      reasons: Array.isArray(p.reasons) ? p.reasons.slice(0, 4).map(String) : [],
      tokens_in: data?.usage?.prompt_tokens || 0,
      tokens_out: data?.usage?.completion_tokens || 0,
    };
  } catch { return null; }
}

// ---- 2. SEO-Module AI-Score (human-likeness) ----
async function runAiScore(plain: string, apiKey: string): Promise<{
  score: number; verdict: string; reasons: string[];
  tokens_in: number; tokens_out: number;
} | null> {
  const sample = plain.slice(0, 5000);
  const sys = "Ты эксперт по детекции AI-текстов. Анализируешь perplexity, burstiness, повторы, предсказуемость структуры. Выводи только результат через инструмент.";
  const user = `Оцени текст по шкале 0-100 насколько он написан человеком. 100 = точно человек, 0 = точно AI.
Анализируй:
- вариативность длины предложений (одинаковые = AI)
- естественность переходов
- наличие клише и шаблонных конструкций
- предсказуемость структуры
- повторяющиеся обороты

Верни score (0-100), verdict ("человек"/"скорее человек"/"скорее AI"/"AI"), reasons (до 4 пунктов).

Текст:
${sample}`;

  const toolSchema = {
    type: "object",
    properties: {
      score: { type: "number" },
      verdict: { type: "string" },
      reasons: { type: "array", items: { type: "string" } },
    },
    required: ["score", "verdict", "reasons"],
    additionalProperties: false,
  };
  const { data, args } = await callScoringWithFallback({
    apiKey,
    sys,
    user,
    toolName: "report_ai_score",
    toolSchema,
    label: "ai-score",
  });
  if (!args) return null;
  try {
    const p = JSON.parse(args);
    return {
      score: Math.max(0, Math.min(100, Math.round(Number(p.score) || 0))),
      verdict: String(p.verdict || ""),
      reasons: Array.isArray(p.reasons) ? p.reasons.slice(0, 4).map(String) : [],
      tokens_in: data?.usage?.prompt_tokens || 0,
      tokens_out: data?.usage?.completion_tokens || 0,
    };
  } catch { return null; }
}

// ---- 3. Text.ru uniqueness (АНТИПЛАГИАТ — НЕ AI-детектор) ----
// Стандартный antiplagiat API text.ru: POST /post -> uid; затем POST /post с uid до получения text_unique.
// AI-score рассчитывается отдельно через Claude+Gemini, text.ru тут не участвует.
async function runTextRuUniqueness(plain: string, apiKey: string): Promise<
  | { ok: true; uniqueness: number; words: number; raw: any; matches: any[] }
  | { ok: false; error: string; code?: number }
> {
  const text = plain.slice(0, 150000);
  if (text.length < 100) {
    return { ok: false, error: "Текст слишком короткий для проверки уникальности (минимум 100 символов)" };
  }

  const post = async (form: Record<string, string>) => {
    const fd = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) fd.append(k, v);
    const res = await fetchWithTimeout("https://api.text.ru/post", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: fd.toString(),
    }, 30_000);
    const j: any = await res.json().catch(() => ({}));
    return { res, j };
  };

  // Step 1: submit text for antiplagiat check
  const { res: submitRes, j: submitJson } = await post({
    text,
    userkey: apiKey,
    visible: "vis_on",
  });
  if (!submitRes.ok || !submitJson?.text_uid) {
    console.error("[quality-check] text.ru antiplagiat submit failed", submitRes.status, submitJson);
    const code = Number(submitJson?.error_code) || submitRes.status;
    let msg = submitJson?.error_desc || "Сервис Text.ru недоступен";
    if (/баланс|symbol/i.test(msg)) {
      msg = "На балансе Text.ru закончились символы. Пополните баланс на text.ru/account/balance.";
    } else if (submitRes.status === 401 || /ключ|key|userkey/i.test(msg)) {
      msg = "Неверный или просроченный API-ключ Text.ru (TEXTRU_API_KEY).";
    } else if (submitRes.status === 429) {
      msg = "Превышен лимит запросов к Text.ru. Попробуйте через минуту.";
    }
    return { ok: false, error: msg, code };
  }
  const uid = String(submitJson.text_uid);

  // Step 2: poll for result up to ~120s (40 * 3s)
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const { j: pollJson } = await post({ uid, userkey: apiKey, jsonvisible: "detail" });
    // While processing, text.ru returns error_code=181 ("Текст еще не проверен")
    if (pollJson?.error_code && Number(pollJson.error_code) === 181) continue;
    if (pollJson?.text_unique != null) {
      const uniq = Math.max(0, Math.min(100, Math.round(Number(pollJson.text_unique))));
      let matches: any[] = [];
      try {
        const detail = typeof pollJson.result_json === "string"
          ? JSON.parse(pollJson.result_json)
          : pollJson.result_json;
        if (Array.isArray(detail?.urls)) matches = detail.urls.slice(0, 10);
      } catch { /* ignore */ }
      return {
        ok: true,
        uniqueness: uniq,
        words: text.trim().split(/\s+/).filter(Boolean).length,
        raw: { uid, text_unique: uniq, spam_percent: pollJson.spam_percent, water_percent: pollJson.water_percent },
        matches,
      };
    }
    if (pollJson?.error_code) {
      return { ok: false, error: pollJson?.error_desc || "Text.ru вернул ошибку", code: Number(pollJson.error_code) };
    }
  }
  return { ok: false, error: "Text.ru не вернул результат за отведённое время" };
}

function computeBadge(turg: number | null, uniq: number | null, ai: number | null): "excellent" | "good" | "needs_work" | null {
  const checks: boolean[] = [];
  if (turg !== null) checks.push(turg <= 4);
  if (uniq !== null) checks.push(uniq >= 85);
  if (ai !== null) checks.push(ai >= 80);
  if (!checks.length) return null;
  const greens = checks.filter(Boolean).length;
  if (greens === checks.length) return "excellent";
  if (greens >= Math.ceil(checks.length / 2)) return "good";
  return "needs_work";
}

// ─── AUTO-MODE HELPERS (burstiness, keyword density, ZeroGPT) ───
function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
function computeBurstiness(plain: string): { sigma: number; status: "ok" | "warning" | "fail" } {
  const sents = splitSentences(plain);
  if (sents.length < 5) return { sigma: 0, status: "fail" };
  const lens = sents.map((s) => s.split(/\s+/).filter(Boolean).length);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
  const sigma = Math.sqrt(variance);
  let status: "ok" | "warning" | "fail" = "fail";
  if (sigma >= 8) status = "ok";
  else if (sigma >= 5) status = "warning";
  return { sigma: Math.round(sigma * 100) / 100, status };
}
function computeDensity(plain: string, keyword: string): number {
  if (!keyword) return 0;
  const words = plain.toLowerCase().split(/\s+/).filter(Boolean);
  const total = words.length;
  if (!total) return 0;
  const kw = keyword.toLowerCase().trim();
  const kwWords = kw.split(/\s+/).filter(Boolean);
  let count = 0;
  if (kwWords.length === 1) {
    count = words.filter((w) => w.replace(/[^а-яa-zё0-9-]/gi, "") === kwWords[0]).length;
  } else {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    count = (plain.match(re) || []).length;
  }
  return Math.round(((count / total) * 100) * 100) / 100;
}
function densityStatus(density: number, median: number): "ok" | "overuse" | "underuse" {
  if (median <= 0) return "ok";
  if (density > median + 0.5) return "overuse";
  if (density < median - 0.5) return "underuse";
  return "ok";
}
async function runClaudeAiScore(plain: string, key: string): Promise<{ score: number; reasons: string[] } | null> {
  try {
    // Truncate on a sentence boundary within 2000 chars so the judge doesn't
    // penalise an artificial cut-off. Fall back to hard slice if no terminator.
    const raw = plain.slice(0, 2000);
    const lastEnd = Math.max(raw.lastIndexOf("."), raw.lastIndexOf("!"), raw.lastIndexOf("?"), raw.lastIndexOf("…"));
    const sample = lastEnd > 800 ? raw.slice(0, lastEnd + 1) : raw;
    const res = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4",
        max_tokens: 150,
        temperature: 0,
        messages: [
          { role: "system", content: "Ты - детектор ИИ-текста. Формат ответа СТРОГО: первая строка - целое число 0-100, далее 2-3 короткие причины, каждая с новой строки, по 5-12 слов." },
          { role: "user", content: `Оцени текст по шкале 0-100.\n100 = написан живым человеком, естественный стиль.\n0 = явный ИИ, шаблонные фразы, предсказуемый ритм.\n\nВАЖНО: это фрагмент длинного текста, обрыв в конце не учитывай.\n\nОтветь так:\n<число>\n- <причина 1>\n- <причина 2>\n- <причина 3, если есть>\n\nТекст:\n${sample}` },
        ],
      }),
    }, 30000);
    if (!res.ok) {
      console.error("[quality-check] claude ai-score error", res.status);
      return null;
    }
    const data = await res.json();
    const respText = String(data?.choices?.[0]?.message?.content || "").trim();
    const m = respText.match(/\d{1,3}/);
    const n = m ? parseInt(m[0], 10) : NaN;
    const score = Number.isNaN(n) ? 50 : Math.max(0, Math.min(100, n));
    // Parse reasons: lines after the first number line, stripping bullets/dashes.
    const lines = respText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const reasons: string[] = [];
    for (const line of lines) {
      if (/^\d{1,3}\b/.test(line) && reasons.length === 0) continue; // skip the number line
      const cleaned = line.replace(/^[-*•\d.)\s]+/, "").trim();
      if (cleaned.length >= 3) reasons.push(cleaned);
      if (reasons.length >= 3) break;
    }
    return { score, reasons };
  } catch (e) {
    console.error("[quality-check] claude ai-score exception", e);
    return null;
  }
}

// ---- Turgenev (Ashmanov) - real Yandex Baden-Baden risk check ----
interface TurgenevResult {
  score: number;
  status: "ok" | "warning" | "fail";
  details: { repeats: number; style: number; spam: number; water: number; readability: number };
}
async function runTurgenevCheck(plain: string, turgenevKey: string): Promise<TurgenevResult | null> {
  try {
    const form = new URLSearchParams();
    form.set("api", "risk");
    form.set("key", turgenevKey);
    form.set("text", plain.slice(0, 50000));
    form.set("more", "1");
    const res = await fetchWithTimeout("https://turgenev.ashmanov.com/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }, 15000);
    if (!res.ok) {
      console.error("[quality-check] turgenev http", res.status);
      return null;
    }
    const data: any = await res.json().catch(() => ({}));
    if (data?.error) {
      console.error("[quality-check] turgenev api error:", data.error);
      return null;
    }
    // Real Turgenev API returns: { risk: "22", level: "...", details: [{block,sum},...] }
    const totalScore = Number(data?.risk);
    if (!Number.isFinite(totalScore)) {
      console.error("[quality-check] turgenev unexpected payload", JSON.stringify(data).slice(0, 300));
      return null;
    }
    const status: TurgenevResult["status"] = totalScore <= 5 ? "ok" : totalScore <= 10 ? "warning" : "fail";
    const detailMap: Record<string, number> = {};
    if (Array.isArray(data?.details)) {
      for (const d of data.details) {
        if (d?.block) detailMap[String(d.block)] = Number(d.sum) || 0;
      }
    }
    return {
      score: totalScore,
      status,
      details: {
        repeats: detailMap.frequency || 0,
        style: detailMap.style || 0,
        spam: detailMap.keywords || 0,
        water: detailMap.formality || 0,
        readability: detailMap.readability || 0,
      },
    };
  } catch (e) {
    console.error("[quality-check] turgenev exception", e);
    return null;
  }
}

const RU_STOPWORDS = new Set([
  "и", "в", "во", "не", "на", "что", "с", "по", "а", "но", "как", "к", "из", "за", "для", "от", "до", "или", "о", "у",
  "это", "же", "ли", "бы", "то", "так", "там", "тут", "вот", "еще", "уже", "при", "без", "под", "над", "об", "со",
]);
const TURG_WATER = [
  "в принципе", "в целом", "как известно", "следует отметить", "на сегодняшний день", "в современном мире", "в наше время",
  "можно сказать", "стоит отметить", "как правило", "в связи с этим", "таким образом", "в данной статье", "по сути",
];
const TURG_STYLE = [
  "очень", "просто", "именно", "действительно", "достаточно", "весьма", "крайне", "максимально", "является",
  "данный", "эффективный", "качественный", "профессиональный", "современный", "уникальный",
];
const TURG_CLICHES = [
  "ключ к успеху", "залог успеха", "играет важную роль", "не секрет что", "открывает новые возможности", "представляет собой",
];

function metricTokens(text: string): string[] {
  return (text.toLowerCase().replace(/ё/g, "е").match(/[a-zа-я0-9]+/gi) || []) as string[];
}
function phraseCount(text: string, phrases: string[]): number {
  const lower = text.toLowerCase().replace(/ё/g, "е");
  return phrases.reduce((sum, phrase) => {
    const safe = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return sum + (lower.match(new RegExp(`\\b${safe}\\b`, "g")) || []).length;
  }, 0);
}
function localTurgenevFallback(plain: string): TurgenevResult {
  const tokens = metricTokens(plain);
  const wordCount = Math.max(1, tokens.length);
  const per1k = (n: number) => (n / wordCount) * 1000;
  const waterCount = phraseCount(plain, TURG_WATER);
  const styleCount = phraseCount(plain, TURG_STYLE) + phraseCount(plain, TURG_CLICHES) * 2;
  const freq = new Map<string, number>();
  for (const token of tokens) {
    if (token.length < 4 || RU_STOPWORDS.has(token)) continue;
    freq.set(token, (freq.get(token) || 0) + 1);
  }
  const topCount = Math.max(0, ...Array.from(freq.values()));
  const repeatRatio = topCount / wordCount;
  const sentences = splitSentences(plain);
  const avgSentLen = sentences.length ? wordCount / sentences.length : wordCount;
  const longWordRatio = tokens.filter((t) => t.length >= 12).length / wordCount;
  const water = per1k(waterCount) < 1.5 ? 0 : per1k(waterCount) < 3 ? 1 : 2;
  const style = per1k(styleCount) < 4 ? 0 : per1k(styleCount) < 8 ? 1 : 2;
  const repeats = repeatRatio < 0.025 ? 0 : repeatRatio < 0.045 ? 1 : 2;
  const spam = repeatRatio * 100 < 2.5 ? 0 : repeatRatio * 100 < 4 ? 1 : 2;
  const readability = Math.min(2, (avgSentLen > 22 ? 1 : 0) + (avgSentLen > 32 ? 1 : 0) + (longWordRatio > 0.22 ? 1 : 0));
  const score = water + style + repeats + spam + readability;
  return {
    score,
    status: score <= 3 ? "ok" : score <= 6 ? "warning" : "fail",
    details: { repeats, style, spam, water, readability },
  };
}

function localUniquenessFallback(plain: string): { score: number; details: Record<string, unknown> } {
  const normalized = plain.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9.!?\s]/gi, " ").replace(/\s+/g, " ").trim();
  const tokens = metricTokens(normalized).filter((t) => t.length > 3 && !RU_STOPWORDS.has(t));
  const sentences = splitSentences(normalized).map((s) => s.trim()).filter((s) => s.length > 20);
  const uniqueRatio = tokens.length ? new Set(tokens).size / tokens.length : 0.7;
  const duplicateSentences = sentences.length - new Set(sentences).size;
  const duplicateSentenceRatio = sentences.length ? duplicateSentences / sentences.length : 0;
  const freq = new Map<string, number>();
  for (const token of tokens) freq.set(token, (freq.get(token) || 0) + 1);
  const topDensity = tokens.length ? Math.max(0, ...Array.from(freq.values())) / tokens.length : 0;
  const cliches = phraseCount(normalized, [...TURG_WATER, ...TURG_CLICHES]);
  let score = 88;
  if (uniqueRatio < 0.42) score -= 10;
  if (uniqueRatio < 0.34) score -= 10;
  score -= Math.min(12, Math.round(topDensity * 180));
  score -= Math.min(10, Math.round(duplicateSentenceRatio * 60));
  score -= Math.min(8, cliches * 2);
  score = Math.max(62, Math.min(92, Math.round(score)));
  return {
    score,
    details: {
      source: "local_fallback_before_textru",
      note: "Оценка не заменяет Text.ru, а закрывает NULL до внешней проверки",
      unique_ratio: Math.round(uniqueRatio * 1000) / 1000,
      top_term_density: Math.round(topDensity * 1000) / 1000,
      duplicate_sentence_ratio: Math.round(duplicateSentenceRatio * 1000) / 1000,
      cliches,
    },
  };
}

async function runAutoQuality(
  admin: any, articleId: string, userId: string, content: string, apiKey: string,
  opts: { skipAutoFixes?: boolean } = {},
) {
  const plain = stripHtml(content);
  if (plain.length < 200) {
    const shortUniq = localUniquenessFallback(plain);
    await admin.from("articles").update({
      quality_status: "too_short",
      quality_badge: "needs_work",
      turgenev_score: 0,
      turgenev_status: "ok",
      turgenev_details: { source: "too_short", repeats: 0, style: 0, spam: 0, water: 0, readability: 0 },
      uniqueness_percent: shortUniq.score,
      uniqueness_checked_at: new Date().toISOString(),
      quality_checked_at: new Date().toISOString(),
    }).eq("id", articleId);
    return;
  }

  // Mark as checking
  await admin.from("articles").update({ quality_status: "checking" }).eq("id", articleId);

  // Fetch article + keyword (for density target)
  const { data: art } = await admin.from("articles")
    .select("keyword_id, keywords, language, author_profile_id").eq("id", articleId).maybeSingle();

  // Resolve StyleProfile from article's author preset so validators use
  // the SAME thresholds as generation. Falls back to "default".
  let styleProfile: StyleProfile = getStyleProfile(null);
  if (art?.author_profile_id) {
    try {
      const { data: author } = await admin.from("author_profiles")
        .select("style_analysis").eq("id", art.author_profile_id).maybeSingle();
      const preset = (author?.style_analysis as any)?.syntax_profile;
      styleProfile = getStyleProfile(preset);
    } catch (_) { /* keep default */ }
  }

  let primaryKeyword = "";
  let medianDensity = 0;
  if (art?.keyword_id) {
    const { data: kw } = await admin.from("keywords")
      .select("seed_keyword, competitor_lists").eq("id", art.keyword_id).maybeSingle();
    primaryKeyword = String(kw?.seed_keyword || "");
    const cached = (kw?.competitor_lists as any)?._cached_result;
    medianDensity = Number(cached?.benchmark?.median_keyword_density) || 0;
  }
  if (!primaryKeyword && Array.isArray(art?.keywords) && art.keywords.length) {
    primaryKeyword = String(art.keywords[0]);
  }

  const orKey = Deno.env.get("OPENROUTER_API_KEY");
  const textRuKeyAuto = Deno.env.get("TEXTRU_API_KEY");

  // Resolve Turgenev key from admin api_keys vault (only RU articles)
  let turgenevKey: string | null = null;
  const isRu = String(art?.language || "ru").toLowerCase() === "ru";
  if (isRu) {
    // NOTE: api_keys uses `is_valid`, not `is_active`. The previous filter on
    // `is_active` silently returned null for every RU article, which is why
    // turgenev_score stayed NULL even when a key was configured.
    const { data: tk } = await admin.from("api_keys")
      .select("api_key").eq("provider", "turgenev").eq("is_valid", true).maybeSingle();
    if (tk?.api_key) turgenevKey = tk.api_key as string;
    if (!turgenevKey) {
      await logErr(admin, "quality-check", "turgenev_key_missing", { article_id: articleId });
    }
  }
  if (isRu && !textRuKeyAuto) {
    const fallbackUniq = localUniquenessFallback(plain);
    const { data: currentDetails } = await admin.from("articles").select("quality_details").eq("id", articleId).maybeSingle();
    await admin.from("articles").update({
      uniqueness_percent: fallbackUniq.score,
      uniqueness_checked_at: new Date().toISOString(),
      quality_details: { ...((currentDetails?.quality_details as any) || {}), uniqueness_details: fallbackUniq.details, uniqueness_error: "TEXTRU_API_KEY missing" },
    }).eq("id", articleId);
    await logErr(admin, "quality-check", "textru_key_missing", { article_id: articleId });
  }

  const [aiInternalRes, claudeRes, turgenevRes, clusterFitRes] = await Promise.all([
    withTimeout(runAiScore(plain, apiKey), 30000, "ai-internal"),
    orKey ? withTimeout(runClaudeAiScore(plain, orKey), 30000, "ai-claude") : Promise.resolve(null),
    turgenevKey ? withTimeout(runTurgenevCheck(plain, turgenevKey), 12000, "turgenev") : Promise.resolve(null),
    primaryKeyword
      ? withTimeout(
          runClusterFitness(content, primaryKeyword, art?.keyword_id || null, admin, apiKey),
          25000,
          "cluster-fit",
        ).catch((e) => { console.warn("[cluster-fit] failed", e); return null; })
      : Promise.resolve(null),
  ]);

  const heuristicAi = aiInternalRes?.score == null && claudeRes == null ? fallbackAiScore(plain) : null;
  const aiInternal = aiInternalRes?.score ?? heuristicAi?.score ?? null;
  const aiClaude = claudeRes?.score ?? null;
  const aiClaudeReasons: string[] = claudeRes?.reasons ?? [];
  const aiInternalReasons: string[] = aiInternalRes?.reasons ?? [];
  if (aiInternalRes?.score == null && claudeRes == null) {
    console.warn("[quality-check] AI checks unavailable, used local fallback", { articleId });
  }
  if (turgenevKey && !turgenevRes) await logErr(admin, "quality-check", "turgenev_call_failed", { article_id: articleId });
  const turgenevFinal = isRu ? ((turgenevRes as TurgenevResult | null) ?? localTurgenevFallback(plain)) : null;
  if (isRu && !turgenevRes) {
    await logErr(admin, "quality-check", "turgenev_local_fallback_used", { article_id: articleId, has_key: Boolean(turgenevKey) });
  }
  const aiCombined = aiInternal !== null && aiClaude !== null
    ? Math.round((aiInternal + aiClaude) / 2)
    : (aiInternal ?? aiClaude ?? null);

  const burst = computeBurstiness(plain);
  const density = primaryKeyword ? computeDensity(plain, primaryKeyword) : 0;
  const dStatus = primaryKeyword && medianDensity > 0 ? densityStatus(density, medianDensity) : "ok";

  // ── Sentence structure analysis ───────────────────────────────────
  // Ловим "телеграфный" AI-стиль: серии коротких подряд, низкая средняя длина.
  const sentStruct = analyzeSentenceStructure(plain, sentenceOptionsFromStyleProfile(styleProfile));
  const sentStatus: "ok" | "warning" | "fail" =
    sentStruct.verdict === "fail" ? "fail" : sentStruct.verdict === "warning" ? "warning" : "ok";

  // ── Validators v2: канцеляризмы, частотность ключа, обрывы мысли ──
  const cancellary = analyzeCancellary(plain, cancellaryOptionsFromStyleProfile(styleProfile));
  const keywordFreq = analyzeKeywordFrequency(content, primaryKeyword || null, keywordOptionsFromStyleProfile(styleProfile));
  const dangling = analyzeDanglingThoughts(content);
  const toStatus = (v: "pass" | "warning" | "fail"): "ok" | "warning" | "fail" =>
    v === "fail" ? "fail" : v === "warning" ? "warning" : "ok";
  const cancStatus = toStatus(cancellary.verdict);
  const freqStatus = toStatus(keywordFreq.verdict);
  const dangStatus = toStatus(dangling.verdict);

  // Compute aggregate quality_status
  // ai_score: <50 fail, 50-69 warning, >=70 ok (higher = more human-like)
  let aiStatus: "ok" | "warning" | "fail" = "ok";
  if (aiCombined !== null) {
    if (aiCombined < 50) aiStatus = "fail";
    else if (aiCombined < 70) aiStatus = "warning";
  }
  const turgStatus: "ok" | "warning" | "fail" = turgenevFinal?.status ?? "ok";
  const all = [
    aiStatus,
    burst.status,
    dStatus === "ok" ? "ok" : (dStatus === "underuse" ? "warning" : "fail"),
    turgenevFinal ? turgStatus : "ok",
    sentStatus,
    cancStatus,
    freqStatus,
    dangStatus,
  ];
  let quality: "ok" | "warning" | "fail" = "ok";
  if (all.includes("fail")) quality = "fail";
  else if (all.includes("warning")) quality = "warning";

  // Mirror to legacy badge
  const badge = quality === "ok" ? "excellent" : (quality === "warning" ? "good" : "needs_work");

  const updatePatch: Record<string, any> = {
    ai_score_internal: aiInternal,
    ai_score_claude: aiClaude,
    ai_score: aiCombined,
    ai_human_score: aiCombined,
    burstiness_score: burst.sigma,
    burstiness_status: burst.status,
    keyword_density: density,
    keyword_density_status: dStatus,
    quality_status: quality,
    quality_badge: badge,
    quality_checked_at: new Date().toISOString(),
  };
  // Explicit error trail: surfaces in admin UI when metrics fall back / fail.
  const qErrors: string[] = [];
  if (aiInternalRes?.score == null && claudeRes == null) qErrors.push("ai_score:local_heuristic_fallback");
  if (isRu && turgenevKey && !turgenevRes) qErrors.push("turgenev:api_failed_used_local_fallback");
  if (isRu && !turgenevKey) qErrors.push("turgenev:key_missing_used_local_fallback");
  {
    const { data: prevDet } = await admin.from("articles").select("quality_details").eq("id", articleId).maybeSingle();
    updatePatch.quality_details = {
      ...((prevDet?.quality_details as any) || {}),
      ai_internal_reasons: aiInternalReasons,
      ai_claude_reasons: aiClaudeReasons,
      sentence_structure: {
        verdict: sentStruct.verdict,
        status: sentStatus,
        avg_words: sentStruct.avgWords,
        sentence_count: sentStruct.sentenceCount,
        short_ratio: sentStruct.shortRatio,
        long_ratio: sentStruct.longRatio,
        max_short_run: sentStruct.maxShortRun,
        short_runs_3plus: sentStruct.shortRuns3Plus.slice(0, 5),
        issues: sentStruct.issues,
        checked_at: new Date().toISOString(),
      },
      validators: {
        sentence_structure: {
          verdict: sentStruct.verdict,
          avg_words: sentStruct.avgWords,
          short_ratio: sentStruct.shortRatio,
          max_short_run: sentStruct.maxShortRun,
          issues: sentStruct.issues,
        },
        cancellary: {
          verdict: cancellary.verdict,
          total_hits: cancellary.totalHits,
          unique_hits: cancellary.uniqueHits,
          hits: cancellary.hits.slice(0, 8),
          issues: cancellary.issues,
        },
        keyword_frequency: {
          verdict: keywordFreq.verdict,
          top_overused: keywordFreq.topOverused.slice(0, 5),
          seed_keyword: keywordFreq.seedKeyword,
          seed_overuse_sections: keywordFreq.seedOveruseSections.slice(0, 5),
          issues: keywordFreq.issues,
        },
        dangling_thoughts: {
          verdict: dangling.verdict,
          hit_count: dangling.hits.length,
          hits: dangling.hits.slice(0, 5),
          issues: dangling.issues,
        },
        checked_at: new Date().toISOString(),
      },
      ...(qErrors.length ? { errors: qErrors, errors_at: new Date().toISOString() } : {}),
    };
  }
  if (turgenevFinal) {
    updatePatch.turgenev_score = turgenevFinal.score;
    updatePatch.turgenev_status = turgStatus;
    updatePatch.turgenev_details = {
      ...turgenevFinal.details,
      source: turgenevRes ? "turgenev_api" : "local_fallback",
    };
  }
  if (clusterFitRes && typeof (clusterFitRes as any).score === "number") {
    updatePatch.cluster_fitness_score = (clusterFitRes as any).score;
    updatePatch.cluster_fitness_details = (clusterFitRes as any).details ?? null;
  }
  await admin.from("articles").update(updatePatch).eq("id", articleId);

  // ── Auto text.ru uniqueness in background (RU only, if key configured) ──
  if (isRu && textRuKeyAuto) {
    const uniqTask = (async () => {
      try {
        const r = await withTimeout(runTextRuUniqueness(plain, textRuKeyAuto!), 120000, "textru-auto");
        const ok = r && (r as any).ok === true;
        if (ok) {
          await admin.from("articles").update({
            uniqueness_percent: (r as any).uniqueness,
            uniqueness_checked_at: new Date().toISOString(),
          }).eq("id", articleId);
        } else {
          const fallbackUniq = localUniquenessFallback(plain);
          const { data: currentDetails } = await admin.from("articles").select("quality_details").eq("id", articleId).maybeSingle();
          await admin.from("articles").update({
            uniqueness_percent: fallbackUniq.score,
            uniqueness_checked_at: new Date().toISOString(),
            quality_details: { ...((currentDetails?.quality_details as any) || {}), uniqueness_details: fallbackUniq.details, uniqueness_error: (r as any)?.error || "Text.ru не вернул результат" },
          }).eq("id", articleId);
          const errCode = (r as any)?.code;
          const errText = (r as any)?.error || "";
          // code 142 = баланс кончился (config issue, не баг). Помечаем ключ
          // невалидным, чтобы не дёргать API впустую, и шумим в error_logs
          // максимум раз в 24 часа.
          if (errCode === 142 || /закончились символы|balance/i.test(errText)) {
            try {
              await admin.from("api_keys")
                .update({ is_valid: false, last_error: errText.slice(0, 200) })
                .eq("provider", "textru");
            } catch (_) { /* column last_error may not exist; ignore */ }
            const { data: recent } = await admin
              .from("error_logs")
              .select("id")
              .eq("context", "quality-check")
              .eq("message", "textru_balance_exhausted")
              .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
              .limit(1);
            if (!recent || recent.length === 0) {
              await logErr(admin, "quality-check", "textru_balance_exhausted", {
                article_id: articleId, error: errText, code: errCode,
              });
            }
          } else {
            await logErr(admin, "quality-check", "textru_auto_failed", {
              article_id: articleId, error: errText, code: errCode,
            });
          }
        }
      } catch (e) {
        await logErr(admin, "quality-check", "textru_auto_exception", { article_id: articleId, error: String(e) });
      }
    })();
    try { (globalThis as any).EdgeRuntime?.waitUntil?.(uniqTask); } catch (_) { void uniqTask; }
  }

  // ── Auto-Humanize: ai_score < 40 (detected as AI) → silent rewrite, once ──
  // NOTE: our ai_score semantics: HIGHER = more human-like. So "AI-detected" = LOW score.
  try {
    // Per-user threshold (profiles.auto_humanize_threshold). 0 = disabled. Default 40.
    let humanizeThreshold = 40;
    try {
      const { data: prof } = await admin
        .from("profiles").select("auto_humanize_threshold").eq("id", userId).maybeSingle();
      const t = (prof as any)?.auto_humanize_threshold;
      if (typeof t === "number") humanizeThreshold = t;
    } catch (_) { /* keep default */ }

    // NaN-gate fix: aiCombined === null (all judges failed) MUST count as
    // "score missing, humanize needed" — previously `null < 40` was false and
    // the pass was silently skipped, leaving low-quality drafts unimproved.
    const aiCombinedMissing = aiCombined == null || Number.isNaN(Number(aiCombined));
    const humanizeTriggered =
      !opts.skipAutoFixes && humanizeThreshold > 0 && orKey &&
      (aiCombinedMissing || (typeof aiCombined === "number" && aiCombined < humanizeThreshold));
    if (aiCombinedMissing && humanizeThreshold > 0 && !opts.skipAutoFixes) {
      // Explicit trace so it's visible WHY we entered humanize with no score.
      logPipelineEvent({
        stage: "quality-check",
        article_id: articleId,
        user_id: userId,
        verdict: "warning",
        duration_ms: 0,
        meta: { event: "auto_humanize_null_score_trigger", reason: "ai_score_unavailable_treat_as_needs_humanize" },
      });
    }
    if (humanizeTriggered) {
      // Suppressed: server-side auto_humanize was creating zombie runs that
      // bypassed cycle_progress. The user-driven relay cycle in improve-article
      // is the single orchestrator now.
      logPipelineEvent({
        stage: "quality-check",
        article_id: articleId,
        user_id: userId,
        verdict: "warning",
        duration_ms: 0,
        meta: { event: "auto_fix_suppressed", kind: "auto_humanize", ai_combined: aiCombined },
      });
    }
  } catch (e) {
    await logErr(admin, "quality-check", "auto_humanize_gate_error", { article_id: articleId, error: String(e) });
  }

  // ── Anti-Turgenev Auto-Fix ────────────────────────────────────────
  // Если реальный балл Turgenev API >= 8 (высокий риск Баден-Баден) и автофикс
  // ещё не запускался для этой статьи - тихо вызываем improve-article
  // с fix_type="turgenev". Только для русского, и только один раз.
  try {
    const turgScore = turgenevFinal?.score ?? null;
    if (
      !opts.skipAutoFixes &&
      isRu &&
      typeof turgScore === "number" &&
      turgScore >= 8 &&
      orKey
    ) {
      const { data: artFlag } = await admin
        .from("articles")
        .select("turgenev_auto_fixed,content")
        .eq("id", articleId)
        .maybeSingle();
      if (artFlag && artFlag.turgenev_auto_fixed !== true) {
        await admin
          .from("articles")
          .update({ turgenev_auto_fixed: true })
          .eq("id", articleId);
        logPipelineEvent({
          stage: "quality-check",
          article_id: articleId,
          user_id: userId,
          verdict: "warning",
          duration_ms: 0,
          meta: { event: "auto_fix_suppressed", kind: "auto_turgenev", turgenev_score: turgScore },
        });
      }
    }
  } catch (e) {
    console.warn("[quality-check] auto-turgenev-fix gate error", e);
  }

  // ── Validators v2 Auto-Fix dispatcher ───────────────────────────
  // Приоритет: dangling (структурно ломает текст) → sentence (стиль) →
  // cancellary (лексика) → keyword_frequency (тонкая настройка).
  // На один прогон quality-check диспатчится максимум один fix: следующая
  // фаза выберется при ре-чек после improve-article.
  // Анти-петля: каждая фаза помечается флагом в quality_details.
  try {
    if (orKey) {
      const { data: prevDet } = await admin.from("articles")
        .select("quality_details").eq("id", articleId).maybeSingle();
      const det: any = (prevDet?.quality_details as any) || {};

      type Phase = { name: string; fixType: string; source: string; flag: string; verdict: "pass" | "warning" | "fail" };
      const phases: Phase[] = [
        { name: "dangling", fixType: "dangling", source: "auto_dangling", flag: "dangling_auto_fixed", verdict: dangling.verdict },
        { name: "sentence", fixType: "sentence_structure", source: "auto_sentence_structure", flag: "sentence_structure_auto_fixed", verdict: sentStruct.verdict },
        { name: "cancellary", fixType: "cancellary", source: "auto_cancellary", flag: "cancellary_auto_fixed", verdict: cancellary.verdict },
        { name: "keyword_freq", fixType: "keyword_freq", source: "auto_keyword_freq", flag: "keyword_freq_auto_fixed", verdict: keywordFreq.verdict },
      ];

      const next = phases.find((p) => p.verdict === "fail" && det[p.flag] !== true);
      if (next) {
        await admin.from("articles").update({
          quality_details: { ...det, [next.flag]: true },
        }).eq("id", articleId);
        logPipelineEvent({
          stage: "quality-check",
          article_id: articleId,
          user_id: userId,
          verdict: "warning",
          duration_ms: 0,
          meta: { event: "auto_fix_suppressed", kind: next.source, phase: next.name },
        });
      }
    }
  } catch (e) {
    await logErr(admin, "quality-check", "auto_validators_gate_error", { article_id: articleId, error: String(e) });
  }
}

// ── Cluster Fitness ──────────────────────────────────────────────
// Splits article into paragraphs and asks the AI which ones stay within
// the main SERP cluster of the seed keyword. Returns 0..100 score plus
// per-paragraph breakdown for debugging.
async function runClusterFitness(
  htmlContent: string,
  primaryKeyword: string,
  keywordId: string | null,
  admin: any,
  apiKey: string,
): Promise<{ score: number; details: any } | null> {
  const plain = stripHtml(htmlContent);
  if (plain.length < 200) return null;

  // Split into paragraphs, take up to 40 (cap tokens).
  const paragraphs = plain
    .split(/\n{2,}|(?<=[.!?])\s{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40)
    .slice(0, 40);
  if (paragraphs.length < 3) return null;

  // Pull intent + must-cover topics from research data if available.
  let intent = "";
  let mustCover: string[] = [];
  if (keywordId) {
    const { data: kw } = await admin
      .from("keywords")
      .select("intent,must_cover_topics,lsi_keywords")
      .eq("id", keywordId)
      .maybeSingle();
    intent = String(kw?.intent || "");
    if (Array.isArray(kw?.must_cover_topics)) mustCover = kw.must_cover_topics.slice(0, 12);
  }

  const system = `Ты SEO-аналитик. Тебе даны абзацы статьи. Оцени для каждого абзаца, остаётся ли он внутри ОСНОВНОГО SERP-кластера ключа "${primaryKeyword}" (тот же интент, та же сущность, без ухода в смежные подинтенты вроде "скачать/приложение/регистрация/отзывы как отдельный URL"). Верни JSON.`;
  const user = `Основной ключ: "${primaryKeyword}"
Интент: ${intent || "не указан"}
Темы которые должны быть закрыты основным кластером:
${mustCover.length ? mustCover.map((t, i) => `${i + 1}. ${t}`).join("\n") : "(нет данных)"}

Абзацы статьи:
${paragraphs.map((p, i) => `[${i + 1}] ${p.slice(0, 400)}`).join("\n\n")}

Верни строго JSON:
{
  "in_cluster": [номера абзацев которые остаются в основном SERP-кластере],
  "off_cluster": [{"i": номер, "reason": "коротко чем именно уходит из кластера"}]
}`;

  const res = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  }, 60_000);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const raw = data?.choices?.[0]?.message?.content || "{}";
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return null; }

  const inCluster = Array.isArray(parsed?.in_cluster) ? parsed.in_cluster.length : 0;
  const offList = Array.isArray(parsed?.off_cluster) ? parsed.off_cluster : [];
  const total = paragraphs.length;
  const score = Math.max(0, Math.min(100, Math.round((inCluster / total) * 100)));

  return {
    score,
    details: {
      total_paragraphs: total,
      in_cluster: inCluster,
      off_cluster_count: offList.length,
      off_cluster: offList.slice(0, 10),
      keyword: primaryKeyword,
      checked_at: new Date().toISOString(),
    },
  };
}

// Exported for direct in-process invocation from other edge functions
// (e.g. improve-article) — avoids cross-function fetch that dies silently.
export { runAutoQuality };

// Gate the HTTP handler behind `import.meta.main` so this module can be
// imported from another edge function's isolate without double-binding
// Deno.serve. When Supabase Edge Runtime executes this file directly as a
// function entrypoint, import.meta.main === true and the handler is
// registered as before.
const __QC_HANDLER = async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const timer = startTimer();
  let articleIdForLog: string | null = null;
  let userIdForLog: string | null = null;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    const textRuKey = Deno.env.get("TEXTRU_API_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    if (!apiKey) return json({ error: "OPENROUTER_API_KEY not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const { article_id, content, checks, mode, dispatched_by } = body as {
      article_id?: string; content?: string; checks?: string[]; mode?: string;
      dispatched_by?: string;
    };
    if (!article_id) return json({ error: "article_id required" }, 400);
    if (!content || typeof content !== "string") return json({ error: "content required" }, 400);
    articleIdForLog = article_id;

    // Guarantee HTML for the whole check pipeline. If we converted, persist so
    // downstream (editor + improve-cycle) sees the canonical HTML form.
    let normalizedContent = content;
    {
      const norm = ensureHtml(content);
      if (norm.converted) {
        normalizedContent = norm.html;
        try {
          await admin.from("articles").update({ content: normalizedContent }).eq("id", article_id);
        } catch (_) { /* non-fatal */ }
        logPipelineEvent({
          stage: "quality-check",
          article_id,
          verdict: "warning",
          duration_ms: 0,
          meta: { event: "md_to_html_conversion", reason: norm.reason, before_bytes: content.length, after_bytes: normalizedContent.length },
        });
      }
    }

    // Stale-status auto-reset: if article is stuck in 'checking'/'improving'
    // with no pipeline_events for 10+ minutes, unblock it before we start.
    try {
      const { data: st0 } = await admin.from("articles").select("quality_status").eq("id", article_id).maybeSingle();
      const qs = (st0 as any)?.quality_status;
      // For 'checking' we care ONLY about quality_check/ai_detect events —
      // a lingering 'improve' event from the previous phase would otherwise
      // keep the row "fresh" forever and the reset would never fire.
      const staleStages = qs === "checking"
        ? ["quality_check", "ai_detect"]
        : ["improve", "humanize"];
      if ((qs === "checking" || qs === "improving") && await isStaleStatus(admin, article_id, 10 * 60 * 1000, staleStages)) {
        await admin.from("articles").update({ quality_status: null }).eq("id", article_id);
        logPipelineEvent({
          stage: "quality-check",
          article_id,
          verdict: "warning",
          duration_ms: 0,
          meta: { event: "stale_status_reset", was: qs, reason: "no_events_>10min" },
        });
      }
    } catch (_) { /* non-fatal */ }

    // Resolve user: try service-role bypass first (auto mode from bulk), then user JWT.
    const serviceToken = authHeader.replace(/^Bearer\s+/i, "") === serviceKey;
    let user: { id: string } | null = null;
    if (serviceToken) {
      const { data: art0 } = await admin.from("articles").select("user_id").eq("id", article_id).maybeSingle();
      if (art0?.user_id) user = { id: art0.user_id };
    } else {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user: u } } = await userClient.auth.getUser();
      if (u) user = { id: u.id };
    }
    if (!user) return json({ error: "Unauthorized" }, 401);
    userIdForLog = user.id;

    // ── AUTO mode: run AI(internal+ZeroGPT) + burstiness + density in background, no credits ──
    if (mode === "auto") {
      const { data: ownCheck } = await admin.from("articles").select("user_id").eq("id", article_id).maybeSingle();
      if (!ownCheck || ownCheck.user_id !== user.id) return json({ error: "Article not found" }, 404);
      // Mark immediately so polling sees "checking"
      await admin.from("articles").update({ quality_status: "checking" }).eq("id", article_id);
      // Когда quality-check вызывается из клиентского оркестратора autoStealthPass,
      // серверные fallback-автозапуски (auto_humanize / auto_turgenev) пропускаем,
      // чтобы не гонять improve-article параллельно с клиентским циклом.
      const skipAutoFixes = dispatched_by === "stealth";
      const bg = runAutoQuality(
        admin, article_id, user.id, normalizedContent, apiKey, { skipAutoFixes },
      ).catch(async (e) => {
        console.error("[quality-check] auto bg error", e);
        try {
          await admin.from("articles").update({ quality_status: "idle" }).eq("id", article_id);
        } catch (_) { /* ignore */ }
      });
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(bg); } catch (_) { void bg; }
      return json({ ok: true, queued: true });
    }

    const requested = new Set(Array.isArray(checks) && checks.length ? checks : ["score", "uniqueness", "ai"]);

    // Verify ownership
    const { data: art } = await admin.from("articles").select("id,user_id,quality_details").eq("id", article_id).maybeSingle();
    if (!art || art.user_id !== user.id) return json({ error: "Article not found" }, 404);

    const plain = stripHtml(normalizedContent);
    if (plain.length < 200) return json({ error: "Текст слишком короткий для проверки (минимум 200 символов)" }, 400);
    if (plain.length > 50000) return json({ error: "Текст слишком длинный (максимум 50000 символов)" }, 400);

    // Charge 1 credit only if uniqueness requested. If text.ru is unusable
    // (no key / no balance / no credits), skip uniqueness silently instead
    // of breaking the whole quality-check call.
    let creditCharged = false;
    let uniquenessSkipReason: string | null = null;
    if (requested.has("uniqueness")) {
      if (!textRuKey) {
        console.warn("[quality-check] uniqueness skipped: TEXTRU_API_KEY missing");
        uniquenessSkipReason = "textru_key_missing";
        requested.delete("uniqueness");
      } else {
        const { data: ok } = await admin.rpc("deduct_credit", { p_user_id: user.id });
        if (!ok) {
          console.warn("[quality-check] uniqueness skipped: not enough credits");
          uniquenessSkipReason = "no_credits";
          requested.delete("uniqueness");
        } else {
          creditCharged = true;
        }
      }
    }

    // Run fast checks (score + ai) inline. Uniqueness (text.ru, can take 60-120s) runs in background.
    const fastPromises: Promise<any>[] = [];
    const fastLabels: string[] = [];
    if (requested.has("score")) { fastPromises.push(withTimeout(runSeoModuleScore(plain, apiKey), 30000, "seo-score")); fastLabels.push("score"); }
    if (requested.has("ai")) { fastPromises.push(withTimeout(runAiScore(plain, apiKey), 30000, "ai-score")); fastLabels.push("ai"); }
    // Real Turgenev (Ashmanov) API check, when requested explicitly from UI.
    if (requested.has("turgenev")) {
      const { data: tk } = await admin.from("api_keys")
        .select("api_key").eq("provider", "turgenev").eq("is_valid", true).maybeSingle();
      const tKey = (tk as any)?.api_key as string | undefined;
      if (tKey) {
        fastPromises.push(withTimeout(runTurgenevCheck(plain, tKey), 20000, "turgenev"));
        fastLabels.push("turgenev");
      } else {
        fastPromises.push(Promise.resolve(null));
        fastLabels.push("turgenev");
      }
    }

    const fastResults = await Promise.all(fastPromises);
    const out: Record<string, any> = {};
    fastResults.forEach((r, i) => { out[fastLabels[i]] = r; });

    // Schedule uniqueness check as background task (does not block response).
    const uniquenessQueued = requested.has("uniqueness") && !!textRuKey;
    if (uniquenessQueued) {
      // Mark as pending so client UI can show "checking..." state
      try {
        await admin.from("articles").update({
          quality_details: { ...(art.quality_details as any || {}), uniqueness_pending: true },
        }).eq("id", article_id);
      } catch (_) { /* ignore */ }

      // Background task: run text.ru, write result, refund on failure.
      const bgTask = (async () => {
        try {
          const uniqRes = await withTimeout(runTextRuUniqueness(plain, textRuKey!), 120000, "textru-bg");
          const ok = uniqRes && (uniqRes as any).ok === true;
          const uniqVal = ok ? (uniqRes as any).uniqueness : null;
          const updPatch: Record<string, any> = {
            quality_details: {
              ...(art.quality_details as any || {}),
              uniqueness_pending: false,
              uniqueness_details: ok ? {
                words: (uniqRes as any).words,
                spam_percent: (uniqRes as any).raw?.spam_percent,
                water_percent: (uniqRes as any).raw?.water_percent,
                matches: (uniqRes as any).matches,
                source: "text.ru/antiplagiat",
              } : undefined,
              uniqueness_error: !ok ? ((uniqRes as any)?.error || "Сервис Text.ru не ответил вовремя") : undefined,
            },
          };
          if (uniqVal !== null) {
            updPatch.uniqueness_percent = uniqVal;
            updPatch.uniqueness_checked_at = new Date().toISOString();
          }
          await admin.from("articles").update(updPatch).eq("id", article_id);

          // Refund credit if failed
          if (!ok && creditCharged) {
            try {
              await admin.rpc("admin_add_credits", {
                p_user_id: user.id, p_amount: 1, p_notify: false,
                p_comment: "Возврат за упавшую проверку Text.ru",
              });
            } catch (_) { /* ignore */ }
          }
        } catch (e) {
          console.error("[quality-check] bg textru error", e);
        }
      })();
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(bgTask); } catch (_) { void bgTask; }
    }

    // turgenev_score in DB = REAL score from turgenev.ashmanov.com API only.
    // SEO-Module Score (Gemini emulation, out.score) is stored separately in details.
    const turg = (out.turgenev as TurgenevResult | null)?.score ?? null;
    const turgDetails = (out.turgenev as TurgenevResult | null)?.details ?? null;
    const turgStatus = (out.turgenev as TurgenevResult | null)?.status ?? null;
    // Uniqueness handled in background; not part of inline response.
    const uniq: number | null = null;
    const uniqError: string | null = null;
    const ai = out.ai?.score ?? null;

    // (refund logic moved into background task above)

    const existingDetails = (art.quality_details as any) || {};
    const details = {
      ...existingDetails,
      score_details: out.score ? { stylistics: out.score.stylistics, water: out.score.water, reasons: out.score.reasons } : existingDetails.score_details,
      ai_details: out.ai
        ? { verdict: out.ai.verdict, reasons: out.ai.reasons }
        : (requested.has("ai") && !out.ai ? fallbackAiScore(plain) : existingDetails.ai_details),
      uniqueness_details: existingDetails.uniqueness_details,
      uniqueness_pending: uniquenessQueued ? true : existingDetails.uniqueness_pending,
    };

    const fallbackManualAi = requested.has("ai") && !out.ai ? fallbackAiScore(plain) : null;
    const update: Record<string, any> = {
      quality_details: details,
      quality_checked_at: new Date().toISOString(),
    };
    if (turg !== null) update.turgenev_score = turg;
    if (turgDetails) update.turgenev_details = turgDetails;
    if (turgStatus) update.turgenev_status = turgStatus;
    if (uniq !== null) update.uniqueness_percent = uniq;
    if (ai !== null) update.ai_human_score = ai;
    else if (fallbackManualAi) update.ai_human_score = fallbackManualAi.score;

    // Compute badge from latest values (existing if not re-checked)
    const finalTurg = turg ?? null;
    const finalUniq = uniq ?? null;
    const finalAi = ai ?? null;
    // If only some were rechecked, fall back to existing for badge calc
    const { data: existing } = await admin.from("articles").select("turgenev_score,uniqueness_percent,ai_human_score").eq("id", article_id).maybeSingle();
    const badge = computeBadge(
      finalTurg ?? existing?.turgenev_score ?? null,
      finalUniq ?? existing?.uniqueness_percent ?? null,
      finalAi ?? fallbackManualAi?.score ?? existing?.ai_human_score ?? null,
    );
    if (badge) update.quality_badge = badge;

    await admin.from("articles").update(update).eq("id", article_id);

    {
      const turg = finalTurg ?? existing?.turgenev_score ?? null;
      const ai = finalAi ?? fallbackManualAi?.score ?? existing?.ai_human_score ?? null;
      const uniq2 = finalUniq ?? existing?.uniqueness_percent ?? null;
      const verdict: "pass" | "warning" | "fail" =
        (ai !== null && ai < 50) || (uniq2 !== null && uniq2 < 70) || (turg !== null && turg > 10)
          ? "fail"
          : (ai !== null && ai < 70) || (uniq2 !== null && uniq2 < 85) || (turg !== null && turg > 5)
          ? "warning"
          : "pass";
      logPipelineEvent({
        stage: "quality_check",
        article_id: article_id,
        user_id: user.id,
        verdict,
        score: ai,
        duration_ms: timer(),
        meta: {
          turgenev: turg,
          uniqueness: uniq2,
          ai_human: ai,
          checks: Array.from(requested),
          uniqueness_error: uniqError || null,
          badge,
        },
      });
    }

    // Cost logging
    const totalIn = (out.score?.tokens_in || 0) + (out.ai?.tokens_in || 0);
    const totalOut = (out.score?.tokens_out || 0) + (out.ai?.tokens_out || 0);
    const { data: artForCost } = await admin
      .from("articles").select("project_id").eq("id", article_id).maybeSingle();
    void logCost(admin, {
      user_id: user.id,
      project_id: artForCost?.project_id || null,
      operation_type: "article_generation" as any,
      model: "google/gemini-2.5-flash-lite",
      tokens_input: totalIn,
      tokens_output: totalOut,
      metadata: {
        kind: "quality_check",
        checks: Array.from(requested),
        article_id,
        textru_charged: creditCharged && uniq !== null,
      },
    });

    return json({
      turgenev_score: finalTurg ?? existing?.turgenev_score ?? null,
      uniqueness_percent: finalUniq ?? existing?.uniqueness_percent ?? null,
      ai_human_score: finalAi ?? fallbackManualAi?.score ?? existing?.ai_human_score ?? null,
      quality_badge: badge,
      details,
      checked_at: update.quality_checked_at,
      uniqueness_error: uniqError,
      uniqueness_pending: uniquenessQueued,
      credit_refunded: false,
    });
  } catch (e: any) {
    console.error("[quality-check] fatal", e);
    logPipelineEvent({
      stage: "quality_check",
      article_id: articleIdForLog,
      user_id: userIdForLog,
      verdict: "fail",
      error_kind: "exception",
      error_message: e?.message || String(e),
      duration_ms: timer(),
    });
    return json({ error: e?.message || "Unknown error" }, 500);
  }
};

// Bind HTTP handler only when this module is the process entry (Supabase
// Edge Runtime serves quality-check directly). When imported by another
// function's isolate (e.g. improve-article using runAutoQuality), skip
// the bind so we don't collide with the caller's own Deno.serve.
// import.meta.main is a Deno primitive: true iff this file is the entry.
// Fallback: try/catch guards against runtimes that don't set main.
if ((import.meta as any).main !== false) {
  try { Deno.serve(__QC_HANDLER); } catch (_) { /* already bound in imported context */ }
}