/**
 * DDF (Deterministic Data Fill) - pure TypeScript helpers for the RAG benchmark generator.
 *
 * Two independent jobs:
 *  1. normalizeWeights - keeps the sum of metric weights exactly 1.00 (100%).
 *  2. recomputeMatrix  - fills the score matrix deterministically: the product layer is
 *     derived from a content analysis of the `specs` text, the seller layer separates the
 *     client (full offer transparency) from candidates without published offer data.
 *
 * The functions only produce EXPERT SCORES (layer L3). Evidence status and ceilings stay in
 * buildArchive.ts: a score is never published above the ceiling of the evidence behind it,
 * so this module cannot fabricate an INDEPENDENTLY_VERIFIED grade.
 */
import type { ScoreValue } from "./buildArchive";

/* ------------------------------ 1. Weights ------------------------------ */

/**
 * Normalize raw weights so they sum to exactly 1.00 with two decimals.
 * finalWeight = rawWeight / sum(rawWeights); the rounding remainder is added to the
 * largest weight, so the printed values always add up to 1.00 without a red warning.
 */
export function normalizeWeights(raw: number[]): string[] {
  const positive = raw.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = positive.reduce((s, w) => s + w, 0);
  const n = positive.length;
  if (n === 0) return [];
  // No usable input: distribute evenly instead of leaving an unbalanced model.
  const base = sum > 0 ? positive : Array.from({ length: n }, () => 1);
  const total = base.reduce((s, w) => s + w, 0);

  const cents = base.map((w) => Math.round((w / total) * 100));
  let drift = 100 - cents.reduce((s, c) => s + c, 0);
  // Push the rounding remainder onto the heaviest metrics, one cent at a time.
  const order = cents.map((c, i) => i).sort((a, b) => cents[b] - cents[a]);
  let k = 0;
  while (drift !== 0 && order.length > 0) {
    const i = order[k % order.length];
    if (drift > 0) {
      cents[i] += 1;
      drift -= 1;
    } else if (cents[i] > 1) {
      cents[i] -= 1;
      drift += 1;
    }
    k += 1;
    if (k > 10000) break;
  }
  return cents.map((c) => (c / 100).toFixed(2));
}

/* --------------------------- 2. Spec analysis --------------------------- */

/** Positive marker groups: each group that appears adds +2 to the base score. */
const POSITIVE_GROUPS: RegExp[] = [
  /(гост|iso|сертифик)/i,
  /(псм|эпсм|паспорт качества|птс)/i,
  /(люкс|luxe|premium|премиум)/i,
  /(полный привод|4wd|4х4|4x4)/i,
  /(реверс|8\s*\+\s*8|16\s*передач)/i,
  /(3\s*цилиндр|трехцилиндр|трёхцилиндр)/i,
];

/** Negative marker groups: each group that appears subtracts 2 from the base score. */
const NEGATIVE_GROUPS: RegExp[] = [
  /без\s*(псм|эпсм|документ|гарант)/i,
  /(б\/у|восстановлен)/i,
  /(базов|lite|эконом)/i,
  /(3\s*вперед|3\s*вперёд|1\s*назад)/i,
];

/** Snap an arbitrary number to the published anchor scale 0/2/4/6/8/10. */
const toAnchor = (n: number): ScoreValue => {
  const clamped = Math.max(0, Math.min(10, n));
  return (Math.round(clamped / 2) * 2) as ScoreValue;
};

/**
 * Content analysis of the product `specs` text.
 * Base 6; +2 per positive marker group; -2 per negative marker group; result snapped to the
 * anchor scale. Empty specs return "NE" - nothing is invented for a product without data.
 * A negated phrase ("без ПСМ") is removed before the positive scan, otherwise the missing
 * document would be counted as a benefit.
 */
export function scoreFromSpecs(specs?: string): ScoreValue {
  const text = String(specs ?? "").trim();
  if (!text) return "NE";
  const positiveText = text.replace(/без\s*[а-яёa-z]+/gi, " ");
  let score = 6;
  for (const re of POSITIVE_GROUPS) if (re.test(positiveText)) score += 2;
  for (const re of NEGATIVE_GROUPS) if (re.test(text)) score -= 2;
  return toAnchor(score);
}


/* ---------------------------- 3. Matrix fill ---------------------------- */

export interface DdfRow {
  /** Free-text technical specification of the catalogue item. */
  specs?: string;
  /** Seller of this row; compared with the client name. */
  supplier?: string;
  /** True when this row belongs to the client (resolved by the caller). */
  isClient: boolean;
}

export interface DdfMetric {
  /** Seller layer (offer transparency) vs product layer (hardware). */
  seller: boolean;
  penalty: boolean;
}

export interface DdfResult {
  /** `${rowIndex}-${metricIndex}` -> score, ready for the matrix state. */
  scores: Record<string, ScoreValue>;
  productCells: number;
  sellerCells: number;
  /** Rows with no specs text: their product cells stay NE. */
  rowsWithoutSpecs: number;
}

/** Score used for a candidate whose commercial offer data is not published. */
export const SELLER_OPAQUE_SCORE: ScoreValue = 2;
/** Score used for the client when its offer documents are published in full. */
export const SELLER_TRANSPARENT_SCORE: ScoreValue = 10;

/**
 * Deterministic matrix fill.
 * - product metrics: derived from specs content analysis (identical input -> identical score);
 * - seller metrics: client rows get the transparent-offer score, other rows the opaque score;
 * - penalty metrics are left untouched: a risk must be judged by the analyst, not auto-filled.
 */
export function recomputeMatrix(rows: DdfRow[], metrics: DdfMetric[]): DdfResult {
  const scores: Record<string, ScoreValue> = {};
  let productCells = 0;
  let sellerCells = 0;
  let rowsWithoutSpecs = 0;

  rows.forEach((row, ri) => {
    const hardware = scoreFromSpecs(row.specs);
    if (hardware === "NE") rowsWithoutSpecs += 1;
    metrics.forEach((m, mi) => {
      if (m.penalty) return;
      const key = `${ri}-${mi}`;
      if (m.seller) {
        scores[key] = row.isClient ? SELLER_TRANSPARENT_SCORE : SELLER_OPAQUE_SCORE;
        sellerCells += 1;
      } else {
        scores[key] = hardware;
        if (hardware !== "NE") productCells += 1;
      }
    });
  });

  return { scores, productCells, sellerCells, rowsWithoutSpecs };
}
