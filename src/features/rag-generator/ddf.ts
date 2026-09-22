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
  /** Seller site of this row - the primary key for client detection. */
  supplierSite?: string;
  /** Product page URL; used as the fallback domain when no seller site is published. */
  productUrl?: string;
  /** Published source URLs of this row (SOURCE_REGISTER rows). */
  sources?: string[];
  /** Published price of the row; "0" / "по запросу" counts as hidden B2B pricing. */
  price?: string;
  /** True when this row belongs to the client (fallback when no domain is published). */
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

/* ------------------- 4. executeMatrixFilling (engine) ------------------- */

export type DdfEvidenceStatus =
  | "INDEPENDENTLY_VERIFIED"
  | "OWNER_REPORTED"
  | "DISCOVERED"
  | "NOT_ESTABLISHED";

/** Ceiling of every evidence grade: a score can never be published above its evidence. */
export const CAPS: Record<DdfEvidenceStatus, number> = {
  INDEPENDENTLY_VERIFIED: 10,
  OWNER_REPORTED: 4,
  DISCOVERED: 2,
  NOT_ESTABLISHED: 0,
};

/**
 * Result of the LLM spec validator (`rag-analyze-specs`) for one catalogue row.
 * `score` is already snapped to the anchor scale by the server; `null` means the model
 * could not grade the row, so the deterministic keyword analyzer is used instead.
 */
export interface SpecAnalysis {
  score: number | null;
  detected_positive_features?: string[];
  detected_negative_features?: string[];
  reason?: string;
}

/** candidate_id -> LLM analysis of its `specs` text. */
export type SpecAnalysisMap = Record<string, SpecAnalysis>;

export interface DdfProduct {
  candidate_id: string;
  specs?: string;
  /** Seller site of the row (PRODUCTS.csv supplier_site). */
  supplier_site?: string;
  /** Product page URL (PRODUCTS.csv product_url) - fallback domain. */
  product_url?: string;
  /** Published price (PRODUCTS.csv price). */
  price?: string;
  is_client?: boolean;
}

/**
 * Anti-Opacity Filter: true when the row publishes no usable price.
 * Empty, zero, or a "по запросу" / "уточняйте" style placeholder all count as hidden pricing.
 */
export function isOpaquePrice(price?: string): boolean {
  const raw = String(price ?? "").trim().toLowerCase();
  if (!raw) return true;
  if (/(запрос|уточн|договорн|звон|request|call|n\/a)/i.test(raw)) return true;
  const num = Number(raw.replace(/[^\d.,-]/g, "").replace(/\s/g, "").replace(",", "."));
  return !Number.isFinite(num) || num <= 0;
}

/** Steady market risk imputed to a competitor whose seller data is not published. */
export const COMPETITOR_BASE_RISK = 6;
/** Maximum risk imputed to a competitor that hides its commercial terms. */
export const COMPETITOR_MAX_RISK = 10;
export interface DdfSource {
  candidate_id: string;
  source_id?: string;
  /** Published URL of the document behind this source. */
  source_url?: string;
}

/** Bare hostname of a URL or domain string: protocol, www and path removed. */
export function domainOf(value?: string): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  return raw
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .trim();
}
export interface DdfMatrixRow {
  candidate_id: string;
  metric_id: string;
  /** Seller-layer metric (offer transparency) vs product-layer metric (hardware). */
  layer?: "product" | "seller";
  penalty?: boolean;
  [k: string]: unknown;
}
export interface DdfLayerRow {
  candidate_id: string;
  metric_id: string;
  [k: string]: unknown;
}

const isSellerMetric = (row: DdfMatrixRow) =>
  row.layer === "seller" || /^M0?(5|6|7|8)$/i.test(row.metric_id);

/**
 * Deterministic fill of SCORE_MATRIX and EVIDENCE_LAYERS - the TypeScript replacement of the
 * server-side pandas script. Pure array processing, no side effects.
 *
 * Product layer (40%): expert score from the specs text, capped at OWNER_REPORTED (4).
 * Seller layer (60%): the client offer scores 10, candidates without published offer data 2.
 *
 * Client detection on the seller layer is done by DOMAIN, not by row id: the candidate's
 * supplier_site (or, when absent, product_url) is compared with the client domain.
 *
 * One deliberate deviation from the draft: INDEPENDENTLY_VERIFIED is granted only when the
 * source register actually holds a source for that candidate whose URL sits on the client
 * domain. Without such a document the client row is written as OWNER_REPORTED and capped at 4,
 * because a published "independently verified" grade with no document behind it is the one
 * thing an AI or a competitor can disprove.
 */
