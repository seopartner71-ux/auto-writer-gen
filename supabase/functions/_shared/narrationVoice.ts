// Narration voice guard ("Лицо повествования": я / мы).
//
// The writer prompt already asks for a fixed person, but models drift —
// especially after humanize passes that rewrite whole paragraphs. This module
// makes the rule deterministic:
//   1. safe regex fixes (possessives / oblique pronouns — no verb agreement
//      involved, so they can never break grammar);
//   2. a residual violation count;
//   3. one focused LLM rewrite when subject pronouns (which DO require verb
//      agreement in Russian) are still wrong.
//
// All transforms skip HTML tags — only text nodes are touched.

export type NarrationPerson = "ya" | "my";

const RU_SAFE_TO_MY: Array<[RegExp, string]> = [
  [/(?<![\\p{L}\\p{N}_])меня(?![\\p{L}\\p{N}_])/giu, "нас"],
  [/(?<![\\p{L}\\p{N}_])мне(?![\\p{L}\\p{N}_])/giu, "нам"],
  [/(?<![\\p{L}\\p{N}_])мной(?![\\p{L}\\p{N}_])/giu, "нами"],
  [/(?<![\\p{L}\\p{N}_])мною(?![\\p{L}\\p{N}_])/giu, "нами"],
  [/(?<![\\p{L}\\p{N}_])мой(?![\\p{L}\\p{N}_])/giu, "наш"],
  [/(?<![\\p{L}\\p{N}_])моего(?![\\p{L}\\p{N}_])/giu, "нашего"],
  [/(?<![\\p{L}\\p{N}_])моему(?![\\p{L}\\p{N}_])/giu, "нашему"],
  [/(?<![\\p{L}\\p{N}_])моим(?![\\p{L}\\p{N}_])/giu, "нашим"],
  [/(?<![\\p{L}\\p{N}_])моём(?![\\p{L}\\p{N}_])/giu, "нашем"],
  [/(?<![\\p{L}\\p{N}_])моем(?![\\p{L}\\p{N}_])/giu, "нашем"],
  [/(?<![\\p{L}\\p{N}_])моя(?![\\p{L}\\p{N}_])/giu, "наша"],
  [/(?<![\\p{L}\\p{N}_])моей(?![\\p{L}\\p{N}_])/giu, "нашей"],
  [/(?<![\\p{L}\\p{N}_])мою(?![\\p{L}\\p{N}_])/giu, "нашу"],
  [/(?<![\\p{L}\\p{N}_])моё(?![\\p{L}\\p{N}_])/giu, "наше"],
  [/(?<![\\p{L}\\p{N}_])мое(?![\\p{L}\\p{N}_])/giu, "наше"],
  [/(?<![\\p{L}\\p{N}_])мои(?![\\p{L}\\p{N}_])/giu, "наши"],
  [/(?<![\\p{L}\\p{N}_])моих(?![\\p{L}\\p{N}_])/giu, "наших"],
  [/(?<![\\p{L}\\p{N}_])моими(?![\\p{L}\\p{N}_])/giu, "нашими"],
];

const RU_SAFE_TO_YA: Array<[RegExp, string]> = [
  [/(?<![\\p{L}\\p{N}_])нас(?![\\p{L}\\p{N}_])/giu, "меня"],
  [/(?<![\\p{L}\\p{N}_])нам(?![\\p{L}\\p{N}_])/giu, "мне"],
  [/(?<![\\p{L}\\p{N}_])нами(?![\\p{L}\\p{N}_])/giu, "мной"],
  [/(?<![\\p{L}\\p{N}_])наш(?![\\p{L}\\p{N}_])/giu, "мой"],
  [/(?<![\\p{L}\\p{N}_])нашего(?![\\p{L}\\p{N}_])/giu, "моего"],
  [/(?<![\\p{L}\\p{N}_])нашему(?![\\p{L}\\p{N}_])/giu, "моему"],
  [/(?<![\\p{L}\\p{N}_])нашим(?![\\p{L}\\p{N}_])/giu, "моим"],
  [/(?<![\\p{L}\\p{N}_])нашем(?![\\p{L}\\p{N}_])/giu, "моём"],
  [/(?<![\\p{L}\\p{N}_])наша(?![\\p{L}\\p{N}_])/giu, "моя"],
  [/(?<![\\p{L}\\p{N}_])нашей(?![\\p{L}\\p{N}_])/giu, "моей"],
  [/(?<![\\p{L}\\p{N}_])нашу(?![\\p{L}\\p{N}_])/giu, "мою"],
  [/(?<![\\p{L}\\p{N}_])наше(?![\\p{L}\\p{N}_])/giu, "моё"],
  [/(?<![\\p{L}\\p{N}_])наши(?![\\p{L}\\p{N}_])/giu, "мои"],
  [/(?<![\\p{L}\\p{N}_])наших(?![\\p{L}\\p{N}_])/giu, "моих"],
  [/(?<![\\p{L}\\p{N}_])нашими(?![\\p{L}\\p{N}_])/giu, "моими"],
];

