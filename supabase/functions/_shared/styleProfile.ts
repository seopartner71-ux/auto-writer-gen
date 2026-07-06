// StyleProfile — единый источник правды по стилю текста.
//
// Persona Engine (syntax_preset), antiTurgenevAddon (HARD_RULES + BANLIST)
// и пост-валидаторы (sentenceStructure, cancellary, keywordFrequency)
// ДОЛЖНЫ читать пороги отсюда, а не каждый из своего набора чисел.
// Это убирает три слоя противоречий: Persona хочет рваный синтаксис,
// antiTurgenev требует 18-30 слов, валидатор ругается на 9-словные
// предложения. С StyleProfile один пресет = один набор порогов.

export type SyntaxPreset =
  | "practitioner"
  | "academic"
  | "blogger"
  | "journalist"
  | "provocateur"
  | "default";

export interface StyleProfile {
  preset: SyntaxPreset;
  /** Ритм предложений (для sentenceStructure и для system-промта). */
  sentence_avg_min: number;
  sentence_avg_max: number;
  short_word_max: number;   // строго < N слов → короткое
  long_word_min: number;    // строго > N слов → длинное
  max_short_ratio: number;  // 0..1
  max_short_run: number;    // максимально допустимая серия коротких подряд
  /** Разрешены ли рубленые фрагменты (для блогера/провокатора). */
  allow_fragments: boolean;
  /** Жёсткость к канцеляризмам и штампам. */
  cliche_strictness: "soft" | "hard";
  /** Максимум вхождений seed-ключа на один H2-блок. */
  max_seed_per_h2: number;
  /** Максимум вхождений значимого слова на 1000 знаков. */
  max_word_per_1k: number;
}

const PROFILES: Record<SyntaxPreset, StyleProfile> = {
  default: {
    preset: "default",
    sentence_avg_min: 18, sentence_avg_max: 30,
    short_word_max: 8, long_word_min: 25,
    max_short_ratio: 0.25, max_short_run: 2,
    allow_fragments: false, cliche_strictness: "hard",
    max_seed_per_h2: 1, max_word_per_1k: 2,
  },
  practitioner: {
    preset: "practitioner",
    sentence_avg_min: 10, sentence_avg_max: 18,
    short_word_max: 6, long_word_min: 22,
    max_short_ratio: 0.40, max_short_run: 3,
    allow_fragments: false, cliche_strictness: "hard",
    max_seed_per_h2: 1, max_word_per_1k: 2,
  },
  academic: {
    preset: "academic",
    sentence_avg_min: 20, sentence_avg_max: 30,
    short_word_max: 8, long_word_min: 28,
    max_short_ratio: 0.15, max_short_run: 1,
    allow_fragments: false, cliche_strictness: "hard",
    max_seed_per_h2: 1, max_word_per_1k: 2,
  },
  journalist: {
    preset: "journalist",
    sentence_avg_min: 12, sentence_avg_max: 20,
    short_word_max: 7, long_word_min: 24,
    max_short_ratio: 0.35, max_short_run: 3,
    allow_fragments: false, cliche_strictness: "hard",
    max_seed_per_h2: 1, max_word_per_1k: 2,
  },
  blogger: {
    preset: "blogger",
    sentence_avg_min: 8, sentence_avg_max: 14,
    short_word_max: 5, long_word_min: 20,
    max_short_ratio: 0.55, max_short_run: 4,
    allow_fragments: true, cliche_strictness: "soft",
    max_seed_per_h2: 2, max_word_per_1k: 3,
  },
  provocateur: {
    preset: "provocateur",
    sentence_avg_min: 8, sentence_avg_max: 18,
    short_word_max: 5, long_word_min: 22,
    max_short_ratio: 0.50, max_short_run: 4,
    allow_fragments: true, cliche_strictness: "soft",
    max_seed_per_h2: 2, max_word_per_1k: 3,
  },
};

export const DEFAULT_STYLE_PROFILE: StyleProfile = PROFILES.default;

export function getStyleProfile(preset: string | null | undefined): StyleProfile {
  const key = String(preset || "").toLowerCase() as SyntaxPreset;
  return PROFILES[key] || PROFILES.default;
}

/** Опции для sentenceStructure.analyzeSentenceStructure. */
export function sentenceOptionsFromStyleProfile(p: StyleProfile) {
  return {
    shortMax: p.short_word_max,
    longMin: p.long_word_min,
    avgMin: p.sentence_avg_min,
    avgMax: p.sentence_avg_max,
    maxShortRatio: p.max_short_ratio,
    maxShortRun: p.max_short_run,
  };
}

/** Опции для keywordFrequencyGuard. */
export function keywordOptionsFromStyleProfile(p: StyleProfile) {
  return {
    maxWordPer1k: p.max_word_per_1k,
    maxSeedPerH2: p.max_seed_per_h2,
  };
}

/** Опции для cancellaryGuard. */
export function cancellaryOptionsFromStyleProfile(p: StyleProfile) {
  return { strictness: p.cliche_strictness };
}