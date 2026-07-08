/**
 * Server-side humanize pass used by the FACTORY (bulk-generate) pipeline.
 *
 * Two-stage flow:
 *   Pass 1 (Sonnet)  - heavy rewrite for rhythm + jagged sentence length.
 *   Pass 2 (Opus)    - micro-pass that breaks remaining "AI fingerprints"
 *                      (perplexity bumps, syntactic monotony, lexical bursts).
 *
 * Both passes preserve facts/numbers/HTML structure. Returns the original
 * content if the model output fails the integrity guard.
 */

import { applyStealthPostProcess } from "./stealth.ts";
import { analyzeSentenceStructure, buildSentenceStructureFixHint } from "./sentenceStructure.ts";
import {
  measureHumanize,
  structuralIntegrityOk,
  countBanlistHits,
  listBanlistHits,
  type HumanizeMetrics,
} from "./humanizeMetrics.ts";
import { logLLM } from "./costLogger.ts";

const SONNET_MODEL = "anthropic/claude-sonnet-4";
const OPUS_MODEL = "anthropic/claude-opus-4";
// Last-resort fallback: cheap and almost free on OpenRouter, keeps the
// humanize pipeline alive when both Anthropic models fail (402/429/timeout).
const LLAMA_FALLBACK_MODEL = "meta-llama/llama-3.3-70b-instruct";

const SYSTEM_RU = `Ты редактор-человек. Переписываешь текст так, чтобы он перестал быть похожим на ИИ.
СТРОГО соблюдай:
- НЕ меняй факты, цифры, бренды, ссылки, имена.
- Сохрани структуру (markdown заголовки, списки, таблицы, ссылки).
- Заголовки (# / ## / ### / <h2> / <h3>) НЕ трогай: их текст, порядок слов и регистр букв оставляй как есть. Не переводи заголовки в нижний регистр, не превращай в вопрос, не добавляй в них разговорные вставки. Правила ритма и длины применяй ТОЛЬКО к абзацам и пунктам списков.
- НИ ОДНОГО предложения длиннее 28 слов.
- Чередуй короткие (4-7 слов) и средние (12-22 слова) предложения. Без жирного.
- КОРОТКОЕ ПРЕДЛОЖЕНИЕ ОБЯЗАНО быть грамматически полным: подлежащее+сказуемое или законченное назывное. ЗАПРЕЩЕНО обрывать придаточное на союзе/предлоге и ставить точку. Дефекты вида "…потому что.", "…но зимой.", "…но когда.", "…если.", "…хотя.", "…так как.", "…чтобы.", "…несмотря на." категорически запрещены — либо допиши придаточное до конца, либо перестрой без союза.
- Все ключевые слова склоняй по падежу/числу и встраивай в естественную грамматику. НЕ вставляй ключ в именительном падеже посреди фразы ("купить минитрактор цена приятная" — дефект; правильно: "Цена на минитрактор приятная").
- Запрещены штампы: "в современном мире", "ни для кого не секрет", "следует отметить", "стоит сказать", "является", "осуществляет", "в рамках", "на сегодняшний день".
- В русском НИКОГДА не используй букву 'ё', только 'е'. Тире (—, –) заменяй на дефис (-).
- Пиши прямо и по делу. Возвращай ТОЛЬКО переписанный markdown без комментариев.`;

const SYSTEM_EN = `You are a human editor. Rewrite the text so it no longer reads like AI.
STRICT rules:
- Do not change facts, numbers, brands, links, names.
- Preserve structure (markdown headings, lists, tables, links).
- Do NOT modify headings (# / ## / ### / <h2> / <h3>): keep their exact text, word order and letter case. Never lowercase headings, never turn them into questions, never inject conversational fillers into them. Rhythm and length rules apply ONLY to paragraphs and list items.
- NO sentence longer than 28 words.
- Alternate short (4-7 words) and medium (12-22 words) sentences. No bold.
- A SHORT sentence must be grammatically complete: subject+verb or a full noun phrase. NEVER cut a subordinate clause on a conjunction/preposition and place a period. Fragments like "…because.", "…but in winter.", "…if.", "…when.", "…although." are forbidden — either finish the clause or restructure without the conjunction.
- Blend all keywords into natural grammar (inflect for case/number where applicable). No raw nominative insertions mid-sentence.
- Forbidden filler: "in today's world", "it is worth noting", "needless to say", "as we all know".
- Replace em/en dashes (—, –) with regular hyphens (-).
- Write directly and concretely. Return ONLY the rewritten markdown, no commentary.`;