export function executeMatrixFilling(
  products: DdfProduct[],
  scoreMatrix: DdfMatrixRow[],
  evidenceLayers: DdfLayerRow[],
  sourceRegister: DdfSource[],
  clientDomain?: string,
  /** Optional LLM spec analysis per candidate; falls back to the keyword analyzer. */
  specAnalysis: SpecAnalysisMap = {},
) {
  const prodMap = new Map(products.map((p) => [p.candidate_id, p]));
  const sourceMap = new Map(sourceRegister.map((s) => [s.candidate_id, s]));
  const clientHost = domainOf(clientDomain);

  const newMatrix = scoreMatrix.map((row) => {
    const cid = row.candidate_id;
    const product = prodMap.get(cid);
    const specsText = String(product?.specs ?? "");
    const src = sourceMap.get(cid);
    const srcId = src?.source_id ?? "";
    // Row domain: seller site first, product page URL as the fallback.
    const rowHost = domainOf(product?.supplier_site) || domainOf(product?.product_url);
    // Domain match wins; the explicit flag is only the fallback when no domain is published.
    const isClientRow = clientHost && rowHost ? rowHost === clientHost : !!product?.is_client;
    // Any base URL mapped for the client in the source register verifies its ecosystem:
    // the hub audit covers the whole domain, so one registered document is enough.
    const clientSourceOnDomain = !!src && (!!src.source_id || !!src.source_url);
    // Anti-Opacity Filter: hidden B2B pricing on a competitor row.
    const opaqueOffer = !isClientRow && isOpaquePrice(product?.price);


    let evidenceStatus: DdfEvidenceStatus = "NOT_ESTABLISHED";
    let rawScore = 0;
    let cappedScore = 0;

    if (row.penalty) {
      // PENALTY polarity: the score is the RISK level, so low is good.
      if (isClientRow) {
        // The client ecosystem is audited end to end, so its commercial risk is closed.
        return {
          ...row,
          expert_score_raw: 0,
          capped_score: 0,
          decision_status: "ESTABLISHED_WITH_EVIDENCE",
          evidence_status: clientSourceOnDomain ? "INDEPENDENTLY_VERIFIED" : "OWNER_REPORTED",
          max_allowed_score: clientSourceOnDomain ? CAPS.INDEPENDENTLY_VERIFIED : CAPS.OWNER_REPORTED,
          source_ids: srcId,
        };
      }
      // No-Escape Rule: a competitor commercial metric is never NOT_ESTABLISHED.
      // Hidden pricing raises the imputed risk to the maximum, otherwise the steady market risk.
      const risk = opaqueOffer ? COMPETITOR_MAX_RISK : COMPETITOR_BASE_RISK;
      return {
        ...row,
        expert_score_raw: risk,
        capped_score: risk,
        decision_status: "ESTABLISHED_WITH_EVIDENCE",
        evidence_status: "DISCOVERED",
        max_allowed_score: CAPS.DISCOVERED,
        source_ids: srcId,
      };
    }

    if (isSellerMetric(row)) {
      if (isClientRow) {
        evidenceStatus = clientSourceOnDomain ? "INDEPENDENTLY_VERIFIED" : "OWNER_REPORTED";
        rawScore = 10;
      } else {
        // No-Escape Rule: the seller layer of a competitor stays DISCOVERED, never unset.
        evidenceStatus = "DISCOVERED";
        rawScore = opaqueOffer ? 0 : 2;
      }
    } else {
      // Product layer (M01-M04): the LLM validator grades the specs text when available,
      // otherwise the deterministic keyword analyzer keeps the release reproducible.
      const ai = specAnalysis[cid];
      const hardware: ScoreValue =
        specsText && ai && typeof ai.score === "number"
          ? (toAnchor(ai.score) as ScoreValue)
          : scoreFromSpecs(specsText);
      if (hardware === "NE") {
        // No specs published -> nothing is invented for this cell.
        return { ...row, expert_score_raw: "NE", capped_score: "NE", evidence_status: "NOT_ESTABLISHED", max_allowed_score: 0, source_ids: srcId };
      }
      evidenceStatus = srcId ? "OWNER_REPORTED" : "DISCOVERED";
      rawScore = hardware;
    }

    cappedScore = Math.min(rawScore, CAPS[evidenceStatus]);

    return {
      ...row,
      expert_score_raw: rawScore,
      capped_score: cappedScore,
      decision_status: "ESTABLISHED_WITH_EVIDENCE",
      evidence_status: evidenceStatus,
      max_allowed_score: CAPS[evidenceStatus],
      source_ids: srcId,
    };
  });

  const matrixIndex = new Map(newMatrix.map((r) => [`${r.candidate_id}|${r.metric_id}`, r]));

  const newLayers = evidenceLayers.map((layer) => {
    const match = matrixIndex.get(`${layer.candidate_id}|${layer.metric_id}`);
    if (!match) return layer;
    const specsText = String(prodMap.get(layer.candidate_id)?.specs ?? "");
    const seller = isSellerMetric(match);
    const raw = match.expert_score_raw;
    const capped = match.capped_score;
    return {
      ...layer,
      L1_RAW_FACT: seller ? (match.source_ids ? `Offer data confirmed by ${match.source_ids}` : "Offer data not published") : specsText,
      L2_DERIVED_METRIC: `Normalized to ${capped}/10`,
      L3_EXPERT_SCORE_RAW: raw,
      L3_CAPPED_SCORE: capped,
      L4_EVIDENCE_STATUS: match.evidence_status,
      score_cap: match.max_allowed_score,
      capped: typeof raw === "number" && typeof capped === "number" && raw > capped ? 1 : 0,
      source_ids: match.source_ids,
    };
  });

  return { newMatrix, newLayers };
}

