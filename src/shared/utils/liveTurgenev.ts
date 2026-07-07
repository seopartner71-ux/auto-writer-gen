/**
 * Lightweight client-side approximation of the Turgenev "risk score"
 * (0-10, lower is better). Used only as a LIVE indicator while streaming -
 * the authoritative score still comes from the server check after save.
 *
 * Five sub-scores (0-2 each) following Turgenev's categories:
 *   - water       (filler words, intros)
 *   - spam        (over-stuffed terms / repetition density)
 *   - repeats     (same word/bigram repeated across sentences)
 *   - style       (clichés, weasel words, "очень/просто/именно" abuse)
 *   - readability (avg sentence length, long words ratio)
 */

const WATER_RU = [
  "в принципе","в целом","как известно","следует отметить","на сегодняшний день",
  "в современном мире","в наше время","ни для кого не секрет","можно сказать",
  "хотелось бы","стоит отметить","как правило","в связи с этим","таким образом",
  "в данной статье","речь идет","на самом деле","по сути","в общем",
];
const STYLE_RU = [
  "очень","просто","именно","действительно","достаточно","весьма",
  "крайне","максимально","настоящий","уникальный","инновационный",
  "качественный","эффективный","профессиональный","современный",
];
const CLICHES_RU = [
  "ключ к успеху","в эпоху цифровизации","залог успеха","играет важную роль",
  "не секрет что","открывает новые возможности","выходит на новый уровень",
];

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-zа-яё0-9]+/gi) || []) as string[];
}

function countMatches(text: string, phrases: string[]): number {
  const lower = text.toLowerCase();
  let n = 0;
  for (const p of phrases) {
    const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const m = lower.match(re);
    if (m) n += m.length;
  }
  return n;
}

function bandWater(per1k: number): number {
  if (per1k < 1.5) return 0;
  if (per1k < 3) return 1;
  return 2;
}
function bandStyle(per1k: number): number {
  if (per1k < 4) return 0;
  if (per1k < 8) return 1;
  return 2;
}
function bandRepeats(ratio: number): number {
  // ratio = top-token frequency / total tokens (excluding stopwords)
  if (ratio < 0.025) return 0;
  if (ratio < 0.045) return 1;
  return 2;
}
function bandSpam(maxTermDensityPct: number): number {
  if (maxTermDensityPct < 2.5) return 0;
  if (maxTermDensityPct < 4) return 1;
  return 2;
}
function bandReadability(avgSentLen: number, longWordRatio: number): number {
  // Long sentences + many long words = harder to read
  let s = 0;
  if (avgSentLen > 22) s++;
  if (avgSentLen > 32) s++;
  if (longWordRatio > 0.22) s++;
  return Math.min(2, s);
}

const STOP = new Set([
  "и","в","не","на","что","с","по","а","но","как","к","из","за","для","от","до","или","о","у",
  "это","быть","есть","же","ли","бы","то","так","там","тут","вот","ещё","еще","уже",
]);

export interface LiveTurgenevResult {
  score: number;        // 0-10 (lower is better)
  band: "ok" | "warn" | "bad";
  details: { water: number; style: number; repeats: number; spam: number; readability: number };
  enoughText: boolean;
}

export function estimateTurgenev(text: string): LiveTurgenevResult {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/[#*_`>~]/g, " ");
  const tokens = tokenize(plain);
  const wordCount = tokens.length;
  if (wordCount < 80) {
    return {
      score: 0,
      band: "ok",
      details: { water: 0, style: 0, repeats: 0, spam: 0, readability: 0 },
      enoughText: false,
    };
  }

  const per1k = (n: number) => (n / wordCount) * 1000;

  // Water + style + cliché counts
  const waterCount = countMatches(plain, WATER_RU);
  const styleCount = countMatches(plain, STYLE_RU) + countMatches(plain, CLICHES_RU) * 2;

  // Repeats: most-frequent non-stopword token ratio
  const freq = new Map<string, number>();
  for (const t of tokens) {
    if (t.length < 4 || STOP.has(t)) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  let topTerm = "";
  let topCount = 0;
  for (const [k, v] of freq) {
    if (v > topCount) { topCount = v; topTerm = k; }
  }
  const repeatRatio = topCount / Math.max(1, wordCount);
  const spamDensityPct = repeatRatio * 100;

  // Sentences + readability
  const sentences = plain.split(/[.!?]+\s+/).filter((s) => s.trim().length > 0);
  const avgSentLen = sentences.length ? wordCount / sentences.length : wordCount;
  let longWords = 0;
  for (const t of tokens) if (t.length >= 12) longWords++;
  const longWordRatio = longWords / wordCount;

  const water = bandWater(per1k(waterCount));
  const style = bandStyle(per1k(styleCount));
  const repeats = bandRepeats(repeatRatio);
  const spam = bandSpam(spamDensityPct);
  const readability = bandReadability(avgSentLen, longWordRatio);

  const score = water + style + repeats + spam + readability; // 0..10
  const band: "ok" | "warn" | "bad" = score <= 3 ? "ok" : score <= 6 ? "warn" : "bad";

  return {
    score,
    band,
    details: { water, style, repeats, spam, readability },
    enoughText: true,
  };
}
