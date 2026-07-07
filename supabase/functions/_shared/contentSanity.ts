// Cheap deterministic sanity check for generated article bodies.
// Catches the "token salad" degradation mode (Opus tail rot, mixed alphabets,
// impossible letter clusters) BEFORE the text is saved / handed to judges /
// pushed into the improve cycle.
//
// Scans the FULL text — NEVER samples. Pure function, no I/O.

export interface SanityReport {
  corrupted: boolean;
  reasons: string[];
  metrics: {
    length: number;
    word_count: number;
    foreign_script_ratio: number;      // share of chars in non-Latin/non-Cyrillic scripts
    foreign_script_samples: string[];  // up to 5 offending words
    novowel_word_ratio: number;        // Cyrillic long words without a vowel
    novowel_word_samples: string[];
    long_consonant_run_ratio: number;  // Cyrillic words with 5+ consecutive consonants
    long_consonant_samples: string[];
    unterminated_run_max: number;      // longest run without . ! ? … \n
  };
  thresholds: {
    foreign_script_ratio: number;
    novowel_word_ratio: number;
    long_consonant_run_ratio: number;
    unterminated_run_max: number;
  };
}

// Unicode ranges we consider "foreign" (not expected in RU/EN articles).
// Deliberately excludes Latin, Cyrillic, digits, punctuation, whitespace,
// common typographic marks and math/currency symbols.
const FOREIGN_SCRIPT_CLASS = "\\u0370-\\u03FF\\u0530-\\u058F\\u0590-\\u05FF\\u0600-\\u06FF\\u0700-\\u074F\\u0750-\\u077F\\u0780-\\u07BF\\u0900-\\u097F\\u0980-\\u09FF\\u0A00-\\u0A7F\\u0A80-\\u0AFF\\u0B00-\\u0B7F\\u0B80-\\u0BFF\\u0C00-\\u0C7F\\u0C80-\\u0CFF\\u0D00-\\u0D7F\\u0D80-\\u0DFF\\u0E00-\\u0E7F\\u0E80-\\u0EFF\\u0F00-\\u0FFF\\u1000-\\u109F\\u10A0-\\u10FF\\u1200-\\u137F\\u3040-\\u309F\\u30A0-\\u30FF\\u3130-\\u318F\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uA960-\\uA97F\\uAC00-\\uD7AF";
const FOREIGN_SCRIPT_RE_G = new RegExp(`[${FOREIGN_SCRIPT_CLASS}]`, "g");
const FOREIGN_SCRIPT_RE = new RegExp(`[${FOREIGN_SCRIPT_CLASS}]`);

const CYR_LETTER_RE = /[а-яёА-ЯЁ]/;
const CYR_VOWELS = "аеёиоуыэюяАЕЁИОУЫЭЮЯ";

function findLongestUnterminatedRun(text: string): number {
  // Longest span of chars without a sentence terminator or newline.
  let max = 0;
  let cur = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    // .(46) !(33) ?(63) …(8230) \n(10) \r(13)
    if (ch === 46 || ch === 33 || ch === 63 || ch === 8230 || ch === 10 || ch === 13) {
      if (cur > max) max = cur;
      cur = 0;
    } else {
      cur++;
    }
  }
  if (cur > max) max = cur;
  return max;
}

export function analyzeSanity(plain: string): SanityReport {
  const thresholds = {
    foreign_script_ratio: 0.003,   // 0.3%
    novowel_word_ratio: 0.02,      // 2%
    long_consonant_run_ratio: 0.01,// 1%
    unterminated_run_max: 3000,
  };
  const text = String(plain || "");
  const length = text.length;

  // Foreign scripts.
  const foreignMatches = text.match(FOREIGN_SCRIPT_RE_G) || [];
  const foreign_script_ratio = length ? foreignMatches.length / length : 0;
  const foreign_script_samples: string[] = [];
  if (foreignMatches.length) {
    // Extract up to 5 offending word snippets.
    const words = text.split(/\s+/);
    for (const w of words) {
      if (FOREIGN_SCRIPT_RE.test(w)) {
        foreign_script_samples.push(w.slice(0, 40));
        if (foreign_script_samples.length >= 5) break;
      }
    }
  }

  // Cyrillic word analysis.
  const tokens = text.match(/[A-Za-zа-яёА-ЯЁ-]{4,}/g) || [];
  let cyrLong = 0;
  let noVowel = 0;
  let longConsonantRun = 0;
  const novowel_word_samples: string[] = [];
  const long_consonant_samples: string[] = [];
  for (const t of tokens) {
    if (!CYR_LETTER_RE.test(t)) continue;
    if (t.length < 5) continue;
    cyrLong++;
    let hasVowel = false;
    let run = 0, maxRun = 0;
    for (const ch of t) {
      const isCyr = /[а-яёА-ЯЁ]/.test(ch);
      if (!isCyr) { run = 0; continue; }
      if (CYR_VOWELS.includes(ch)) { hasVowel = true; run = 0; }
      else { run++; if (run > maxRun) maxRun = run; }
    }
    if (!hasVowel) {
      noVowel++;
      if (novowel_word_samples.length < 5) novowel_word_samples.push(t);
    }
    if (maxRun >= 5) {
      longConsonantRun++;
      if (long_consonant_samples.length < 5) long_consonant_samples.push(t);
    }
  }
  const novowel_word_ratio = cyrLong ? noVowel / cyrLong : 0;
  const long_consonant_run_ratio = cyrLong ? longConsonantRun / cyrLong : 0;
  const unterminated_run_max = findLongestUnterminatedRun(text);

  const reasons: string[] = [];
  if (foreign_script_ratio > thresholds.foreign_script_ratio) {
    reasons.push(`foreign_script:${(foreign_script_ratio * 100).toFixed(2)}%`);
  }
  if (novowel_word_ratio > thresholds.novowel_word_ratio && noVowel >= 5) {
    reasons.push(`novowel_words:${(novowel_word_ratio * 100).toFixed(2)}%`);
  }
  if (long_consonant_run_ratio > thresholds.long_consonant_run_ratio && longConsonantRun >= 5) {
    reasons.push(`consonant_runs:${(long_consonant_run_ratio * 100).toFixed(2)}%`);
  }
  if (unterminated_run_max > thresholds.unterminated_run_max) {
    reasons.push(`unterminated_run:${unterminated_run_max}`);
  }

  return {
    corrupted: reasons.length > 0,
    reasons,
    metrics: {
      length,
      word_count: tokens.length,
      foreign_script_ratio,
      foreign_script_samples,
      novowel_word_ratio,
      novowel_word_samples,
      long_consonant_run_ratio,
      long_consonant_samples,
      unterminated_run_max,
    },
    thresholds,
  };
}