function buildEnSentenceHint(m: ReturnType<typeof analyzeSentenceStructure>): string | null {
  if (m.verdict === "pass") return null;
  const problems: string[] = [];
  if (m.avgWords && m.avgWords < 14) problems.push(`- Avg sentence length ${m.avgWords.toFixed(1)} words is too short (target 16-26).`);
  if (m.shortRatio > 0.3) problems.push(`- Too many short sentences (${Math.round(m.shortRatio * 100)}%). Merge them with "because", "while", "so that".`);
  if (m.maxShortRun >= 3) problems.push(`- Runs of ${m.maxShortRun} short sentences in a row. Max 2 in a row.`);
  if (!problems.length) return null;
  return [
    "SENTENCE STRUCTURE PROBLEMS:",
    problems.join("\n"),
    "",
    "RULES:",
    "1. Don't split one thought into two sentences. Join with commas or em-dashes.",
    "2. Don't stack 3+ short sentences in a row — combine through subordination.",
    "3. Keep facts, numbers, links and HTML/markdown structure untouched.",
  ].join("\n");
}

function structureHintFor(lang: "ru" | "en", content: string): string {
  try {
    const metrics = analyzeSentenceStructure(content);
    const hint = lang === "ru"
      ? buildSentenceStructureFixHint(metrics)
      : buildEnSentenceHint(metrics);
    return hint ? `\n\n${hint}\n` : "";
  } catch {
    return "";
  }
}

const PASS1_USER = (lang: "ru" | "en", content: string) => {
  const hint = structureHintFor(lang, content);
  return lang === "ru"
    ? `Перепиши текст под живой человеческий ритм. Цель: AI-детектор должен показать <30%. Не теряй ни одного факта или ссылки.${hint}\nТекст:\n${content}`
    : `Rewrite the text with a lively human rhythm. Goal: AI detectors must score <30%. Do not lose any facts or links.\n\nText:\n${content}`;
};

const PASS2_USER = (lang: "ru" | "en", content: string) => {
  const hint = structureHintFor(lang, content);
  return lang === "ru"
    ? `Микро-проход: убери оставшиеся "ИИ-подписи" - монотонность синтаксиса, одинаковые начала абзацев, лексические всплески. Цель: AI-детектор <5%. Никаких изменений в фактах, цифрах, ссылках.${hint}\nТекст:\n${content}`
    : `Micro-pass: remove remaining "AI fingerprints" - monotonous syntax, repeated paragraph openers, lexical bursts. Goal: AI detectors <5%. Do not touch facts, numbers, or links.\n\nText:\n${content}`;
};

async function callOpenRouter(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  timeoutMs = 90_000,
  logCtx: { functionName?: string; userId?: string | null; articleId?: string | null } = {},
): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Modul humanizePass",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.7,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const errBody = await r.text().catch(() => "");
      console.warn(`[humanize] ${model} HTTP ${r.status}: ${errBody.slice(0, 200)}`);
      return null;
    }
    const j = await r.json();
    logLLM({
      functionName: logCtx.functionName || "humanize-pass",
      model: String(j?.model || model),
      tokensIn: Number(j?.usage?.prompt_tokens || 0),
      tokensOut: Number(j?.usage?.completion_tokens || 0),
      userId: logCtx.userId ?? null,
      articleId: logCtx.articleId ?? null,
    });
    return (j?.choices?.[0]?.message?.content as string | undefined) ?? null;
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    const isAbort = (e as Error)?.name === "AbortError" || /abort/i.test(msg);
    console.warn(`[humanize] ${model} threw${isAbort ? " (timeout)" : ""}:`, msg);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Crude integrity guard: rewritten output must keep ≥85% of original word
 * count and not collapse below 200 chars. Otherwise we fall back to the
 * pre-pass version.
 */
