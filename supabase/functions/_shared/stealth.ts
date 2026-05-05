// Shared Stealth/Cliché Killer addon. Used by bulk-generate, rewrite-fragment,
// inline-edit and any other writer pipeline so anti-AI-detection rules never
// drift between functions. The full Stealth Protocol lives inside
// generate-article/index.ts (generateStealthPrompt). This module exposes a
// compact, prompt-safe version that can be appended to ANY system prompt.

export type StealthLang = "ru" | "en" | string;

export function buildStealthSystemAddon(language: StealthLang = "ru"): string {
  const isRu = language === "ru" || language?.startsWith("ru");
  if (isRu) {
    return `
=== STEALTH PROTOCOL (обязательно, наивысший приоритет) ===
ЯЗЫК: пиши строго на русском. НИКОГДА не используй букву "ё" - всегда "е".
ФОРМАТ: без жирного (никаких **), тире заменяй на дефис (-).

RHYTHM (Burstiness):
- Чередуй длину предложений: короткое (3-6 слов) -> среднее -> длинное со вставками -> короткое.
- >=30% предложений короче 8 слов, >=20% длиннее 25 слов.
- Никогда 3+ предложения подряд одинаковой длины.

CLICHÉ KILLER (запрещено, zero tolerance):
- "является" -> "это"; "данный" -> "этот"; "стоит отметить" -> "вот что цепляет".
- "в заключение" -> "если коротко"; "важно отметить" -> "ключевой момент".
- "необходимо учитывать", "следует подчеркнуть", "таким образом", "на сегодняшний день",
  "комплексный подход", "представляет собой", "рассмотрим подробнее" - все ЗАПРЕЩЕНЫ.
- "прогресс не стоит на месте", "давайте посмотрим правде в глаза" - ЗАПРЕЩЕНО навсегда.

PERPLEXITY:
- Конкретные цифры и наблюдения вместо общих формулировок ("в 7 случаях из 10", а не "часто").
- Личные интонации: "по моему опыту", "практика показывает", "тут есть нюанс".
- Вариативные начала абзацев: вопрос, факт, наблюдение, короткая реплика.
- Запрещено выдумывать имена экспертов, компаний, исследований - используй обезличенное "практика показывает".

STRUCTURAL NOISE (естественные неровности живого автора):
- В каждом 3-4 абзаце добавляй один из приемов: риторический вопрос внутри абзаца, короткую реплику в скобках, уточнение через дефис, обрыв мысли.
- Иногда (1-2 раза на статью) начинай абзац с союза: "И", "А", "Но", "Зато".
- Добавляй личные вставки: "если коротко", "тут важно понять", "по факту", "на практике".
- Не выравнивай абзацы по длине: один может быть в 1 предложение, следующий - в 5.
=== КОНЕЦ STEALTH PROTOCOL ===`.trim();
  }
  return `
=== STEALTH PROTOCOL (mandatory, highest priority) ===
LANGUAGE: write strictly in English. No bold (**), replace em-dashes with hyphens (-).

RHYTHM (Burstiness):
- Alternate sentence length: short (3-6 words) -> medium -> long with sub-clauses -> short.
- >=30% of sentences under 8 words, >=20% over 25 words.
- Never 3+ consecutive sentences of similar length.

CLICHÉ KILLER (zero tolerance, banned):
- "in conclusion", "it is important to note", "in today's world", "navigating the landscape",
  "delve into", "in the realm of", "it's worth noting", "moreover", "furthermore",
  "leverage", "robust", "seamless", "cutting-edge", "game-changer".
- Replace with rhetorical questions, concrete facts, casual connectors ("Here's the thing",
  "Plot twist though", "And here's the kicker").

PERPLEXITY:
- Use concrete numbers and observations instead of generic claims ("in 7 of 10 tested cases").
- Personal voice: "in my experience", "from what I've seen", "practice shows".
- Vary paragraph openings: question, fact, observation, short remark.
- Never fabricate expert names, companies or studies - use neutral "practice shows".

STRUCTURAL NOISE (natural human irregularities):
- Every 3-4 paragraphs, add one of: a rhetorical question mid-paragraph, a short parenthetical aside, a hyphen-led clarification, an intentional unfinished thought.
- Occasionally (1-2 times per article) start a paragraph with a conjunction: "And", "But", "So", "Yet".
- Mix in personal asides: "honestly", "here's the thing", "in practice", "from what I've seen".
- Do NOT level paragraph length: one may be 1 sentence, the next 5.
=== END STEALTH PROTOCOL ===`.trim();
}