const EN_TO_MY: Array<[RegExp, string]> = [
  [/(?<![\\p{L}\\p{N}_])I am(?![\\p{L}\\p{N}_])/gu, "we are"],
  [/(?<![\\p{L}\\p{N}_])I'm(?![\\p{L}\\p{N}_])/gu, "we're"],
  [/(?<![\\p{L}\\p{N}_])I was(?![\\p{L}\\p{N}_])/gu, "we were"],
  [/(?<![\\p{L}\\p{N}_])I've(?![\\p{L}\\p{N}_])/gu, "we've"],
  [/(?<![\\p{L}\\p{N}_])I'll(?![\\p{L}\\p{N}_])/gu, "we'll"],
  [/(?<![\\p{L}\\p{N}_])I'd(?![\\p{L}\\p{N}_])/gu, "we'd"],
  [/(?<![\\p{L}\\p{N}_])I(?![\\p{L}\\p{N}_])/gu, "we"],
  [/(?<![\\p{L}\\p{N}_])myself(?![\\p{L}\\p{N}_])/giu, "ourselves"],
  [/(?<![\\p{L}\\p{N}_])mine(?![\\p{L}\\p{N}_])/giu, "ours"],
  [/(?<![\\p{L}\\p{N}_])my(?![\\p{L}\\p{N}_])/giu, "our"],
  [/(?<![\\p{L}\\p{N}_])me(?![\\p{L}\\p{N}_])/giu, "us"],
];

const EN_TO_YA: Array<[RegExp, string]> = [
  [/(?<![\\p{L}\\p{N}_])we are(?![\\p{L}\\p{N}_])/giu, "I am"],
  [/(?<![\\p{L}\\p{N}_])we're(?![\\p{L}\\p{N}_])/giu, "I'm"],
  [/(?<![\\p{L}\\p{N}_])we were(?![\\p{L}\\p{N}_])/giu, "I was"],
  [/(?<![\\p{L}\\p{N}_])we've(?![\\p{L}\\p{N}_])/giu, "I've"],
  [/(?<![\\p{L}\\p{N}_])we'll(?![\\p{L}\\p{N}_])/giu, "I'll"],
  [/(?<![\\p{L}\\p{N}_])we'd(?![\\p{L}\\p{N}_])/giu, "I'd"],
  [/(?<![\\p{L}\\p{N}_])we(?![\\p{L}\\p{N}_])/giu, "I"],
  [/(?<![\\p{L}\\p{N}_])ourselves(?![\\p{L}\\p{N}_])/giu, "myself"],
  [/(?<![\\p{L}\\p{N}_])ours(?![\\p{L}\\p{N}_])/giu, "mine"],
  [/(?<![\\p{L}\\p{N}_])our(?![\\p{L}\\p{N}_])/giu, "my"],
  [/(?<![\\p{L}\\p{N}_])us(?![\\p{L}\\p{N}_])/giu, "me"],
];

function preserveCase(src: string, out: string): string {
  if (!src) return out;
  if (src[0] === src[0].toUpperCase() && src[0] !== src[0].toLowerCase()) {
    return out[0].toUpperCase() + out.slice(1);
  }
  return out;
}

/** Apply a replacement list to text nodes only (never inside HTML tags). */
function mapTextNodes(html: string, rules: Array<[RegExp, string]>): string {
  return html
    .split(/(<[^>]*>)/g)
    .map((chunk) => {
      if (chunk.startsWith("<")) return chunk;
      let out = chunk;
      for (const [re, to] of rules) {
        out = out.replace(re, (m) => preserveCase(m, to));
      }
      return out;
    })
    .join("");
}

function textOnly(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

/** Count remaining forbidden first-person forms for the requested voice. */
export function countNarrationViolations(
  html: string,
  person: NarrationPerson,
  lang: "ru" | "en",
): number {
  const text = textOnly(html || "");
  const re = lang === "ru"
    ? (person === "my"
      ? /(?<![\\p{L}\\p{N}_])(я|меня|мне|мной|мною|мой|моя|моё|мое|мои|моего|моей|моему|моим|моих|моими|мою|моём|моем)(?![\\p{L}\\p{N}_])/giu
      : /(?<![\\p{L}\\p{N}_])(мы|нас|нам|нами|наш|наша|наше|наши|нашего|нашей|нашему|нашим|наших|нашими|нашу|нашем)(?![\\p{L}\\p{N}_])/giu)
    : (person === "my"
      ? /(?<![\\p{L}\\p{N}_])(I|I'm|I've|I'll|I'd|my|me|mine|myself)(?![\\p{L}\\p{N}_])/gu
      : /(?<![\\p{L}\\p{N}_])(we|we're|we've|we'll|we'd|our|us|ours|ourselves)(?![\\p{L}\\p{N}_])/giu);
  return (text.match(re) || []).length;
}

/** Grammar-safe part of the fix (no verb agreement involved). */
export function applySafeNarrationFixes(
  html: string,
  person: NarrationPerson,
  lang: "ru" | "en",
): string {
  if (!html) return html;
  if (lang === "ru") {
    return mapTextNodes(html, person === "my" ? RU_SAFE_TO_MY : RU_SAFE_TO_YA);
  }
  return mapTextNodes(html, person === "my" ? EN_TO_MY : EN_TO_YA);
}

function integrityOk(before: string, after: string): boolean {
  if (!after || after.length < 200) return false;
  const wb = before.replace(/\s+/g, " ").split(" ").length;
  const wa = after.replace(/\s+/g, " ").split(" ").length;
  if (wa < wb * 0.75 || wa > wb * 1.35) return false;
  const hb = (before.match(/<h[1-3][^>]*>/gi) || []).length;
  const ha = (after.match(/<h[1-3][^>]*>/gi) || []).length;
  return hb === ha;
}

function stripFences(s: string): string {
  return s.replace(/^\s*```(?:html|markdown|md)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

export interface NarrationEnforceResult {
  content: string;
  applied: boolean;
  before: number;
  after: number;
  usedLlm: boolean;
}

/**
 * Bring the whole article to a single narrative person.
 * Safe regex first, then one LLM pass when subject pronouns remain wrong.
 */
export async function enforceNarrationVoice(
  html: string,
  person: NarrationPerson | null | undefined,
  lang: "ru" | "en",
  openRouterKey?: string | null,
): Promise<NarrationEnforceResult> {
  const before = person ? countNarrationViolations(html, person, lang) : 0;
  if (!person || !html || before === 0) {
    return { content: html, applied: false, before, after: before, usedLlm: false };
  }

  let out = applySafeNarrationFixes(html, person, lang);
  let after = countNarrationViolations(out, person, lang);
  let usedLlm = false;

  if (after > 0 && openRouterKey) {
    const target = person === "my"
      ? (lang === "ru" ? "первое лицо множественного числа (мы, наш, нам)" : "first person plural (we, our, us)")
      : (lang === "ru" ? "первое лицо единственного числа (я, мой, мне)" : "first person singular (I, my, me)");
    const banned = person === "my"
      ? (lang === "ru" ? "я, мой, меня, мне, мной" : "I, my, me, mine, myself")
      : (lang === "ru" ? "мы, наш, нас, нам, нами" : "we, our, us, ours, ourselves");
    const system = lang === "ru"
      ? "Ты редактор. Приводишь текст к единому лицу повествования. Меняешь ТОЛЬКО местоимения и согласование глаголов с ними. Не меняешь факты, цифры, ссылки, HTML-теги, заголовки и структуру. Возвращаешь только итоговый HTML без markdown-обёрток."
      : "You are an editor. Unify the narrative person. Change ONLY pronouns and the verb agreement tied to them. Do not change facts, numbers, links, HTML tags, headings or structure. Return only the final HTML, no markdown wrappers.";
    const user = lang === "ru"
      ? `Требуемое лицо: ${target}. Запрещённые формы: ${banned}. Замени их с корректным согласованием глаголов (например "я считаю" -> "мы считаем").\n\n---\n${out}`
      : `Required voice: ${target}. Forbidden forms: ${banned}. Replace them with correct verb agreement.\n\n---\n${out}`;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90_000);
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://seo-modul.pro",
          "X-Title": "SEO-Modul narration voice",
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: "anthropic/claude-sonnet-4",
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      clearTimeout(timer);
      if (resp.ok) {
        const j = await resp.json();
        const cand = stripFences(String(j?.choices?.[0]?.message?.content || ""));
        if (integrityOk(out, cand)) {
          const candViolations = countNarrationViolations(cand, person, lang);
          if (candViolations < after) {
            out = cand;
            after = candViolations;
            usedLlm = true;
          }
        }
      }
    } catch (e) {
      console.warn("[narration-voice] llm pass failed:", (e as Error)?.message);
    }
  }

  return { content: out, applied: out !== html, before, after, usedLlm };
}
