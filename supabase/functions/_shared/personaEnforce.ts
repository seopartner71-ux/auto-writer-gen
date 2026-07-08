/**
 * Persona enforcement: if measured syntax deviates >threshold from the
 * declared syntax_profile, ask the model to rewrite ONLY the syntax/rhythm
 * (not facts, not structure) to bring it back into the profile's range.
 *
 * Used by bulk-generate after the main draft. Single-pass, best-effort.
 */

import { personaProfileDeviation } from "./contentValidator.ts";
import { logLLM } from "./costLogger.ts";

type SyntaxProfile = "practitioner" | "academic" | "blogger" | "journalist" | "default";

const PROFILE_GUIDE_RU: Record<SyntaxProfile, string> = {
  practitioner: "Практик: средняя длина предложения ~11 слов. Короткие, конкретные. Без воды, без академизма.",
  academic:     "Академик: средняя длина ~22 слова, ровный ритм, низкая вариативность. Полные конструкции.",
  blogger:      "Блогер: средняя длина ~9 слов. Очень рваный ритм, разговорные вставки, эмоциональные паузы.",
  journalist:   "Журналист: средняя длина ~14 слов. Чередование коротких и средних, информационная плотность.",
  default:      "Универсальный: средняя длина ~14 слов, умеренная вариативность.",
};
const PROFILE_GUIDE_EN: Record<SyntaxProfile, string> = {
  practitioner: "Practitioner: avg ~11 words/sentence. Short, concrete, no fluff.",
  academic:     "Academic: avg ~22 words/sentence. Even rhythm, full constructions, low variance.",
  blogger:      "Blogger: avg ~9 words/sentence. Jagged rhythm, conversational asides, emotional beats.",
  journalist:   "Journalist: avg ~14 words/sentence. Alternating short and medium, dense information.",
  default:      "Default: avg ~14 words/sentence, moderate variance.",
};

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
        temperature: 0.65,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.warn(`[persona-enforce] ${model} HTTP ${r.status}`);
      return null;
    }
    const j = await r.json();
    try { logLLM({ functionName: "personaEnforce", model: ((j as any)?.model) as string, tokensIn: Number((j as any)?.usage?.prompt_tokens || 0), tokensOut: Number((j as any)?.usage?.completion_tokens || 0) }); } catch(_) {}
    return (j?.choices?.[0]?.message?.content as string | undefined) ?? null;
  } catch (e) {
    console.warn(`[persona-enforce] ${model} threw:`, (e as Error)?.message);
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
  return wa >= wb * 0.7 && wa <= wb * 1.5;
}

export interface PersonaEnforceResult {
  content: string;
  applied: boolean;
  beforeDeviation: number;
  afterDeviation: number;
}

/**
 * If deviation > threshold, run a syntax-rewrite pass and return the new
 * content (only if it actually reduced the deviation). Otherwise returns
 * the original.
 */
export async function enforcePersonaSyntax(
  content: string,
  expectedProfile: SyntaxProfile | string | null | undefined,
  language: "ru" | "en",
  openRouterKey: string | null | undefined,
  threshold = 0.3,
): Promise<PersonaEnforceResult> {
  const profile = ((expectedProfile as SyntaxProfile) || "default") as SyntaxProfile;
  const before = personaProfileDeviation(content, profile);
  if (before.deviation <= threshold || !openRouterKey || content.length < 400) {
    return { content, applied: false, beforeDeviation: before.deviation, afterDeviation: before.deviation };
  }

  const guide = (language === "ru" ? PROFILE_GUIDE_RU : PROFILE_GUIDE_EN)[profile];
  const system = language === "ru"
    ? `Ты редактор. Переписываешь ритм и длину предложений, чтобы текст попал в нужный профиль автора. СТРОГО: не меняй факты, цифры, бренды, ссылки, структуру (заголовки, списки, таблицы). Не убирай и не добавляй разделы. Возвращай ТОЛЬКО переписанный markdown.`
    : `You are an editor. Rewrite the rhythm and sentence length so the text matches the requested author profile. STRICT: do not change facts, numbers, brands, links, or structure (headings, lists, tables). Do not remove or add sections. Return ONLY the rewritten markdown.`;
  const user = language === "ru"
    ? `Профиль: ${profile}\n${guide}\n\nИзмеренное отклонение: ${(before.deviation * 100).toFixed(0)}% (avg sentence len = ${before.measured.avgSentLen.toFixed(1)} слов).\nЗадача: привести ритм к профилю, не теряя содержание.\n\nТекст:\n${content}`
    : `Profile: ${profile}\n${guide}\n\nMeasured deviation: ${(before.deviation * 100).toFixed(0)}% (avg sentence len = ${before.measured.avgSentLen.toFixed(1)} words).\nTask: align the rhythm to the profile without losing content.\n\nText:\n${content}`;

  const out = await callOpenRouter(openRouterKey, "anthropic/claude-sonnet-4", system, user);
  if (!out) return { content, applied: false, beforeDeviation: before.deviation, afterDeviation: before.deviation };
  const candidate = stripFences(out);
  if (!integrityOk(content, candidate)) {
    console.warn("[persona-enforce] integrity guard rejected rewrite");
    return { content, applied: false, beforeDeviation: before.deviation, afterDeviation: before.deviation };
  }
  const after = personaProfileDeviation(candidate, profile);
  // Only accept if deviation actually went down by ≥20% relative.
  if (after.deviation > before.deviation * 0.8) {
    return { content, applied: false, beforeDeviation: before.deviation, afterDeviation: after.deviation };
  }
  return { content: candidate, applied: true, beforeDeviation: before.deviation, afterDeviation: after.deviation };
}