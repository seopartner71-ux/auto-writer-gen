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

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
  });
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

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
  });
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
// Two-step: POST /post -> uid; then poll POST /post (with uid) until result ready.
async function runTextRuUniqueness(plain: string, apiKey: string): Promise<{
  uniqueness: number; words: number; raw: any;
} | null> {
  // Step 1: submit
  const fd1 = new FormData();
  fd1.append("text", plain);
  fd1.append("userkey", apiKey);
  fd1.append("visible", "vis_off");
  const submitRes = await fetch("https://api.text.ru/post", { method: "POST", body: fd1 });
  const submitJson: any = await submitRes.json().catch(() => ({}));
  if (!submitJson?.text_uid) {
    console.error("[quality-check] text.ru submit failed", submitJson);
    return null;
  }
  const uid = submitJson.text_uid;

  // Step 2: poll up to ~60s
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const fd2 = new FormData();
    fd2.append("uid", uid);
    fd2.append("userkey", apiKey);
    fd2.append("jsonvisible", "detail");
    const pollRes = await fetch("https://api.text.ru/post", { method: "POST", body: fd2 });
    const pollJson: any = await pollRes.json().catch(() => ({}));
    if (pollJson?.error_code === 181 || pollJson?.text_unique === undefined) {
      // not ready yet
      continue;
    }
    if (pollJson?.text_unique !== undefined) {
      const unique = Math.round(Number(pollJson.text_unique) || 0);
      let parsedRes: any = {};
      try { parsedRes = typeof pollJson.result_json === "string" ? JSON.parse(pollJson.result_json) : (pollJson.result_json || {}); } catch {}
      return {
        uniqueness: unique,
        words: Number(parsedRes?.unique_check_resultat?.count_words) || plain.split(/\s+/).length,
        raw: { uid, spam: parsedRes?.spam_check_resultat, water: parsedRes?.water_check_resultat },
      };
    }
  }
  return null;
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
    const { article_id, content, checks } = body as {
      article_id?: string; content?: string; checks?: string[];
    };
    if (!article_id) return json({ error: "article_id required" }, 400);
    if (!content || typeof content !== "string") return json({ error: "content required" }, 400);

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

    // Run checks in parallel where possible
    const promises: Promise<any>[] = [];
    const labels: string[] = [];
    if (requested.has("score")) { promises.push(runSeoModuleScore(plain, apiKey)); labels.push("score"); }
    if (requested.has("ai")) { promises.push(runAiScore(plain, apiKey)); labels.push("ai"); }
    if (requested.has("uniqueness")) { promises.push(runTextRuUniqueness(plain, textRuKey!)); labels.push("uniqueness"); }

    const results = await Promise.all(promises);
    const out: Record<string, any> = {};
    results.forEach((r, i) => { out[labels[i]] = r; });

    const turg = out.score?.score ?? null;
    const uniq = out.uniqueness?.uniqueness ?? null;
    const ai = out.ai?.score ?? null;

    // If uniqueness was charged but failed - refund
    if (requested.has("uniqueness") && uniq === null && creditCharged) {
      await admin.from("profiles").update({ credits_amount: undefined }).eq("id", user.id); // placeholder
      // Use admin RPC equivalent: refund by direct update
      await admin.rpc("admin_add_credits", { p_user_id: user.id, p_amount: 1, p_notify: false, p_comment: "Возврат за упавшую проверку Text.ru" }).catch(() => null);
    }

    const existingDetails = (art.quality_details as any) || {};
    const details = {
      ...existingDetails,
      score_details: out.score ? { stylistics: out.score.stylistics, water: out.score.water, reasons: out.score.reasons } : existingDetails.score_details,
      ai_details: out.ai ? { verdict: out.ai.verdict, reasons: out.ai.reasons } : existingDetails.ai_details,
      uniqueness_details: out.uniqueness ? { words: out.uniqueness.words } : existingDetails.uniqueness_details,
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
    });
  } catch (e: any) {
    console.error("[quality-check] fatal", e);
    return json({ error: e?.message || "Unknown error" }, 500);
  }
});