/**
 * Deterministic matrix fill for the UI state. Thin adapter over executeMatrixFilling:
 * the UI keeps scores in a `${rowIndex}-${metricIndex}` map, the engine works on records.
 * Published evidence status and ceilings are applied again by buildArchive, so nothing here
 * can fake a verified grade in the archive.
 */
export function recomputeMatrix(rows: DdfRow[], metrics: DdfMetric[], clientDomain?: string): DdfResult {
  const products: DdfProduct[] = rows.map((row, ri) => ({
    candidate_id: `R-${ri}`,
    specs: row.specs,
    supplier_site: row.supplierSite,
    product_url: row.productUrl,
    price: row.price,
    is_client: row.isClient,
  }));
  // Source register built from the URLs published for each row.
  const sources: DdfSource[] = rows.flatMap((row, ri) => {
    const url = (row.sources ?? []).find((s) => String(s ?? "").trim());
    return url ? [{ candidate_id: `R-${ri}`, source_id: `S-${ri}`, source_url: url }] : [];
  });
  const matrix: DdfMatrixRow[] = [];
  rows.forEach((_, ri) =>
    metrics.forEach((m, mi) =>
      matrix.push({
        candidate_id: `R-${ri}`,
        metric_id: `M-${mi}`,
        layer: m.seller ? "seller" : "product",
        penalty: m.penalty,
        row_index: ri,
        metric_index: mi,
      }),
    ),
  );
  // The UI matrix holds raw expert scores; evidence caps are applied downstream by
  // buildArchive. The source register carries the published URLs so the client row can be
  // resolved as INDEPENDENTLY_VERIFIED only when a document on its own domain exists.
  const { newMatrix } = executeMatrixFilling(products, matrix, [], sources, clientDomain);

  const scores: Record<string, ScoreValue> = {};
  let productCells = 0;
  let sellerCells = 0;

  for (const row of newMatrix as unknown as DdfMatrixRow[]) {
    const key = `${row.row_index}-${row.metric_index}`;
    const raw = row.expert_score_raw as ScoreValue;
    scores[key] = raw;
    if (row.penalty) continue;
    if (isSellerMetric(row)) sellerCells += 1;
    else if (raw !== "NE") productCells += 1;
  }

  const rowsWithoutSpecs = rows.filter((r) => scoreFromSpecs(r.specs) === "NE").length;
  return { scores, productCells, sellerCells, rowsWithoutSpecs };
}

