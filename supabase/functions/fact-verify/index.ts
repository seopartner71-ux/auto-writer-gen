// Deep Fact Check — Функция 2: онлайн-верификация утверждений (Tavily + OpenRouter).
// Работает с fact_checks.status = 'awaiting_verification'.
// Батчит по 5 findings из critic_findings у которых есть search_query.
// Пишет результат в factcheck_findings и пересчитывает fact_score.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { logLLM } from "../_shared/costLogger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY") || "";
const FACT_CRITIC_MODEL = Deno.env.get("FACT_CRITIC_MODEL") || "anthropic/claude-sonnet-4-6";

const BATCH_SIZE = 5;

type Verdict = "CONFIRMED" | "OUTDATED" | "UNVERIFIABLE";

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

interface FactCheckFinding extends CriticFinding {
  verification: Verdict;
  verification_summary: string;
  verification_sources: Array<{ title: string; url: string }>;
}

function scoreFromFindings(findings: Array<{ severity: string; verification?: Verdict }>): number {
  let penalty = 0;
  for (const f of findings) {
    // подтверждённые факты не штрафуют
    if (f.verification === "CONFIRMED") continue;
    if (f.severity === "critical") penalty += 15;
    else if (f.severity === "major") penalty += 7;
    else penalty += 2;
  }
  return Math.max(0, 100 - penalty);
}

async function tavilySearch(query: string): Promise<Array<{ title: string; url: string; content: string }>> {
  try {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
      }),
    });
    if (!resp.ok) return [];
    const j = await resp.json();
    const results = Array.isArray(j?.results) ? j.results : [];
    return results.map((r: any) => ({
      title: String(r?.title || ""),
      url: String(r?.url || ""),
      content: String(r?.content || "").slice(0, 800),
    }));
  } catch {
    return [];
  }
}

async function judgeVerdict(
  finding: CriticFinding,
  sources: Array<{ title: string; url: string; content: string }>,
): Promise<{ verdict: Verdict; summary: string; tokensIn: number; tokensOut: number }> {
  if (sources.length === 0) {
    return { verdict: "UNVERIFIABLE", summary: "Не найдено релевантных источников.", tokensIn: 0, tokensOut: 0 };
  }

  const srcBlock = sources
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${s.content}`)
    .join("\n\n");

  const system = `Ты — фактчекер. Оцени утверждение из статьи по свежим источникам из веба.
Верни строго JSON: {"verdict":"CONFIRMED|OUTDATED|UNVERIFIABLE","summary":"1-2 предложения — что говорят источники"}.
CONFIRMED — источники подтверждают утверждение.
OUTDATED — источники прямо противоречат (число/дата/статус устарели).
UNVERIFIABLE — источники не касаются темы или противоречат друг другу.
Никакого markdown, только JSON.`;

  const user = `УТВЕРЖДЕНИЕ: ${finding.quote}\nКРАТКИЙ ВЕРДИКТ КРИТИКА: ${finding.verdict}\n\nИСТОЧНИКИ:\n${srcBlock}`;

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://seo-modul.pro",
      "X-Title": "SEO-Modul fact-verify",
    },
    body: JSON.stringify({
      model: FACT_CRITIC_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      max_tokens: 400,
    }),
  });

  if (!resp.ok) {
    return { verdict: "UNVERIFIABLE", summary: `LLM ошибка ${resp.status}`, tokensIn: 0, tokensOut: 0 };
  }
  const j = await resp.json();
  const raw = String(j?.choices?.[0]?.message?.content || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const tokensIn = Number(j?.usage?.prompt_tokens || 0);
  const tokensOut = Number(j?.usage?.completion_tokens || 0);

  try {
    const parsed = JSON.parse(raw);
    const v = String(parsed?.verdict || "").toUpperCase();
    const verdict: Verdict = v === "CONFIRMED" || v === "OUTDATED" ? v : "UNVERIFIABLE";
    return {
      verdict,
      summary: String(parsed?.summary || "").slice(0, 500),
      tokensIn,
      tokensOut,
    };
  } catch {
    return { verdict: "UNVERIFIABLE", summary: "Не удалось разобрать ответ LLM.", tokensIn, tokensOut };
  }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const auth = await verifyAuth(req);
  if (auth instanceof Response) return auth;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    const { fact_check_id } = await req.json();
    if (!fact_check_id) return errorResponse("fact_check_id required", 400);
    if (!TAVILY_API_KEY) return errorResponse("TAVILY_API_KEY not set", 500);
    if (!OPENROUTER_API_KEY) return errorResponse("OPENROUTER_API_KEY not set", 500);

    const { data: fc, error: fcErr } = await admin
      .from("fact_checks")
      .select("id, article_id, status, layer1_findings, critic_findings, factcheck_findings, articles!inner(user_id)")
      .eq("id", fact_check_id)
      .maybeSingle();
    if (fcErr || !fc) return errorResponse("fact_check_not_found", 404);
    const ownerId = (fc as any).articles?.user_id;
    if (ownerId !== auth.userId) return errorResponse("forbidden", 403);
    if (fc.status !== "awaiting_verification") {
      return jsonResponse({ error: "wrong_status", status: fc.status }, 409);
    }

    const critic: CriticFinding[] = Array.isArray(fc.critic_findings) ? (fc.critic_findings as CriticFinding[]) : [];
    const toVerify = critic.filter((f) => f.search_query && String(f.search_query).trim().length > 0);
    const passthrough = critic.filter((f) => !f.search_query || String(f.search_query).trim().length === 0);

    const verified: FactCheckFinding[] = [];
    let totalIn = 0;
    let totalOut = 0;

    for (let i = 0; i < toVerify.length; i += BATCH_SIZE) {
      const batch = toVerify.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (f) => {
          const sources = await tavilySearch(String(f.search_query));
          const j = await judgeVerdict(f, sources);
          totalIn += j.tokensIn;
          totalOut += j.tokensOut;
          return {
            ...f,
            verification: j.verdict,
            verification_summary: j.summary,
            verification_sources: sources.slice(0, 3).map((s) => ({ title: s.title, url: s.url })),
          } as FactCheckFinding;
        }),
      );
      verified.push(...results);
    }

    logLLM({
      functionName: "fact-verify/judge",
      model: FACT_CRITIC_MODEL,
      tokensIn: totalIn,
      tokensOut: totalOut,
      userId: auth.userId,
      articleId: fc.article_id,
      extraMeta: { fact_check_id, batches: Math.ceil(toVerify.length / BATCH_SIZE), items: toVerify.length },
    });

    const factcheckFindings = [...verified, ...passthrough.map((f) => ({
      ...f,
      verification: "UNVERIFIABLE" as Verdict,
      verification_summary: "Не требует онлайн-проверки.",
      verification_sources: [],
    }))];

    const layer1 = Array.isArray(fc.layer1_findings) ? (fc.layer1_findings as any[]) : [];
    const score = scoreFromFindings([...layer1, ...factcheckFindings]);

    await admin
      .from("fact_checks")
      .update({
        factcheck_findings: factcheckFindings,
        fact_score: score,
        status: "done",
        finished_at: new Date().toISOString(),
      })
      .eq("id", fact_check_id);

    return jsonResponse({
      fact_check_id,
      status: "done",
      fact_score: score,
      factcheck_findings: factcheckFindings,
      verified_count: verified.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorResponse(msg, 500);
  }
});