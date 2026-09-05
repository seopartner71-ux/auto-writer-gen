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
  [/\bменя\b/gi, "нас"],
  [/\bмне\b/gi, "нам"],
  [/\bмной\b/gi, "нами"],
  [/\bмною\b/gi, "нами"],
  [/\bмой\b/gi, "наш"],
  [/\bмоего\b/gi, "нашего"],
  [/\bмоему\b/gi, "нашему"],
  [/\bмоим\b/gi, "нашим"],
  [/\bмоём\b/gi, "нашем"],
  [/\bмоем\b/gi, "нашем"],
  [/\bмоя\b/gi, "наша"],
  [/\bмоей\b/gi, "нашей"],
  [/\bмою\b/gi, "нашу"],
  [/\bмоё\b/gi, "наше"],
  [/\bмое\b/gi, "наше"],
  [/\bмои\b/gi, "наши"],
  [/\bмоих\b/gi, "наших"],
  [/\bмоими\b/gi, "нашими"],
];

const RU_SAFE_TO_YA: Array<[RegExp, string]> = [
  [/\bнас\b/gi, "меня"],
  [/\bнам\b/gi, "мне"],
  [/\bнами\b/gi, "мной"],
  [/\bнаш\b/gi, "мой"],
  [/\bнашего\b/gi, "моего"],
  [/\bнашему\b/gi, "моему"],
  [/\bнашим\b/gi, "моим"],
  [/\bнашем\b/gi, "моём"],
  [/\bнаша\b/gi, "моя"],
  [/\bнашей\b/gi, "моей"],
  [/\bнашу\b/gi, "мою"],
  [/\bнаше\b/gi, "моё"],
  [/\bнаши\b/gi, "мои"],
  [/\bнаших\b/gi, "моих"],
  [/\bнашими\b/gi, "моими"],
];

const EN_TO_MY: Array<[RegExp, string]> = [
  [/\bI am\b/g, "we are"],
  [/\bI'm\b/g, "we're"],
  [/\bI was\b/g, "we were"],
  [/\bI've\b/g, "we've"],
  [/\bI'll\b/g, "we'll"],
  [/\bI'd\b/g, "we'd"],
  [/\bI\b/g, "we"],
  [/\bmyself\b/gi, "ourselves"],
  [/\bmine\b/gi, "ours"],
  [/\bmy\b/gi, "our"],
  [/\bme\b/gi, "us"],
];

const EN_TO_YA: Array<[RegExp, string]> = [
  [/\bwe are\b/gi, "I am"],
  [/\bwe're\b/gi, "I'm"],
  [/\bwe were\b/gi, "I was"],
  [/\bwe've\b/gi, "I've"],
  [/\bwe'll\b/gi, "I'll"],
  [/\bwe'd\b/gi, "I'd"],
  [/\bwe\b/gi, "I"],
  [/\bourselves\b/gi, "myself"],
  [/\bours\b/gi, "mine"],
  [/\bour\b/gi, "my"],
  [/\bus\b/gi, "me"],
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
      ? /\b(я|меня|мне|мной|мною|мой|моя|моё|мое|мои|моего|моей|моему|моим|моих|моими|мою|моём|моем)\b/gi
      : /\b(мы|нас|нам|нами|наш|наша|наше|наши|нашего|нашей|нашему|нашим|наших|нашими|нашу|нашем)\b/gi)
    : (person === "my"
      ? /\b(I|I'm|I've|I'll|I'd|my|me|mine|myself)\b/g
      : /\b(we|we're|we've|we'll|we'd|our|us|ours|ourselves)\b/gi);
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
