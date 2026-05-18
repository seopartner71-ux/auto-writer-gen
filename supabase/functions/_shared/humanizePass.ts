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

const SONNET_MODEL = "anthropic/claude-sonnet-4";
const OPUS_MODEL = "anthropic/claude-opus-4";
// Last-resort fallback: cheap and almost free on OpenRouter, keeps the
// humanize pipeline alive when both Anthropic models fail (402/429/timeout).
const LLAMA_FALLBACK_MODEL = "meta-llama/llama-3.3-70b-instruct";

const SYSTEM_RU = `Ты редактор-человек. Переписываешь текст так, чтобы он перестал быть похожим на ИИ.
СТРОГО соблюдай:
- НЕ меняй факты, цифры, бренды, ссылки, имена.
- Сохрани структуру (markdown заголовки, списки, таблицы, ссылки).
- НИ ОДНОГО предложения длиннее 28 слов.
- Чередуй короткие (4-7 слов) и средние (12-22 слова) предложения. Без жирного.
- Запрещены штампы: "в современном мире", "ни для кого не секрет", "следует отметить", "стоит сказать", "является", "осуществляет", "в рамках", "на сегодняшний день".
- В русском НИКОГДА не используй букву 'ё', только 'е'. Тире (—, –) заменяй на дефис (-).
- Пиши прямо и по делу. Возвращай ТОЛЬКО переписанный markdown без комментариев.`;

const SYSTEM_EN = `You are a human editor. Rewrite the text so it no longer reads like AI.
STRICT rules:
- Do not change facts, numbers, brands, links, names.
- Preserve structure (markdown headings, lists, tables, links).
- NO sentence longer than 28 words.
- Alternate short (4-7 words) and medium (12-22 words) sentences. No bold.
- Forbidden filler: "in today's world", "it is worth noting", "needless to say", "as we all know".
- Replace em/en dashes (—, –) with regular hyphens (-).
- Write directly and concretely. Return ONLY the rewritten markdown, no commentary.`;

const PASS1_USER = (lang: "ru" | "en", content: string) =>
  lang === "ru"
    ? `Перепиши текст под живой человеческий ритм. Цель: AI-детектор должен показать <30%. Не теряй ни одного факта или ссылки.\n\nТекст:\n${content}`
    : `Rewrite the text with a lively human rhythm. Goal: AI detectors must score <30%. Do not lose any facts or links.\n\nText:\n${content}`;

const PASS2_USER = (lang: "ru" | "en", content: string) =>
  lang === "ru"
    ? `Микро-проход: убери оставшиеся "ИИ-подписи" - монотонность синтаксиса, одинаковые начала абзацев, лексические всплески. Цель: AI-детектор <5%. Никаких изменений в фактах, цифрах, ссылках.\n\nТекст:\n${content}`
    : `Micro-pass: remove remaining "AI fingerprints" - monotonous syntax, repeated paragraph openers, lexical bursts. Goal: AI detectors <5%. Do not touch facts, numbers, or links.\n\nText:\n${content}`;

async function callOpenRouter(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  timeoutMs = 90_000,
): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
  opts?: { admin?: any; userId?: string | null },
): Promise<DoubleHumanizeResult> {
  if (!openRouterKey || !content || content.length < 300) {
    return { content, passesApplied: 0, modelsUsed: [] };
  }
  const system = language === "ru" ? SYSTEM_RU : SYSTEM_EN;
  const modelsUsed: string[] = [];
  let current = content;
  let passes = 0;
  let opusSkipped = false;
  let opusSkipReason: string | undefined;

  // Adaptive timeouts based on content length. Opus is much slower per token.
  const len = content.length;
  const sonnetTimeout = len > 12_000 ? 180_000 : len > 6_000 ? 120_000 : 90_000;
  const opusTimeout = len > 12_000 ? 240_000 : len > 6_000 ? 180_000 : 120_000;

  // Pass 1: Sonnet (deeper rewrite)
  const out1 = await callOpenRouter(openRouterKey, SONNET_MODEL, system, PASS1_USER(language, current), sonnetTimeout);
  if (out1) {
    const cand1 = applyStealthPostProcess(stripCodeFences(out1), language);
    if (integrityOk(current, cand1)) {
      current = cand1;
      passes++;
      modelsUsed.push(SONNET_MODEL);
    } else {
      console.warn("[humanize] pass1 rejected by integrity guard");
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
  let out2 = opusAllowed
    ? await callOpenRouter(openRouterKey, pass2Model, system, PASS2_USER(language, current), useSonnetForPass2 ? sonnetTimeout : opusTimeout)
    : null;

  // Fallback: if Opus failed (timeout/HTTP error), retry pass2 with Sonnet
  // so we still get a polish pass instead of degrading silently.
  if (opusAllowed && !out2 && !useSonnetForPass2) {
    console.warn("[humanize] Opus failed, falling back to Sonnet for pass2");
    opusSkipped = true;
    opusSkipReason = "opus_failed_fallback_sonnet";
    pass2Model = SONNET_MODEL;
    out2 = await callOpenRouter(openRouterKey, SONNET_MODEL, system, PASS2_USER(language, current), sonnetTimeout);
  }

  // 3rd-tier fallback: if Sonnet also failed (e.g. account 402, region
  // throttling), fall back to Llama 3.3 70B so the article still gets a
  // micro-polish instead of skipping pass2 entirely.
  if (!out2) {
    console.warn("[humanize] Sonnet also failed, falling back to Llama 3.3 70B for pass2");
    opusSkipped = true;
    opusSkipReason = (opusSkipReason ? opusSkipReason + "+" : "") + "sonnet_failed_fallback_llama";
    pass2Model = LLAMA_FALLBACK_MODEL;
    out2 = await callOpenRouter(openRouterKey, LLAMA_FALLBACK_MODEL, system, PASS2_USER(language, current), 90_000);
  }

  if (out2) {
    const cand2 = applyStealthPostProcess(stripCodeFences(out2), language);
    if (integrityOk(current, cand2)) {
      current = cand2;
      passes++;
      modelsUsed.push(pass2Model);
    } else {
      console.warn("[humanize] pass2 rejected by integrity guard");
    }
  }

  return { content: current, passesApplied: passes, modelsUsed, opusSkipped, opusSkipReason };
}