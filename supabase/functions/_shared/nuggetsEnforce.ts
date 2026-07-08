/**
 * Data Nuggets enforcement.
 *
 * If the generated article uses <thresholdRatio of the supplied facts/numbers,
 * we don't full-regenerate (too expensive). Instead, we run a targeted
 * "insert missing nuggets" pass on Sonnet that organically weaves the missing
 * facts into the existing paragraphs without restructuring the article.
 *
 * Returns the original content if the rewrite fails the integrity guard or
 * if the new coverage isn't actually better.
 */

import { dataNuggetsCoverage } from "./contentValidator.ts";
import { logLLM } from "./costLogger.ts";

async function callOpenRouter(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  timeoutMs = 60_000,
): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.5,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.warn(`[nuggets-enforce] ${model} HTTP ${r.status}`);
      return null;
    }
    const j = await r.json();
    try { logLLM({ functionName: "nuggetsEnforce", model: ((j as any)?.model) as string, tokensIn: Number((j as any)?.usage?.prompt_tokens || 0), tokensOut: Number((j as any)?.usage?.completion_tokens || 0) }); } catch(_) {}
    return (j?.choices?.[0]?.message?.content as string | undefined) ?? null;
  } catch (e) {
    console.warn(`[nuggets-enforce] ${model} threw:`, (e as Error)?.message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function stripFences(s: string): string {
  return s.replace(/^\s*```(?:markdown|md)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function integrityOk(before: string, after: string): boolean {
  if (!after || after.length < 200) return false;
  const wb = before.replace(/\s+/g, " ").split(" ").length;
  const wa = after.replace(/\s+/g, " ").split(" ").length;
  // Allow growth up to +60% (we are inserting facts).
  return wa >= wb * 0.85 && wa <= wb * 1.6;
}

export interface NuggetsEnforceResult {
  content: string;
  applied: boolean;
  beforeRatio: number;
  afterRatio: number;
  missingCount: number;
}

export async function enforceDataNuggets(
  content: string,
  nuggets: string[],
  language: "ru" | "en",
  openRouterKey: string | null | undefined,
  thresholdRatio = 0.5,
): Promise<NuggetsEnforceResult> {
  if (!Array.isArray(nuggets) || nuggets.length === 0 || !openRouterKey || content.length < 300) {
    return { content, applied: false, beforeRatio: 1, afterRatio: 1, missingCount: 0 };
  }
  const before = dataNuggetsCoverage(content, nuggets);
  if (before.ratio >= thresholdRatio) {
    return { content, applied: false, beforeRatio: before.ratio, afterRatio: before.ratio, missingCount: 0 };
  }

  const missing = (before.missing && before.missing.length > 0)
    ? before.missing
    : nuggets.filter((n) => !content.toLowerCase().includes(String(n).toLowerCase()));
  if (missing.length === 0) {
    return { content, applied: false, beforeRatio: before.ratio, afterRatio: before.ratio, missingCount: 0 };
  }

  const system = language === "ru"
    ? `Ты редактор. Встраиваешь недостающие факты и цифры в существующий текст. СТРОГО:
- Не меняй структуру (заголовки, порядок разделов, списки, таблицы).
- Не переписывай абзацы, в которых нет места для нового факта - оставь как есть.
- Каждый факт встрой в естественный контекст, в подходящий по смыслу абзац.
- Не пиши "согласно данным", "как показывают цифры" - факт должен звучать частью повествования.
- В русском НИКОГДА не используй букву 'ё', только 'е'. Тире (—, –) заменяй на дефис (-). Без жирного.
- Возвращай ТОЛЬКО полный итоговый markdown.`
    : `You are an editor. Insert missing facts and numbers into the existing text. STRICT rules:
- Do not change structure (headings, section order, lists, tables).
- Do not rewrite paragraphs that have no room for a new fact - leave them as-is.
- Embed each fact in natural context, into a thematically appropriate paragraph.
- Do not write "according to data", "as the numbers show" - the fact must sound part of the narrative.
- Replace em/en dashes (—, –) with regular hyphens (-). No bold.
- Return ONLY the full final markdown.`;

  const user = language === "ru"
    ? `Недостающие факты, которые нужно органично встроить (каждый минимум 1 раз):\n${missing.map((m, i) => `${i + 1}. ${m}`).join("\n")}\n\nТекущий текст:\n${content}`
    : `Missing facts to weave in organically (each at least once):\n${missing.map((m, i) => `${i + 1}. ${m}`).join("\n")}\n\nCurrent text:\n${content}`;

  const out = await callOpenRouter(openRouterKey, "anthropic/claude-sonnet-4", system, user);
  if (!out) return { content, applied: false, beforeRatio: before.ratio, afterRatio: before.ratio, missingCount: missing.length };
  const candidate = stripFences(out);
  if (!integrityOk(content, candidate)) {
    return { content, applied: false, beforeRatio: before.ratio, afterRatio: before.ratio, missingCount: missing.length };
  }
  const after = dataNuggetsCoverage(candidate, nuggets);
  if (after.ratio <= before.ratio + 0.1) {
    return { content, applied: false, beforeRatio: before.ratio, afterRatio: after.ratio, missingCount: missing.length };
  }
  return { content: candidate, applied: true, beforeRatio: before.ratio, afterRatio: after.ratio, missingCount: missing.length };
}