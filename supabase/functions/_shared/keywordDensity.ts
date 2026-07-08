// Keyword density counters.
// - `computeDensityExact`: legacy exact-form counter. Only counts wordforms
//   that literally match the seed keyword tokens. Underweights Russian text
//   heavily (a 33-occurrence phrase can read as 3 hits). Kept as the primary
//   metric for backward compatibility.
// - `computeDensityLemmatized`: light Russian stemmer + fleeting-vowel step
//   (котел↔котл-, песок↔песк-) that collapses common inflections. Added as
//   a companion metric so we can compare and, once validated, route on it.

const RU_SUFFIXES = [
  "иями","ыми","ими","ями","ами","ого","его","ому","ему","ых","их",
  "ов","ев","ей","ой","ый","ая","ое","ые","ие","ий","ым","ом","ем",
  "ах","ях","ам","ям",
  "а","я","о","е","ы","и","у","ю","ь",
].sort((a, b) => b.length - a.length);

const CONS = "бвгджзйклмнпрстфхцчшщ";
const FLEETING = new RegExp(`([${CONS}])[ео]([${CONS}])$`);

function normalize(w: string): string {
  return w.replace(/ё/g, "е").toLowerCase().replace(/[^а-яa-z0-9\-]/g, "");
}

/** Very light suffix-strip stemmer + fleeting-vowel step. Not a real lemmatizer,
 *  but good enough to fold common Russian inflections onto one stem. */
export function ruStem(word: string): string {
  let w = normalize(word);
  for (const s of RU_SUFFIXES) {
    if (w.length - s.length >= 3 && w.endsWith(s)) {
      w = w.slice(0, -s.length);
      break;
    }
  }
  if (w.length >= 4) {
    const w2 = w.replace(FLEETING, "$1$2");
    if (w2.length >= 3) w = w2;
  }
  return w;
}

export function computeDensityExact(plain: string, keyword: string): number {
  if (!keyword) return 0;
  const words = plain.toLowerCase().split(/\s+/).filter(Boolean);
  const total = words.length;
  if (!total) return 0;
  const kw = keyword.toLowerCase().trim();
  const kwWords = kw.split(/\s+/).filter(Boolean);
  let count = 0;
  if (kwWords.length === 1) {
    count = words.filter((w) => w.replace(/[^а-яa-zё0-9-]/gi, "") === kwWords[0]).length;
  } else {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    count = (plain.match(re) || []).length;
  }
  return Math.round(((count / total) * 100) * 100) / 100;
}

export interface LemmatizedDensity {
  density: number;      // percent, 2 decimals
  hits: number;
  totalWords: number;
  stems: string[];      // stems of the seed keyword tokens (for debugging)
}

/** N-gram stem-match density. Counts consecutive windows whose token stems all
 *  equal the corresponding seed keyword stems. Handles Russian wordforms that
 *  the exact counter misses (газовые котлы ≈ газовый котёл ≈ газового котла). */
export function computeDensityLemmatized(plain: string, keyword: string): LemmatizedDensity {
  const words = plain.toLowerCase().split(/\s+/).filter(Boolean);
  const totalWords = words.length;
  const kwWords = (keyword || "").trim().split(/\s+/).filter(Boolean);
  const kwStems = kwWords.map(ruStem).filter((s) => s.length > 0);
  if (!totalWords || !kwStems.length) {
    return { density: 0, hits: 0, totalWords, stems: kwStems };
  }
  const stems = words.map(ruStem);
  let hits = 0;
  const n = kwStems.length;
  for (let i = 0; i <= stems.length - n; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (stems[i + j] !== kwStems[j]) { ok = false; break; }
    }
    if (ok) hits++;
  }
  const density = Math.round(((hits / totalWords) * 100) * 100) / 100;
  return { density, hits, totalWords, stems: kwStems };
}