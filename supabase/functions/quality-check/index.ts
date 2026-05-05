// Quality check for articles: SEO-Module Score (Turgenev-like), Text.ru uniqueness, AI-Score (human-likeness).
// Triggered manually from the editor. Spends 1 credit when text.ru uniqueness is requested.
//
// Body: { article_id: string, content: string, checks?: ('score'|'uniqueness'|'ai')[] }
// Returns: { turgenev_score, uniqueness_percent, ai_human_score, quality_badge, details }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logCost } from "../_shared/costLogger.ts";

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

  const res = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      tools: [{
        type: "function",
        function: {
          name: "report_score",
          description: "Report Turgenev-like score",
          parameters: {
            type: "object",
            properties: {
              overall_score: { type: "number" },
              stylistics: { type: "number" },
              water: { type: "number" },
              reasons: { type: "array", items: { type: "string" } },
            },
            required: ["overall_score", "stylistics", "water", "reasons"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "report_score" } },
    }),
  }, 30000);
  if (!res.ok) {
    console.error("[quality-check] seo-score AI error", res.status);
    return null;
  }
  const data = await res.json();
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
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

  const res = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      tools: [{
        type: "function",
        function: {
          name: "report_ai_score",
          parameters: {
            type: "object",
            properties: {
              score: { type: "number" },
              verdict: { type: "string" },
              reasons: { type: "array", items: { type: "string" } },
            },
            required: ["score", "verdict", "reasons"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "report_ai_score" } },
    }),
  }, 30000);
  if (!res.ok) {
    console.error("[quality-check] ai-score error", res.status);
    return null;
  }
  const data = await res.json();
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
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

// ---- 3. Text.ru uniqueness ----
// Использует Text.ru Нейропомощник (Detector). Уникальность = 100 - % AI.
// Два шага: POST /task/detector -> taskId; затем GET /task/detector/{taskId} до status=READY.
async function runTextRuUniqueness(plain: string, apiKey: string): Promise<
  | { ok: true; uniqueness: number; words: number; raw: any; ai_phrases: string[] }
  | { ok: false; error: string; code?: number }
