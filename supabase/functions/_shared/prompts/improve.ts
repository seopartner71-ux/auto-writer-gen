// improve.* prompt keys — humanize, sentence-structure, cancellary bans,
// russian keyword declension.
//
// Step 1 of migration: `improve.humanize.user` is registered with both RU
// (verbatim port of improve-article/index.ts:1126) and a NATIVE english
// version. Everything else is a stub-comment listing where it will come
// from — added in step 2 after tone approval.

import { registerPrompt } from "./index.ts";

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

Do not change facts, numbers, brand names, or URLs. Preserve every HTML tag (<h2>, <h3>, <p>, <ul>, <table>, <a>) exactly.

HTML:
${content}`);

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