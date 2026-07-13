// improve.* prompt keys — humanize, sentence-structure, cancellary bans,
// russian keyword declension.
//
// Step 1 of migration: `improve.humanize.user` is registered with both RU
// (verbatim port of improve-article/index.ts:1126) and a NATIVE english
// version. Everything else is a stub-comment listing where it will come
// from — added in step 2 after tone approval.

import { registerPrompt } from "./index.ts";
import { BANNED_PHRASES_EN } from "../validators/cancellaryGuard.ts";

/**
 * Build the EN `lexicalBanBlock` from the shared `BANNED_PHRASES_EN` source
 * used by cancellaryGuard. This keeps one canonical banlist for both the
 * pre-generation prompt and the post-generation validator — a new phrase
 * added to the validator is instantly enforced at prompt time too.
 *
 * Callers pass the result as the `lexicalBanBlock` param of the EN
 * `improve.humanize.user` prompt (mirror of what RU does inline in
 * improve-article/index.ts:927).
 */
export function buildEnLexicalBanBlock(): string {
  const list = BANNED_PHRASES_EN.map((p) => `- "${p}"`).join("\n");
  return `
BANNED CLICHÉS (remove entirely — replace with a concrete number, scenario, example, or observation from the article's own text, never a synonym):
${list}
Do NOT swap one banned phrase for another one on the list. If nothing concrete replaces it, cut the sentence.`;
}