> {
  // Neuro API limit: 20..20000 chars
  const text = plain.slice(0, 20000);
  if (text.length < 20) {
    return { ok: false, error: "Текст слишком короткий для проверки Text.ru (минимум 20 символов)" };
  }

  // Step 1: create task
  const submitRes = await fetch("https://api.text.ru/neurotools/api/v1/task/detector", {
    method: "POST",
    headers: { "X-USERKEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const submitJson: any = await submitRes.json().catch(() => ({}));
  if (!submitRes.ok || !submitJson?.taskId) {
    console.error("[quality-check] text.ru neuro submit failed", submitRes.status, submitJson);
    const code = Number(submitJson?.code) || submitRes.status;
    let msg = submitJson?.message || submitJson?.error_desc || "Сервис Text.ru недоступен";
    if (code === 400030 || /баланс/i.test(msg) || /нейросимвол/i.test(msg)) {
      msg = "На балансе Text.ru закончились нейросимволы. Пополните баланс на text.ru/account/balance или напишите в поддержку - мы поможем.";
    } else if (submitRes.status === 401 || code === 401 || /ключ|key|userkey/i.test(msg)) {
      msg = "Неверный или просроченный API-ключ Text.ru (TEXTRU_API_KEY). Проверьте ключ в настройках интеграций или обновите его через поддержку.";
    } else if (submitRes.status === 429 || code === 429) {
      msg = "Превышен лимит запросов к Text.ru. Попробуйте через минуту.";
    }
    return { ok: false, error: msg, code };
  }
  const taskId = String(submitJson.taskId);

  // Step 2: poll up to ~60s (30 * 2s)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(
      `https://api.text.ru/neurotools/api/v1/task/detector/${encodeURIComponent(taskId)}`,
      { method: "GET", headers: { "X-USERKEY": apiKey } },
    );
    const pollJson: any = await pollRes.json().catch(() => ({}));
    const status = String(pollJson?.status || "").toUpperCase();
    if (status === "ERROR" || status === "FAILED") {
      return { ok: false, error: pollJson?.message || "Text.ru вернул ошибку выполнения" };
    }
    if (status !== "READY") continue;

    const aiPercent = Math.max(0, Math.min(100, Math.round(Number(pollJson?.result?.percent) || 0)));
    const phrases = Array.isArray(pollJson?.result?.phrases)
      ? pollJson.result.phrases.slice(0, 10).map((p: any) => String(p?.phrase ?? p ?? "")).filter(Boolean)
      : [];
    return {
      ok: true,
      uniqueness: 100 - aiPercent,
      words: text.trim().split(/\s+/).filter(Boolean).length,
      raw: { taskId, ai_percent: aiPercent, neurosymbols: pollJson?.neurosymbols },
      ai_phrases: phrases,
    };
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
async function runZeroGpt(plain: string, key: string): Promise<number | null> {
  try {
    const res = await fetchWithTimeout("https://api.zerogpt.com/api/detect/detectText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "ApiKey": key },
      body: JSON.stringify({ input_text: plain.slice(0, 8000) }),
    }, 30000);
    if (!res.ok) return null;
    const data = await res.json();
    const fake = Number(data?.data?.fakePercentage ?? data?.fakePercentage);
    if (Number.isNaN(fake)) return null;
    // ai_score: human-likeness 0-100. ZeroGPT returns AI-percentage → invert.
    return Math.max(0, Math.min(100, Math.round(100 - fake)));
  } catch { return null; }
}

async function runAutoQuality(
  admin: any, articleId: string, userId: string, content: string, apiKey: string,
) {
  const plain = stripHtml(content);
  if (plain.length < 200) {
    await admin.from("articles").update({ quality_status: "fail" }).eq("id", articleId);
    return;
  }

  // Mark as checking
  await admin.from("articles").update({ quality_status: "checking" }).eq("id", articleId);

  // Fetch article + keyword (for density target)
  const { data: art } = await admin.from("articles")
    .select("keyword_id, keywords").eq("id", articleId).maybeSingle();

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

  const zeroKey = Deno.env.get("ZEROGPT_API_KEY");

  const [aiInternalRes, zeroRes] = await Promise.all([
    withTimeout(runAiScore(plain, apiKey), 30000, "ai-internal"),
    zeroKey ? withTimeout(runZeroGpt(plain, zeroKey), 30000, "zerogpt") : Promise.resolve(null),
  ]);

  const aiInternal = aiInternalRes?.score ?? null;
  const aiZero = zeroRes ?? null;
  const aiCombined = aiInternal !== null && aiZero !== null
    ? Math.round((aiInternal + aiZero) / 2)
    : (aiInternal ?? aiZero ?? null);

  const burst = computeBurstiness(plain);
  const density = primaryKeyword ? computeDensity(plain, primaryKeyword) : 0;
  const dStatus = primaryKeyword && medianDensity > 0 ? densityStatus(density, medianDensity) : "ok";

  // Compute aggregate quality_status
  // ai_score: <30 fail, 30-60 warning, >=60 ok (lower = more AI-like)
  let aiStatus: "ok" | "warning" | "fail" = "ok";
  if (aiCombined !== null) {
    if (aiCombined < 30) aiStatus = "fail";
    else if (aiCombined < 60) aiStatus = "warning";
  }
  const all = [aiStatus, burst.status, dStatus === "ok" ? "ok" : (dStatus === "underuse" ? "warning" : "fail")];
  let quality: "ok" | "warning" | "fail" = "ok";
  if (all.includes("fail")) quality = "fail";
  else if (all.includes("warning")) quality = "warning";

  // Mirror to legacy badge
  const badge = quality === "ok" ? "excellent" : (quality === "warning" ? "good" : "needs_work");

  await admin.from("articles").update({
    ai_score_internal: aiInternal,
    ai_score_zerogpt: aiZero,
    ai_score: aiCombined,
    ai_human_score: aiCombined,
    burstiness_score: burst.sigma,
    burstiness_status: burst.status,
    keyword_density: density,
    keyword_density_status: dStatus,
    quality_status: quality,
    quality_badge: badge,
    quality_checked_at: new Date().toISOString(),
  }).eq("id", articleId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    const textRuKey = Deno.env.get("TEXTRU_API_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    if (!apiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { article_id, content, checks, mode } = body as {
      article_id?: string; content?: string; checks?: string[]; mode?: string;
    };
    if (!article_id) return json({ error: "article_id required" }, 400);
    if (!content || typeof content !== "string") return json({ error: "content required" }, 400);

    // ── AUTO mode: run AI(internal+ZeroGPT) + burstiness + density in background, no credits ──
    if (mode === "auto") {
      const { data: ownCheck } = await admin.from("articles").select("user_id").eq("id", article_id).maybeSingle();
      if (!ownCheck || ownCheck.user_id !== user.id) return json({ error: "Article not found" }, 404);
      // Mark immediately so polling sees "checking"
      await admin.from("articles").update({ quality_status: "checking" }).eq("id", article_id);
      const bg = runAutoQuality(admin, article_id, user.id, content, apiKey).catch((e) => {
        console.error("[quality-check] auto bg error", e);
      });
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(bg); } catch (_) { void bg; }
      return json({ ok: true, queued: true });
    }

    const requested = new Set(Array.isArray(checks) && checks.length ? checks : ["score", "uniqueness", "ai"]);

    // Verify ownership
    const { data: art } = await admin.from("articles").select("id,user_id,quality_details").eq("id", article_id).maybeSingle();
    if (!art || art.user_id !== user.id) return json({ error: "Article not found" }, 404);

    const plain = stripHtml(content);
    if (plain.length < 200) return json({ error: "Текст слишком короткий для проверки (минимум 200 символов)" }, 400);
    if (plain.length > 50000) return json({ error: "Текст слишком длинный (максимум 50000 символов)" }, 400);

    // Charge 1 credit only if uniqueness requested
    let creditCharged = false;
    if (requested.has("uniqueness")) {
      if (!textRuKey) return json({ error: "TEXTRU_API_KEY not configured" }, 500);
      const { data: ok } = await admin.rpc("deduct_credit", { p_user_id: user.id });
      if (!ok) return json({ error: "Недостаточно кредитов для проверки уникальности" }, 402);
      creditCharged = true;
    }

    // Run fast checks (score + ai) inline. Uniqueness (text.ru, can take 60-120s) runs in background.
    const fastPromises: Promise<any>[] = [];
    const fastLabels: string[] = [];
    if (requested.has("score")) { fastPromises.push(withTimeout(runSeoModuleScore(plain, apiKey), 30000, "seo-score")); fastLabels.push("score"); }
    if (requested.has("ai")) { fastPromises.push(withTimeout(runAiScore(plain, apiKey), 30000, "ai-score")); fastLabels.push("ai"); }

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
                ai_percent: (uniqRes as any).raw?.ai_percent,
                ai_phrases: (uniqRes as any).ai_phrases,
                source: "text.ru/neuro/detector",
              } : undefined,
              uniqueness_error: !ok ? ((uniqRes as any)?.error || "Сервис Text.ru не ответил вовремя") : undefined,
            },
          };
          if (uniqVal !== null) updPatch.uniqueness_percent = uniqVal;
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

    const turg = out.score?.score ?? null;
    // Uniqueness handled in background; not part of inline response.
    const uniq: number | null = null;
    const uniqError: string | null = null;
    const ai = out.ai?.score ?? null;

    // (refund logic moved into background task above)

    const existingDetails = (art.quality_details as any) || {};
    const details = {
      ...existingDetails,
      score_details: out.score ? { stylistics: out.score.stylistics, water: out.score.water, reasons: out.score.reasons } : existingDetails.score_details,
      ai_details: out.ai ? { verdict: out.ai.verdict, reasons: out.ai.reasons } : existingDetails.ai_details,
      uniqueness_details: existingDetails.uniqueness_details,
      uniqueness_pending: uniquenessQueued ? true : existingDetails.uniqueness_pending,
    };

    const update: Record<string, any> = {
      quality_details: details,
      quality_checked_at: new Date().toISOString(),
    };
    if (turg !== null) update.turgenev_score = turg;
    if (uniq !== null) update.uniqueness_percent = uniq;
    if (ai !== null) update.ai_human_score = ai;

    // Compute badge from latest values (existing if not re-checked)
    const finalTurg = turg ?? null;
    const finalUniq = uniq ?? null;
    const finalAi = ai ?? null;
    // If only some were rechecked, fall back to existing for badge calc
    const { data: existing } = await admin.from("articles").select("turgenev_score,uniqueness_percent,ai_human_score").eq("id", article_id).maybeSingle();
    const badge = computeBadge(
      finalTurg ?? existing?.turgenev_score ?? null,
      finalUniq ?? existing?.uniqueness_percent ?? null,
      finalAi ?? existing?.ai_human_score ?? null,
    );
    if (badge) update.quality_badge = badge;

    await admin.from("articles").update(update).eq("id", article_id);

    // Cost logging
    const totalIn = (out.score?.tokens_in || 0) + (out.ai?.tokens_in || 0);
    const totalOut = (out.score?.tokens_out || 0) + (out.ai?.tokens_out || 0);
    void logCost(admin, {
      user_id: user.id,
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
      ai_human_score: finalAi ?? existing?.ai_human_score ?? null,
      quality_badge: badge,
      details,
      checked_at: update.quality_checked_at,
      uniqueness_error: uniqError,
      uniqueness_pending: uniquenessQueued,
      credit_refunded: false,
    });
  } catch (e: any) {
    console.error("[quality-check] fatal", e);
    return json({ error: e?.message || "Unknown error" }, 500);
  }
});