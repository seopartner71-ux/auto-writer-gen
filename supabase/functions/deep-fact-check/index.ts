// Deep Fact Check — Функция 1: Layer 1 (правила) + критик.
// Только новые файлы. Пишем в fact_checks: layer1_findings, critic_findings,
// factcheck_findings (пусто на этом шаге), status.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { runLayer1Rules, type Finding } from "../_shared/factRulesL1.ts";
import { logLLM } from "../_shared/costLogger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const FACT_CRITIC_MODEL = Deno.env.get("FACT_CRITIC_MODEL") || "anthropic/claude-sonnet-4-6";

const PRO_PLANS = new Set(["pro", "factory"]);
const MONTHLY_QUOTA: Record<string, number> = { pro: 20, factory: 100 };

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
  error?: string;
}> {
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: promptTemplate },
    { role: "user", content: `ТЕКСТ СТАТЬИ:\n\n${articleText}` },
  ];
  if (retryHint) {
    messages.push({
      role: "user",
      content: `Твой предыдущий ответ не удалось распарсить как JSON: ${retryHint}. Верни СТРОГО JSON-массив, без markdown-обёртки, без пояснений.`,
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
      max_tokens: 4000,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { findings: [], raw: "", tokensIn: 0, tokensOut: 0, error: `http_${resp.status}: ${t.slice(0, 200)}` };
  }
  const j = await resp.json();
  const raw = String(j?.choices?.[0]?.message?.content || "").trim();
  const tokensIn = Number(j?.usage?.prompt_tokens || 0);
  const tokensOut = Number(j?.usage?.completion_tokens || 0);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      return { findings: [], raw, tokensIn, tokensOut, error: "not_an_array" };
    }
    return { findings: parsed as CriticFinding[], raw, tokensIn, tokensOut };
  } catch (e) {
    return { findings: [], raw, tokensIn, tokensOut, error: (e as Error).message };
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
      .select("id, user_id, title, content")
      .eq("id", article_id)
      .maybeSingle();
    if (aErr || !article) return errorResponse("article_not_found", 404);
    if (article.user_id !== auth.userId) return errorResponse("forbidden", 403);

    const text = htmlToText(String(article.content || ""));
    if (text.length < 100) return errorResponse("article_too_short", 400);

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
    const layer1: Finding[] = runLayer1Rules(String(article.content || ""));
    await admin
      .from("fact_checks")
      .update({ layer1_findings: layer1 })
      .eq("id", factCheckId);

    // Шаг B — критик
    const { data: promptRow } = await admin
      .from("app_prompts")
      .select("content")
      .eq("key", "fact_critic")
      .maybeSingle();
    const promptTpl = String(promptRow?.content || "").trim();
    if (!promptTpl) throw new Error("fact_critic prompt missing in app_prompts");
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");

    let critic = await callCritic(text, promptTpl);
    if (critic.error && critic.findings.length === 0) {
      critic = await callCritic(text, promptTpl, critic.error);
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