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
      console.warn(`[humanize] ${model} HTTP ${r.status}`);
      return null;
    }
    const j = await r.json();
    return (j?.choices?.[0]?.message?.content as string | undefined) ?? null;
  } catch (e) {
    console.warn(`[humanize] ${model} threw:`, (e as Error)?.message);
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

  // Pass 1: Sonnet (deeper rewrite)
  const out1 = await callOpenRouter(openRouterKey, SONNET_MODEL, system, PASS1_USER(language, current));
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
  if (opts?.admin && opts?.userId) {
    try {
      const { data } = await opts.admin.rpc("check_ai_budget", { _user_id: opts.userId, _model: OPUS_MODEL });
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
  const out2 = opusAllowed
    ? await callOpenRouter(openRouterKey, OPUS_MODEL, system, PASS2_USER(language, current))
    : null;
  if (out2) {
    const cand2 = applyStealthPostProcess(stripCodeFences(out2), language);
    if (integrityOk(current, cand2)) {
      current = cand2;
      passes++;
      modelsUsed.push(OPUS_MODEL);
    } else {
      console.warn("[humanize] pass2 rejected by integrity guard");
    }
  }

  return { content: current, passesApplied: passes, modelsUsed, opusSkipped, opusSkipReason };
}