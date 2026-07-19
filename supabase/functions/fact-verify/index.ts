// Deep Fact Check — Функция 2: онлайн-верификация утверждений (Tavily + OpenRouter).
// Работает с fact_checks.status = 'awaiting_verification'.
// Батчит по 5 findings из critic_findings у которых есть search_query.
// Пишет результат в factcheck_findings и пересчитывает fact_score.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { logLLM, tokensToUsd } from "../_shared/costLogger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY") || "";
const FACT_CRITIC_MODEL = Deno.env.get("FACT_CRITIC_MODEL") || "anthropic/claude-sonnet-4-6";

const BATCH_SIZE = 5;
const TAVILY_COST_PER_SEARCH = 0.008;

// Инструкционные глаголы — если модель вернула "Удалить", "Переформулировать" и т.п.
// вместо готовой замены, отбрасываем и оставляем finding как информационный.
const INSTRUCTION_VERBS = new Set([
  "удалить", "удали", "убрать", "убери",
  "переформулировать", "переформулируй",
  "атрибутировать", "атрибутируй",
  "заменить", "замени", "оставить", "оставь",
  "уточнить", "уточни", "запросить", "запроси",
  "добавить", "добавь", "сократить", "сократи",
]);

function isInstructionFix(fix: string | null | undefined): boolean {
  if (!fix) return false;
  const first = String(fix)
    .trim()
    .replace(/^[«"'`(\[\-–—•*\s]+/u, "")
    .toLowerCase()
    .split(/[\s,.:;!?]/)[0];
  if (!first) return false;
  return INSTRUCTION_VERBS.has(first);
}

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

  const callOnce = async (extraHint?: string) => {
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
    if (extraHint) {
      messages.push({
        role: "user",
        content: `Твой предыдущий ответ не удалось разобрать (${extraHint}). Верни ТОЛЬКО валидный JSON {"verdict":...,"summary":...}, поле summary сократи до 1-2 коротких предложений.`,
      });
    }
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
        messages,
        temperature: 0.1,
        max_tokens: 16000,
      }),
    });
    if (!resp.ok) {
      return { ok: false as const, status: resp.status, tokensIn: 0, tokensOut: 0, finishReason: "", raw: "" };
    }
    const j = await resp.json();
    const raw = String(j?.choices?.[0]?.message?.content || "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const finishReason = String(j?.choices?.[0]?.finish_reason || "");
    const tokensIn = Number(j?.usage?.prompt_tokens || 0);
    const tokensOut = Number(j?.usage?.completion_tokens || 0);
    return { ok: true as const, status: 200, tokensIn, tokensOut, finishReason, raw };
  };

  const parseResult = (raw: string): { verdict: Verdict; summary: string } | null => {
    try {
      const parsed = JSON.parse(raw);
      const v = String(parsed?.verdict || "").toUpperCase();
      const verdict: Verdict = v === "CONFIRMED" || v === "OUTDATED" ? v : "UNVERIFIABLE";
      return { verdict, summary: String(parsed?.summary || "").slice(0, 500) };
    } catch {
      return null;
    }
  };

  const first = await callOnce();
  if (!first.ok) {
    return { verdict: "UNVERIFIABLE", summary: `LLM ошибка ${first.status}`, tokensIn: 0, tokensOut: 0 };
  }
  let tokensIn = first.tokensIn;
  let tokensOut = first.tokensOut;
  const parsed1 = parseResult(first.raw);
  if (parsed1 && first.finishReason !== "length") {
    return { ...parsed1, tokensIn, tokensOut };
  }
  // Ретрай: либо parse failed, либо ответ обрезан по длине
  const hint = first.finishReason === "length"
    ? "ответ обрезан по лимиту токенов (finish_reason=length)"
    : "невалидный JSON";
  const second = await callOnce(hint);
  tokensIn += second.tokensIn;
  tokensOut += second.tokensOut;
  if (second.ok) {
    const parsed2 = parseResult(second.raw);
    if (parsed2) return { ...parsed2, tokensIn, tokensOut };
  }
  if (parsed1) return { ...parsed1, tokensIn, tokensOut };
  return { verdict: "UNVERIFIABLE", summary: "Не удалось разобрать ответ LLM.", tokensIn, tokensOut };
}

/**
 * Для OUTDATED-находки просим модель написать готовую замену фрагмента
 * на основе verification_summary. Возвращаем null, если модель ответила NULL,
 * если ответ инструкционный, или произошла ошибка.
 */
