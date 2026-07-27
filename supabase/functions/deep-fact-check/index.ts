// Deep Fact Check — Функция 1: Layer 1 (правила) + критик.
// Только новые файлы. Пишем в fact_checks: layer1_findings, critic_findings,
// factcheck_findings (пусто на этом шаге), status.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { runLayer1Rules, type Finding } from "../_shared/factRulesL1.ts";
import { logLLM, tokensToUsd } from "../_shared/costLogger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const FACT_CRITIC_MODEL = Deno.env.get("FACT_CRITIC_MODEL") || "anthropic/claude-sonnet-4-6";

// "basic" is the DB id of the PRO tier, "pro" is the DB id of the FACTORY tier.
const PRO_PLANS = new Set(["basic", "pro", "factory", "business", "advanced"]);
const MONTHLY_QUOTA: Record<string, number> = { basic: 20, pro: 100, factory: 100 };

interface CriticFinding {
  type: string;
  severity: "critical" | "major" | "minor";
  quote: string;
  verdict: string;
  suggested_fix: string | null;
  source_url: string | null;
  search_query?: string | null;
  needs_manual_review?: boolean;
}

function htmlToText(html: string): string {
  return String(html || "")
    .replace(/<\/(p|div|h[1-6]|li|tr|td|th|table|section|article|header|footer|blockquote)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Rough language detector: if Cyrillic letters make up <5% of the alphabetic
// characters, treat the article as English. The RU critic prompt and RU-only
// Layer 1 rules (anon-expert phrases in Russian, cyrillic word-boundary regexes)
// produce zero findings on EN text, which surfaces to the user as "не работает".
function detectLang(text: string): "ru" | "en" {
  const cyr = (text.match(/[а-яё]/gi) || []).length;
  const lat = (text.match(/[a-z]/gi) || []).length;
  if (cyr + lat < 50) return "ru";
  return cyr / (cyr + lat) < 0.05 ? "en" : "ru";
}

const EN_CRITIC_PROMPT = `You are an editor-factchecker for AI-generated SEO articles. Your job is to FIND problems, NOT to rewrite the text. Return ONLY a JSON array of findings.

Check the article against five patterns:

1. FACTS AT RISK. Find every verifiable factual claim (numbers, thresholds, rates, laws, brand/model properties, dates). Classify as STABLE (physics, definitions, durable facts) or DATED (laws, taxes, prices, program thresholds, versions, rates — anything that could have changed). For DATED items, formulate a search query to verify the current value. Claims about specific brands/models ("X has feature Y", "brand Z is reliable") that cannot be derived from general knowledge → type=invented_fact, severity=major.

2. LOGICAL CONSISTENCY. Extract all numbers with units. Flag: (a) the same quantity with different values in different places; (b) matching numbers used for DIFFERENT quantities next to each other (reader confusion risk); (c) recommendations where two parameters must agree but don't.

3. ANONYMOUS SOURCES. Quotes or claims attributed to "experts say", "practice shows", "industry data", "professionals agree" without a concrete name or link. Suggest attributing to the article's persona or removing the personification.

4. SELF-REPETITION. The same thesis or striking phrase repeated across sections almost verbatim or paraphrased. List every occurrence, suggest keeping the strongest one.

5. CLIENT-DATA SLOTS. Places where the text would be significantly stronger with the site owner's real data: prices, case studies, deal stats, photos. Return type=client_slot with a precise ask.

Rules:
- Quote an EXACT fragment of the article in \`quote\` — it will be used for find-and-replace, so it must appear exactly once (if not, expand with context until unique).
- Do NOT invent replacement facts. If unsure of the correct value, suggested_fix = null.
- Do NOT propose stylistic edits. Style, tone and structure are out of scope.
- Do NOT flag quotes that the article uses AS examples of errors (markers: "Before:", "in the original", quoted text followed by analysis).
- Finding shape: {"type": "outdated_fact|invented_fact|logic_break|anon_expert|self_repeat|seam|keyword_stuffing|cross_article_conflict|client_slot", "severity": "critical|major|minor", "quote": "...", "verdict": "...", "suggested_fix": "... or null", "source_url": null, "confidence": 0.0-1.0, "search_query": "only for DATED, else null"}
- Response = valid JSON array only, no prose, no markdown fences.
- All verdict/suggested_fix text MUST be written in English.`;

function countOccurrences(hay: string, needle: string): number {
  if (!needle || needle.length < 3) return 0;
  let i = 0, count = 0;
  while (true) {
    const p = hay.indexOf(needle, i);
    if (p === -1) break;
    count++;
    i = p + needle.length;
  }
  return count;
}

function scoreFromFindings(findings: Array<{ severity: string }>): number {
  let penalty = 0;
  for (const f of findings) {
    if (f.severity === "critical") penalty += 15;
    else if (f.severity === "major") penalty += 7;
    else penalty += 2;
  }
  return Math.max(0, 100 - penalty);
}

async function callCritic(articleText: string, promptTemplate: string, retryHint?: string): Promise<{
  findings: CriticFinding[];
  raw: string;
  tokensIn: number;
  tokensOut: number;
  finishReason: string;
  error?: string;
}> {
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: promptTemplate },
    { role: "user", content: `ТЕКСТ СТАТЬИ:\n\n${articleText}` },
  ];
  if (retryHint) {
    messages.push({
      role: "user",
      content: `Твой предыдущий ответ не удалось разобрать (${retryHint}). Верни ТОЛЬКО валидный JSON-массив findings, без markdown-обёртки и пояснений. Поля verdict и любые текстовые пояснения внутри объектов сокращай до 1-2 предложений, чтобы ответ гарантированно уложился в лимит.`,
    });
  }

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://seo-modul.pro",
      "X-Title": "SEO-Modul deep-fact-check critic",
    },
    body: JSON.stringify({
      model: FACT_CRITIC_MODEL,
      messages,
      temperature: 0.1,
      max_tokens: 16000,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { findings: [], raw: "", tokensIn: 0, tokensOut: 0, finishReason: "", error: `http_${resp.status}: ${t.slice(0, 200)}` };
  }
  const j = await resp.json();
  const raw = String(j?.choices?.[0]?.message?.content || "").trim();
  const finishReason = String(j?.choices?.[0]?.finish_reason || "");
  const tokensIn = Number(j?.usage?.prompt_tokens || 0);
  const tokensOut = Number(j?.usage?.completion_tokens || 0);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      return { findings: [], raw, tokensIn, tokensOut, finishReason, error: "not_an_array" };
    }
    return { findings: parsed as CriticFinding[], raw, tokensIn, tokensOut, finishReason };
  } catch (e) {
    return { findings: [], raw, tokensIn, tokensOut, finishReason, error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const auth = await verifyAuth(req);
  if (auth instanceof Response) return auth;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  let factCheckId: string | null = null;

  try {
    const { article_id } = await req.json();
    if (!article_id) return errorResponse("article_id required", 400);

    // 1) Тариф + квота
    const { data: profile } = await admin
      .from("profiles")
      .select("plan")
      .eq("id", auth.userId)
      .maybeSingle();

    const plan = String(profile?.plan || "").toLowerCase();
    if (!PRO_PLANS.has(plan)) {
      return jsonResponse({ error: "plan_required", required_plan: "pro" }, 403);
    }

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { count: userUsed } = await admin
      .from("fact_checks")
      .select("id, articles!inner(user_id)", { count: "exact", head: true })
      .eq("articles.user_id", auth.userId)
      .gte("created_at", monthStart.toISOString());
    const quota = MONTHLY_QUOTA[plan] ?? 20;
    if ((userUsed ?? 0) >= quota) {
      return jsonResponse({ error: "quota_exceeded", quota, used: userUsed }, 429);
    }

    // 2) Статья (read-only, только своя)
    const { data: article, error: aErr } = await admin
      .from("articles")
      .select("id, user_id, title, content, narration_person")
      .eq("id", article_id)
      .maybeSingle();
    if (aErr || !article) return errorResponse("article_not_found", 404);
    if (article.user_id !== auth.userId) return errorResponse("forbidden", 403);

    const text = htmlToText(String(article.content || ""));
    if (text.length < 100) return errorResponse("article_too_short", 400);
    const lang = detectLang(text);

    // 3) fact_checks: running
    const { data: fc, error: fcErr } = await admin
      .from("fact_checks")
      .insert({
        article_id,
        status: "running",
        layer1_findings: [],
        critic_findings: [],
        factcheck_findings: [],
      })
      .select("id")
      .single();
    if (fcErr || !fc) throw new Error(`fact_checks insert failed: ${fcErr?.message}`);
    factCheckId = fc.id as string;

    // Шаг A — Layer 1
    // Layer 1 rules are Russian-only (cyrillic word boundaries + RU phrase lists).
    // On EN articles they produce noise/zero results — skip them.
    const layer1: Finding[] = lang === "ru" ? runLayer1Rules(String(article.content || "")) : [];
    await admin
      .from("fact_checks")
      .update({ layer1_findings: layer1 })
      .eq("id", factCheckId);

    // Шаг B — критик
    let promptTpl: string;
    if (lang === "en") {
      promptTpl = EN_CRITIC_PROMPT;
      if ((article as any).narration_person === "my") {
        promptTpl += `\nThe article speaks from a company voice (we) — phrase every suggested_fix in first-person plural (in our team's experience, we recommend).`;
      }
    } else {
      const { data: promptRow } = await admin
        .from("app_prompts")
        .select("content")
        .eq("key", "fact_critic")
        .maybeSingle();
      promptTpl = String(promptRow?.content || "").trim();
      if (!promptTpl) throw new Error("fact_critic prompt missing in app_prompts");
      if ((article as any).narration_person === "my") {
        promptTpl += `\nТекст ведётся от лица компании (мы) - все suggested_fix формулируй от первого лица множественного числа (по опыту нашей команды, мы рекомендуем).`;
      }
    }
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");

    let critic = await callCritic(text, promptTpl, undefined, lang);
    // Один ретрай, если JSON не распарсился ИЛИ ответ обрезан по длине.
    const needsRetry =
      (critic.error && critic.findings.length === 0) ||
      critic.finishReason === "length";
    if (needsRetry) {
      const hint = critic.finishReason === "length"
        ? `ответ обрезан по лимиту токенов (finish_reason=length)`
        : String(critic.error || "parse_error");
      const retry = await callCritic(text, promptTpl, hint, lang);
      // Берём ретрай, если он реально что-то распарсил, иначе оставляем первый ответ.
      if (retry.findings.length > 0 || !critic.error) {
        critic = {
          ...retry,
          tokensIn: critic.tokensIn + retry.tokensIn,
          tokensOut: critic.tokensOut + retry.tokensOut,
        };
      } else {
        critic = { ...critic, tokensIn: critic.tokensIn + retry.tokensIn, tokensOut: critic.tokensOut + retry.tokensOut };
      }
    }

    logLLM({
      functionName: "deep-fact-check/critic",
      model: FACT_CRITIC_MODEL,
      tokensIn: critic.tokensIn,
      tokensOut: critic.tokensOut,
      userId: auth.userId,
      articleId: article_id,
      extraMeta: { fact_check_id: factCheckId },
    });
    const criticCostUsd = tokensToUsd(FACT_CRITIC_MODEL, critic.tokensIn, critic.tokensOut);

    // 4) needs_manual_review для quote с неоднозначным вхождением
    const criticFindings: CriticFinding[] = (critic.findings || []).map((f) => {
      const q = String(f?.quote || "").trim();
      const occ = countOccurrences(text, q);
      return {
        ...f,
        quote: q,
        needs_manual_review: occ !== 1,
      };
    });

    const hasDated = criticFindings.some((f) => f.search_query && String(f.search_query).trim().length > 0);

    let update: Record<string, unknown> = {
      critic_findings: criticFindings,
      cost_usd: Number(criticCostUsd.toFixed(6)),
    };

    if (hasDated) {
      update.status = "awaiting_verification";
    } else {
      const allFindings = [...layer1, ...criticFindings];
      update.fact_score = scoreFromFindings(allFindings);
      update.status = "done";
      update.finished_at = new Date().toISOString();
    }

    await admin.from("fact_checks").update(update).eq("id", factCheckId);

    return jsonResponse({
      fact_check_id: factCheckId,
      status: update.status,
      layer1_findings: layer1,
      critic_findings: criticFindings,
      fact_score: update.fact_score ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (factCheckId) {
      await admin
        .from("fact_checks")
        .update({ status: "failed", finished_at: new Date().toISOString() })
        .eq("id", factCheckId);
    }
    return errorResponse(msg, 500);
  }
});