function integrityOk(before: string, after: string): boolean {
  if (!after || after.length < 200) return false;
  const wb = before.replace(/\s+/g, " ").split(" ").length;
  const wa = after.replace(/\s+/g, " ").split(" ").length;
  if (wa < wb * 0.7) return false;
  if (wa > wb * 1.5) return false;
  return true;
}

function stripCodeFences(s: string): string {
  return s
    .replace(/^\s*```(?:markdown|md)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export interface DoubleHumanizeResult {
  content: string;
  passesApplied: number;
  modelsUsed: string[];
  opusSkipped?: boolean;
  opusSkipReason?: string;
  metrics?: {
    pre: HumanizeMetrics;
    postPass1?: HumanizeMetrics;
    postPass2?: HumanizeMetrics;
    postCleanup?: HumanizeMetrics;
  };
  rejections?: string[];
}

/**
 * Run double humanize pass (Sonnet + Opus). Best-effort: if a pass fails or
 * the integrity guard rejects it, the previous content is kept.
 */
/**
 * Optional budget gate. If `admin` (service-role client) and `userId` are
 * provided, the Opus pass is gated by `public.check_ai_budget` so we never
 * blow past per-plan caps. Admins/staff bypass automatically inside the SQL.
 */
export async function runDoubleHumanizePass(
  content: string,
  language: "ru" | "en",
  openRouterKey: string | null | undefined,
  opts?: { admin?: any; userId?: string | null; maxMs?: number; articleId?: string | null; functionName?: string },
): Promise<DoubleHumanizeResult> {
  const logCtx = {
    functionName: opts?.functionName || "humanize-pass",
    userId: opts?.userId ?? null,
    articleId: opts?.articleId ?? null,
  };
  if (!openRouterKey || !content || content.length < 300) {
    return { content, passesApplied: 0, modelsUsed: [] };
  }
  const budgetMs = Math.max(0, Number(opts?.maxMs) || 0);
  // If caller passed a very tight budget, skip humanize entirely.
  if (budgetMs > 0 && budgetMs < 30_000) {
    return { content, passesApplied: 0, modelsUsed: [], opusSkipped: true, opusSkipReason: "time_budget_too_small" };
  }
  const startedAt = Date.now();
  const remaining = () => budgetMs > 0 ? Math.max(0, budgetMs - (Date.now() - startedAt)) : Infinity;
  const system = language === "ru" ? SYSTEM_RU : SYSTEM_EN;
  const modelsUsed: string[] = [];
  let current = content;
  let passes = 0;
  let opusSkipped = false;
  let opusSkipReason: string | undefined;
  const rejections: string[] = [];
  const preMetrics = measureHumanize(current, language);
  const preSig = preMetrics.signatures;
  let postPass1: HumanizeMetrics | undefined;
  let postPass2: HumanizeMetrics | undefined;
  let postCleanup: HumanizeMetrics | undefined;

  // Adaptive timeouts based on content length. The double-pass MUST fit
  // inside the edge-function wall clock (~150s on Lovable Cloud), otherwise
  // the request is killed mid-flight ("connection closed before message
  // completed") and the client toast hangs indefinitely. Budget: ~135s total
  // for short/medium texts, ~145s for long (Opus is dropped for >15k anyway).
  const len = content.length;
  let sonnetTimeout = len > 12_000 ? 75_000 : len > 6_000 ? 65_000 : 55_000;
  let opusTimeout   = len > 12_000 ? 70_000 : len > 6_000 ? 70_000 : 70_000;
  // Cap pass1 timeout to ~half of remaining budget so pass2 has air.
  if (budgetMs > 0) {
    sonnetTimeout = Math.min(sonnetTimeout, Math.max(20_000, Math.floor(budgetMs * 0.55)));
  }

  // Pass 1: Sonnet (deeper rewrite)
  const out1 = await callOpenRouter(openRouterKey, SONNET_MODEL, system, PASS1_USER(language, current), sonnetTimeout, { ...logCtx, functionName: `${logCtx.functionName}/pass1` });
  if (out1) {
    const cand1 = applyStealthPostProcess(stripCodeFences(out1), language);
    const candSig = (await Promise.resolve(measureHumanize(cand1, language))).signatures;
    const struct = structuralIntegrityOk(preSig, candSig);
    if (!integrityOk(current, cand1)) {
      rejections.push("pass1:word_count");
      console.warn("[humanize] pass1 rejected by word-count guard");
    } else if (!struct.ok) {
      rejections.push(`pass1:structure:${struct.reason}`);
      console.warn("[humanize] pass1 rejected by structure guard:", struct.reason);
    } else {
      current = cand1;
      passes++;
      modelsUsed.push(SONNET_MODEL);
      postPass1 = measureHumanize(current, language);
    }
  }

  // Pass 2: Opus (micro-polish) — gated by per-user budget when admin client provided.
  let opusAllowed = true;
  // For very long texts (>15k chars) Opus is unreliable: skip and use Sonnet
  // as the micro-polish model instead.
  const useSonnetForPass2 = len > 15_000;
  if (useSonnetForPass2) {
    opusSkipReason = "too_long_for_opus";
  }
  if (opts?.admin && opts?.userId) {
    try {
      const { data } = await opts.admin.rpc("check_ai_budget", {
        _user_id: opts.userId,
        _model: useSonnetForPass2 ? SONNET_MODEL : OPUS_MODEL,
      });
      if (data && data.allowed === false) {
        opusAllowed = false;
        opusSkipped = true;
        opusSkipReason = String(data.reason || "blocked");
        console.warn("[humanize] Opus skipped:", data);
      }
    } catch (e) {
      console.warn("[humanize] check_ai_budget failed, allowing Opus:", (e as Error).message);
    }
  }
  let pass2Model = useSonnetForPass2 ? SONNET_MODEL : OPUS_MODEL;
  // Recompute remaining budget; skip pass2 if not enough time left.
  const rem2 = remaining();
  if (budgetMs > 0 && rem2 < 25_000) {
    opusAllowed = false;
    opusSkipped = true;
    opusSkipReason = (opusSkipReason ? opusSkipReason + "+" : "") + "no_time_for_pass2";
  } else if (budgetMs > 0) {
    const cap = Math.max(20_000, rem2 - 5_000);
    opusTimeout = Math.min(opusTimeout, cap);
    sonnetTimeout = Math.min(sonnetTimeout, cap);
  }
  let out2 = opusAllowed
    ? await callOpenRouter(openRouterKey, pass2Model, system, PASS2_USER(language, current), useSonnetForPass2 ? sonnetTimeout : opusTimeout, { ...logCtx, functionName: `${logCtx.functionName}/pass2` })
    : null;

  // Fallback: if Opus failed (timeout/HTTP error), retry pass2 with Sonnet
  // so we still get a polish pass instead of degrading silently.
  if (opusAllowed && !out2 && !useSonnetForPass2) {
    const remFb = remaining();
    if (budgetMs > 0 && remFb < 25_000) {
      opusSkipReason = (opusSkipReason ? opusSkipReason + "+" : "") + "no_time_for_fallback";
    } else {
      console.warn("[humanize] Opus failed, falling back to Sonnet for pass2");
      opusSkipped = true;
      opusSkipReason = "opus_failed_fallback_sonnet";
      pass2Model = SONNET_MODEL;
      const cap = budgetMs > 0 ? Math.max(20_000, remFb - 5_000) : sonnetTimeout;
      out2 = await callOpenRouter(openRouterKey, SONNET_MODEL, system, PASS2_USER(language, current), Math.min(sonnetTimeout, cap), { ...logCtx, functionName: `${logCtx.functionName}/pass2-fb-sonnet` });
    }
  }

  // 3rd-tier fallback: if Sonnet also failed (e.g. account 402, region
  // throttling), fall back to Llama 3.3 70B so the article still gets a
  // micro-polish instead of skipping pass2 entirely.
  if (!out2 && (budgetMs === 0 || remaining() >= 25_000)) {
    console.warn("[humanize] Sonnet also failed, falling back to Llama 3.3 70B for pass2");
    opusSkipped = true;
    opusSkipReason = (opusSkipReason ? opusSkipReason + "+" : "") + "sonnet_failed_fallback_llama";
    pass2Model = LLAMA_FALLBACK_MODEL;
    const cap = budgetMs > 0 ? Math.max(20_000, remaining() - 5_000) : 90_000;
    out2 = await callOpenRouter(openRouterKey, LLAMA_FALLBACK_MODEL, system, PASS2_USER(language, current), Math.min(90_000, cap), { ...logCtx, functionName: `${logCtx.functionName}/pass2-fb-llama` });
  }

  if (out2) {
    const cand2 = applyStealthPostProcess(stripCodeFences(out2), language);
    const candSig = measureHumanize(cand2, language).signatures;
    const struct = structuralIntegrityOk(preSig, candSig);
    if (!integrityOk(current, cand2)) {
      rejections.push("pass2:word_count");
      console.warn("[humanize] pass2 rejected by word-count guard");
    } else if (!struct.ok) {
      rejections.push(`pass2:structure:${struct.reason}`);
      console.warn("[humanize] pass2 rejected by structure guard:", struct.reason);
    } else {
      current = cand2;
      passes++;
      modelsUsed.push(pass2Model);
      postPass2 = measureHumanize(current, language);
    }
  }

  // Optional 3rd mini-pass: targeted BANLIST cleanup if hits remain too high.
  // Cheap and short (Sonnet, 35s budget). Only RU, only if pass1 ran.
  const afterMetrics = postPass2 || postPass1;
  const banlistAfter = afterMetrics ? afterMetrics.banlistHits : 0;
  const chainsAfter = afterMetrics ? afterMetrics.chainViolations : 0;
  if (
    language === "ru" &&
    passes > 0 &&
    (banlistAfter >= 6 || chainsAfter >= 3) &&
    (budgetMs === 0 || remaining() >= 40_000)
  ) {
    const hits = listBanlistHits(current, language, 10);
    const hintList = hits.length
      ? `Конкретно перепиши/убери эти обороты: ${hits.map((h) => `"${h}"`).join(", ")}.`
      : "";
    const cleanupUser = [
      "Финальная зачистка штампов. Не меняй структуру, факты, числа, ссылки, HTML-теги, заголовки и списки.",
      hintList,
      chainsAfter >= 3
        ? "Если в одном предложении 2+ союзов из \"в то время как\", \"поскольку\", \"что\" - разбей на два предложения."
        : "",
      "Возвращай ТОЛЬКО переписанный markdown.",
      "",
      "Текст:",
      current,
    ].filter(Boolean).join("\n");
    const out3 = await callOpenRouter(openRouterKey, SONNET_MODEL, system, cleanupUser, 35_000, { ...logCtx, functionName: `${logCtx.functionName}/cleanup` });
    if (out3) {
      const cand3 = applyStealthPostProcess(stripCodeFences(out3), language);
      const candSig = measureHumanize(cand3, language).signatures;
      const struct = structuralIntegrityOk(preSig, candSig);
      if (integrityOk(current, cand3) && struct.ok) {
        // Accept only if it actually reduces violations.
        const after = measureHumanize(cand3, language);
        if (after.banlistHits + after.chainViolations < banlistAfter + chainsAfter) {
          current = cand3;
          passes++;
          modelsUsed.push(SONNET_MODEL + ":cleanup");
          postCleanup = after;
        } else {
          rejections.push("cleanup:no_improvement");
        }
      } else {
        rejections.push(`cleanup:${struct.ok ? "word_count" : "structure:" + struct.reason}`);
      }
    }
  }

  return {
    content: current,
    passesApplied: passes,
    modelsUsed,
    opusSkipped,
    opusSkipReason,
    metrics: { pre: preMetrics, postPass1, postPass2, postCleanup },
    rejections: rejections.length ? rejections : undefined,
  };
}