async function generateReplacement(
  finding: CriticFinding,
  summary: string,
): Promise<{ text: string | null; tokensIn: number; tokensOut: number }> {
  const system = `Ты — редактор. Дан фрагмент статьи и результат его проверки внешними источниками.
Твоя задача: написать ТОЛЬКО исправленный фрагмент на замену, тем же стилем и длиной, без пояснений, без кавычек-обёрток, без префиксов вроде "Исправлено:".
Не используй инструкционные глаголы ("Удалить", "Переформулировать" и т.п.) — верни готовый текст замены.
Если для точной замены не хватает данных в проверке, или источники неоднозначны — ответь строго словом NULL и ничем больше.`;

  const user = `ФРАГМЕНТ: ${finding.quote}\n\nПРОВЕРКА ИСТОЧНИКАМИ: ${summary}`;

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Modul fact-verify/replacement",
      },
      body: JSON.stringify({
        model: FACT_CRITIC_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
        max_tokens: 16000,
      }),
    });
    if (!resp.ok) return { text: null, tokensIn: 0, tokensOut: 0 };
    const j = await resp.json();
    const tokensIn = Number(j?.usage?.prompt_tokens || 0);
    const tokensOut = Number(j?.usage?.completion_tokens || 0);
    const raw = String(j?.choices?.[0]?.message?.content || "").trim();
    if (!raw) return { text: null, tokensIn, tokensOut };
    if (/^null\.?$/i.test(raw)) return { text: null, tokensIn, tokensOut };
    const cleaned = raw.replace(/^["'«»`]+|["'«»`]+$/g, "").trim();
    if (!cleaned || /^null\.?$/i.test(cleaned)) return { text: null, tokensIn, tokensOut };
    if (isInstructionFix(cleaned)) return { text: null, tokensIn, tokensOut };
    return { text: cleaned, tokensIn, tokensOut };
  } catch {
    return { text: null, tokensIn: 0, tokensOut: 0 };
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
      .select("id, article_id, status, layer1_findings, critic_findings, factcheck_findings, cost_usd, articles!inner(user_id)")
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
    let fixIn = 0;
    let fixOut = 0;
    let fixesGenerated = 0;

    for (let i = 0; i < toVerify.length; i += BATCH_SIZE) {
      const batch = toVerify.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (f) => {
          const sources = await tavilySearch(String(f.search_query));
          const j = await judgeVerdict(f, sources);
          totalIn += j.tokensIn;
          totalOut += j.tokensOut;
          const out: FactCheckFinding = {
            ...f,
            verification: j.verdict,
            verification_summary: j.summary,
            verification_sources: sources.slice(0, 3).map((s) => ({ title: s.title, url: s.url })),
          };

          // Автогенерация замены только для OUTDATED и только если у нас
          // непустой summary и как минимум 2 источника (пересечение мнений).
          // UNVERIFIABLE и CONFIRMED пропускаем.
          if (
            j.verdict === "OUTDATED" &&
            typeof j.summary === "string" &&
            j.summary.trim().length >= 20 &&
            sources.length >= 2
          ) {
            const rep = await generateReplacement(f, j.summary);
            fixIn += rep.tokensIn;
            fixOut += rep.tokensOut;
            if (rep.text) {
              out.suggested_fix = rep.text;
              fixesGenerated++;
            }
          }
          return out;
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

    if (fixIn > 0 || fixOut > 0) {
      logLLM({
        functionName: "fact-verify/replacement",
        model: FACT_CRITIC_MODEL,
        tokensIn: fixIn,
        tokensOut: fixOut,
        userId: auth.userId,
        articleId: fc.article_id,
        extraMeta: { fact_check_id, fixes_generated: fixesGenerated },
      });
    }

    const factcheckFindings = [...verified, ...passthrough.map((f) => ({
      ...f,
      verification: "UNVERIFIABLE" as Verdict,
      verification_summary: "Не требует онлайн-проверки.",
      verification_sources: [],
    }))];

    const layer1 = Array.isArray(fc.layer1_findings) ? (fc.layer1_findings as any[]) : [];
    const score = scoreFromFindings([...layer1, ...factcheckFindings]);

    const llmCost = tokensToUsd(FACT_CRITIC_MODEL, totalIn, totalOut);
    const fixCost = tokensToUsd(FACT_CRITIC_MODEL, fixIn, fixOut);
    const tavilyCost = toVerify.length * TAVILY_COST_PER_SEARCH;
    const priorCost = Number((fc as any)?.cost_usd || 0);
    const totalCost = Number((priorCost + llmCost + fixCost + tavilyCost).toFixed(6));

    await admin
      .from("fact_checks")
      .update({
        factcheck_findings: factcheckFindings,
        fact_score: score,
        cost_usd: totalCost,
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
      fixes_generated: fixesGenerated,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorResponse(msg, 500);
  }
});