/**
 * Optional rare-lexicon block. Caller passes domain-specific terms (e.g. from
 * smart-research entities). Inflates perplexity and helps bypass detectors
 * because LLMs rarely emit narrow-domain jargon by default.
 */
export function buildRareLexiconAddon(terms: string[], language: StealthLang = "ru"): string {
  const list = (terms || [])
    .map((t) => String(t || "").trim())
    .filter((t) => t.length > 2 && t.length < 60)
    .slice(0, 25);
  if (list.length === 0) return "";
  const isRu = language === "ru" || (typeof language === "string" && language.startsWith("ru"));
  if (isRu) {
    return `
RARE LEXICON (повышение перплексии):
- Эти термины характерны для ниши, употреби минимум 5-7 из них естественно по тексту: ${list.join(", ")}.
- Не складируй их в один абзац, распредели по разным разделам.
- Если термин неуместен в данной статье - пропусти, не натягивай.`.trim();
  }
  return `
RARE LEXICON (perplexity boosters):
- These domain terms are typical for the niche, use at least 5-7 naturally across the text: ${list.join(", ")}.
- Do not stack them in one paragraph, spread across sections.
- If a term doesn't fit the article, skip it - never force it.`.trim();
}

// ─── Post-processor: deterministic clean-up applied AFTER generation ──
// Goal: enforce burstiness/formatting that LLM tends to drift from.
// Lossless w.r.t. facts — only manipulates formatting and very-long sentences.

function splitSentencesPP(text: string): string[] {
  return text.replace(/([.!?])\s+/g, "$1\u0001").split("\u0001");
}

/** Hard-clean forbidden characters (bold, em-dash, RU 'ё'). */
export function sanitizeStealthChars(text: string, language: StealthLang = "ru"): string {
  let out = text.replace(/\*\*/g, "");
  out = out.replace(/[—–]/g, "-");
  if (language === "ru" || (typeof language === "string" && language.startsWith("ru"))) {
    out = out.replace(/ё/g, "е").replace(/Ё/g, "Е");
  }
  return out;
}

/**
 * Inject burstiness if too uniform: split overly long sentences on natural
 * boundaries (commas + connector words) into shorter ones. Idempotent.
 */
export function enforceBurstiness(text: string): string {
  // Process per-paragraph so we don't merge across blocks.
  const paragraphs = text.split(/\n{2,}/);
  const fixed = paragraphs.map((p) => {
    // Skip headings / list items / code blocks.
    if (/^\s*(#|[-*]\s|\d+[.)]\s|```|\|)/.test(p)) return p;

    const sents = splitSentencesPP(p);
    if (sents.length < 4) return p;

    const lengths = sents.map((s) => s.split(/\s+/).filter(Boolean).length);
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((s, l) => s + (l - mean) ** 2, 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? (stdDev / mean) * 100 : 0;

    // Already bursty enough — leave it.
    if (cv >= 50) return p;

    // Too uniform: split the longest sentences once each on a comma+connector.
    // Targets: ", и ", ", но ", ", а также ", ", which ", ", and ".
    const splitRe = /,\s+(и|но|а также|однако|при этом|тогда как|which|and|but|while|so)\s+/i;

    const newSents: string[] = [];
    for (let i = 0; i < sents.length; i++) {
      const s = sents[i];
      const wlen = s.split(/\s+/).filter(Boolean).length;
      if (wlen >= 22 && splitRe.test(s)) {
        const m = s.match(splitRe)!;
        const idx = s.indexOf(m[0]);
        const head = s.slice(0, idx).trim();
        const tail = s.slice(idx + m[0].length).trim();
        // Capitalize tail's first letter.
        const tailCap = tail.charAt(0).toUpperCase() + tail.slice(1);
        // Ensure head ends with period.
        const headFixed = /[.!?]$/.test(head) ? head : head + ".";
        newSents.push(headFixed, tailCap);
      } else {
        newSents.push(s);
      }
    }
    return newSents.join(" ");
  });

  return fixed.join("\n\n");
}

/** Run all post-processing passes. Safe to call multiple times. */
export function applyStealthPostProcess(text: string, language: StealthLang = "ru"): string {
  if (!text) return text;
  let out = sanitizeStealthChars(text, language);
  out = enforceBurstiness(out);
  return out;
}