export function registerImprove() {
  // ─────────────────────────────────────────────────────────────────────
  // improve.humanize.user — reference / exemplar prompt for the whole
  // migration. If you're reviewing tone, this is the one to read.
  // ─────────────────────────────────────────────────────────────────────

  // RU — verbatim from improve-article/index.ts:1126 (do NOT change wording
  // during the move; behavioural changes come in separate PRs).
  registerPrompt("improve.humanize.user", "ru", ({
    content,
    conservativeBlock = "",
    validatorContextBlock = "",
    judgeReasonsBlock = "",
    lexicalBanBlock = "",
    rhythmBlock = "",
  }) => `Перепиши текст так, чтобы он одновременно прошёл AI-детектор И Тургенев (Баден-Баден).${conservativeBlock}
${validatorContextBlock}
${judgeReasonsBlock}
${lexicalBanBlock}
${rhythmBlock}

ЦЕЛЬ AI-детектор:
- Живой ритм в рамках правил выше — НЕ телеграфный стиль.
- Разговорные вставки: "на практике", "вот что важно", "и тут начинается интересное" — точечно, а не в каждом абзаце.
- Разнообразие начал абзацев.

ЦЕЛЬ Тургенев (НЕ нарушать при гуманизации):
- Не использовать канцелярит: "является", "осуществляет", "в целях", "в рамках", "на сегодняшний день", "в настоящее время".
- Не использовать воду: "следует отметить", "стоит сказать", "как известно", "не секрет что".
- Если фраза длиннее 4 слов повторяется более 2 раз - перефразируй.

Не меняй факты, цифры, бренды. Сохрани все HTML-теги (<h2>, <h3>, <p>, <ul>, <table>, <a>).

HTML:
${content}`);

  // EN — NATIVE humanize prompt. Same intent (defeat AI-detectors, keep the
  // text editable-by-human), but russian-specific constraints are dropped:
  //   • no Turgenev / Baden-Baden (russian tooling — no equivalent in EN)
  //   • no russian канцелярит / вода lists
  // The EN cliché ban is delegated to the english-side lexicalBanBlock the
  // caller builds from BANNED_PHRASES_EN in cancellaryGuard.ts.
  registerPrompt("improve.humanize.user", "en", ({
    content,
    conservativeBlock = "",
    validatorContextBlock = "",
    judgeReasonsBlock = "",
    lexicalBanBlock = "",
    rhythmBlock = "",
  }) => `Rewrite the HTML so it reads like a human draft and slips past AI-detectors — without turning into a checklist of "human-sounding" tics.${conservativeBlock}
${validatorContextBlock}
${judgeReasonsBlock}
${lexicalBanBlock}
${rhythmBlock}

ANTI-DETECTOR GOAL:
- Uneven rhythm within the rules above — no telegraph-style staccato, no metronome cadence either.
- Sparingly drop conversational asides ("in practice", "here's the part that matters", "and this is where it gets interesting") — a couple across the whole article, not one per paragraph.
- Vary the way paragraphs open. Do not start three paragraphs in a row with the same construction.

CLICHÉ / FILLER GUARD (do not violate while humanizing):
- No LLM tells: "here's the kicker", "let that sink in", "game-changer", "let's dive in", "in today's fast-paced world", "at the end of the day".
- No empty hedges: "it's worth noting", "it should be mentioned", "as is well known", "needless to say".
- If a phrase longer than 4 words repeats more than twice — rephrase it.

ANONYMOUS-AUTHORITY BAN (fake E-E-A-T — highest priority):
- No unattributed appeals to experts or practice: "experts say", "specialists note", "practice shows", "studies show", "research suggests", "industry insiders", "many professionals agree", "it is widely known", "sources indicate".
- Every claim of authority needs a named source (person, company, publication, dataset) OR must be rewritten as a first-person observation ("in my last three projects…", "on the jobs I've run this year…"). If neither is available, delete the sentence.
- Do NOT introduce new "experts" or citations that were not already in the source HTML.

NUMERIC CONSISTENCY (must survive the rewrite unchanged):
- Every number, unit, currency, percentage, date, range, and count that appears in the source HTML must appear in the output with the exact same value. Do not round, convert units, "clean up", or restate figures differently in intro vs. FAQ vs. body.
- If the source says "5 mistakes" in the H1 and lists 5 items, the output keeps 5 in both places. Cross-check H1/H2/FAQ counts against the actual list length before finishing.
- Do not invent statistics that were not in the source.

NO KEYWORD-STUFFING / NOMINATIVE PILE-UPS:
- Do not produce nominative chains of 4+ nouns/modifiers in a row (e.g. "chlorine levels pool Arizona summer", "best crm software small business 2026 comparison"). Rewrite as a natural clause with a verb: "chlorine drifts high in Phoenix pools by mid-July".
- The target keyword may appear in H1 once and 2-3 times across the body, always inside a grammatical sentence — never as a bare noun phrase heading a paragraph.
- Do not repeat the exact keyword in two consecutive sentences.

PUNCTUATION — EM-DASH DISCIPLINE (ABSOLUTE BAN, strong AI tell):
- ZERO em-dashes ("—", U+2014) and ZERO en-dashes ("–", U+2013) anywhere in the article. No exceptions.
- Wherever a dash-like separator is needed, use the plain hyphen-minus "-" (U+002D) or restructure with commas, periods, colons, or parentheses.
- Do NOT use "--" or " -- " as a substitute for an em-dash. Just a single hyphen "-".

Do not change facts, numbers, brand names, or URLs. Preserve every HTML tag (<h2>, <h3>, <p>, <ul>, <table>, <a>) exactly.

HTML:
${content}`);

  registerPrompt("improve.humanize.system", "ru", () =>
    "Ты редактор-человек. Переписываешь HTML-контент сохраняя ВСЕ факты, цифры, бренды, ссылки, теги. Возвращаешь только итоговый HTML без markdown-оберток.");

  registerPrompt("improve.humanize.system", "en", () =>
    "You are a human editor. Rewrite HTML while preserving every fact, number, brand, URL, and tag. Keep the article in English. Do not translate it into Russian. Return only the final HTML, without markdown fences.");

  // ─────────────────────────────────────────────────────────────────────
  // Reserved keys — registered in step 2 after tone approval.
  //
  //   improve.humanize.system             ← improve-article/index.ts:1122
  //   improve.sentence_structure.user     ← improve-article/index.ts:1433
  //   improve.cancellary.user             ← improve-article/index.ts:1529
  //   improve.keyword_declension.user     ← improve-article/index.ts:1653
  //                                         (RU-only — see RESTRICTED_LANGS,
  //                                          upstream must skip the pass for
  //                                          non-ru articles)
  // ─────────────────────────────────────────────────────────────────────
}