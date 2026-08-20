// Page Decision Engine (PDE) — hardened (P9).
//
// Pure, deterministic, no LLM.
//
// Two independent axes, never mixed:
//   intent    — what the USER wants        (commercial | transactional |
//               informational | comparison | local | navigational)
//   pageType  — what SEO PAGE must exist   (hub | category | product |
//               service | informational | local | article)

export type PdeIntent =
  | "commercial" | "transactional" | "informational"
  | "comparison" | "local" | "navigational" | "mixed" | "unknown";

export type PdePageType =
  | "hub" | "category" | "product" | "service" | "informational" | "local" | "article";

export type PdeDecision = "candidate" | "approved" | "review" | "rejected";
export type PdeReason =
  | "APPROVED" | "LOW_DEMAND" | "NO_SEMANTICS" | "NO_PRODUCTS" | "NO_OFFER"
  | "DUPLICATE" | "CANNIBALIZATION" | "LOW_VALUE" | "URL_CONFLICT"
  | "REVIEW_NO_OFFER" | "REVIEW_THIN_ASSORTMENT";

export interface DemandInput {
  /** Sum of search volume / frequency across attached keywords. */
  volume: number;
  keywordCount: number;
  /** 0..1, derived from the dominant intent. */
  intentWeight: number;
  /** Cluster priority as stored on keywords (0..100). */
  priority?: number;
}

const INTENT_WEIGHT: Record<PdeIntent, number> = {
  transactional: 1,
  commercial: 0.9,
  local: 0.85,
  comparison: 0.8,
  mixed: 0.75,
  informational: 0.6,
  navigational: 0.55,
  unknown: 0.5,
};

export function intentWeight(intent: PdeIntent): number {
  return INTENT_WEIGHT[intent] ?? 0.5;
}

/** Deterministic 0-100 demand score. Log scale on volume, no LLM. */
export function demandScore(inp: DemandInput): number {
  const vol = Math.max(0, Number(inp.volume) || 0);
  const kw = Math.max(0, Number(inp.keywordCount) || 0);
  const prio = Math.min(100, Math.max(0, Number(inp.priority) || 0));
  const volPart = vol > 0 ? Math.min(100, (Math.log10(vol + 1) / 5) * 100) : 0;
  const kwPart = Math.min(100, kw * 12);
  const base = volPart * 0.65 + kwPart * 0.25 + prio * 0.1;
  const w = Math.min(1, Math.max(0, Number(inp.intentWeight) || 0.5));
  return Math.round(Math.min(100, base * (0.6 + 0.4 * w)));
}

/** Normalise one raw keyword intent label to a PDE intent. */
export function normalizeIntent(raw: string | null | undefined): PdeIntent | null {
  const v = String(raw || "").toLowerCase();
  if (!v) return null;
  if (v.startsWith("trans") || v.includes("buy") || v.includes("купить")) return "transactional";
  if (v.startsWith("comp") && (v.includes("compar") || v.includes("сравн") || v.includes("vs"))) return "comparison";
  if (v.startsWith("comm")) return "commercial";
  if (v.startsWith("info")) return "informational";
  if (v.startsWith("nav") || v.includes("brand")) return "navigational";
  if (v.startsWith("local") || v.startsWith("geo")) return "local";
  return null;
}

/** Dominant intent out of the raw per-keyword intent labels. */
export function resolveIntent(labels: (string | null | undefined)[]): PdeIntent {
  const counts: Record<string, number> = {};
  for (const raw of labels) {
    const key = normalizeIntent(raw);
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  const keys = Object.keys(counts);
  if (!keys.length) return "unknown";
  if (keys.length > 2) return "mixed";
  keys.sort((a, b) => counts[b] - counts[a]);
  if (keys.length === 2 && counts[keys[0]] === counts[keys[1]]) return "mixed";
  return keys[0] as PdeIntent;
}

/** Intent that means the user is ready to buy / choose a supplier. */
export function isCommercialIntent(i: PdeIntent): boolean {
  return i === "commercial" || i === "transactional" || i === "mixed";
}
/** Intent that is satisfied by content, not by a catalog. */
export function isInfoIntent(i: PdeIntent): boolean {
  return i === "informational" || i === "comparison" || i === "mixed";
}

/** Semantic coverage 0-100: how well the entity is backed by real semantics. */
export function semanticScore(inp: {
  keywordCount: number;
  uniqueTerms: number;
  hasContent: boolean;
  hasDescription: boolean;
}): number {
  const kw = Math.min(60, (Number(inp.keywordCount) || 0) * 15);
  const terms = Math.min(20, (Number(inp.uniqueTerms) || 0) * 2);
  const content = inp.hasContent ? 15 : 0;
  const desc = inp.hasDescription ? 5 : 0;
  return Math.round(Math.min(100, kw + terms + content + desc));
}

export interface EntityFacts {
  entityType: "hub" | "category" | "service" | "product" | "article" | "local";
  intent: PdeIntent;
  keywordCount: number;
  demandScore: number;
  semanticScore: number;
  /** Catalog rows of kind=product attached to the entity. */
  productCount: number;
  /** Catalog rows of kind=service attached to the entity. */
  serviceCount?: number;
  childCount: number;
  duplicateScore: number;
  cannibalizationScore: number;
  /** Entity explicitly modelled as a service page. */
  isService?: boolean;
  /** A real catalog row (product or service offering), not a semantic grouping. */
  isCatalogItem?: boolean;
  /** Entity already carries generated/manual page content. */
  hasContent?: boolean;
  hasRegion?: boolean;
}

export interface PdeResult {
  pageType: PdePageType;
  decision: PdeDecision;
  reason: PdeReason;
  /** True when the page can back its promise with a real offer. */
  hasOffer: boolean;
}

export const PDE_THRESHOLDS = {
  minDemandCommercial: 20,
  minDemandService: 15,
  minDemandInfo: 15,
  minSemantic: 25,
  minSemanticInfo: 30,
  duplicate: 85,
  cannibalization: 80,
  /** Commercial demand worth a manual look even without an offer. */
  minDemandReview: 12,
};

/**
 * Offer availability = the page has something concrete to sell or deliver.
 * Evaluated against the resolved PAGE TYPE, not the raw entity type.
 */
export function hasOffer(f: EntityFacts, pageType?: PdePageType): boolean {
  if (f.isCatalogItem) return true;
  const products = Number(f.productCount) || 0;
  const services = Number(f.serviceCount) || 0;
  if (products > 0 || services > 0) return true;
  // P9: an offer is a FACT, not an inference. A semantic cluster without any
  // catalog row (product or service) has no offer, whatever its page type.
  // Explicitly modelled service entities are the single exception.
  if (f.isService === true || f.entityType === "service") return true;
  return false;
}

/** The entity really carries a deliverable service offer. */
export function hasServiceOffer(f: EntityFacts): boolean {
  return (Number(f.serviceCount) || 0) > 0 || f.isService === true || f.entityType === "service";
}

/** The entity really carries an assortment (catalogue or child pages). */
export function hasAssortment(f: EntityFacts): boolean {
  return (Number(f.productCount) || 0) > 0 || (Number(f.childCount) || 0) > 0;
}

export function classifyPageType(f: EntityFacts): PdePageType {
  if (f.entityType === "hub") return "hub";
  if (f.entityType === "article") return "article";
  if (f.isCatalogItem) {
    if (f.entityType === "service" || f.isService) return "service";
    if (f.hasRegion && f.intent === "local") return "local";
    return "product";
  }
  if (f.entityType === "product") return "product";
  // ---- P9 taxonomy: local wins over commercial when the intent is local ----
  //   local + service        -> local
  //   commercial/transactional + real service offer -> service
  //   commercial/transactional + catalogue/entity   -> category
  //   informational                                  -> informational
  const service = hasServiceOffer(f);
  if (f.entityType === "local" || f.intent === "local" || (f.hasRegion && f.intent === "local")) {
    return "local";
  }
  if (service) return "service";
  if (isCommercialIntent(f.intent)) {
    // No real service offer: a commercial cluster is a catalogue page, even
    // when its assortment is still empty (that case ends up in `review`).
    return "category";
  }
  if (isInfoIntent(f.intent) || f.intent === "navigational") return "informational";
  return hasAssortment(f) ? "category" : "informational";
}

export function decidePage(f: EntityFacts): PdeResult {
  const pageType = classifyPageType(f);
  const offer = hasOffer(f, pageType);
  const rej = (reason: PdeReason): PdeResult =>
    ({ pageType, decision: "rejected", reason, hasOffer: offer });
  const review = (reason: PdeReason): PdeResult =>
    ({ pageType, decision: "review", reason, hasOffer: offer });
  const ok = (): PdeResult =>
    ({ pageType, decision: "approved", reason: "APPROVED", hasOffer: offer });

  if (f.duplicateScore >= PDE_THRESHOLDS.duplicate) return rej("DUPLICATE");
  if (f.cannibalizationScore >= PDE_THRESHOLDS.cannibalization) return rej("CANNIBALIZATION");

  switch (pageType) {
    // ---- article: its own content is the value; catalog irrelevant --------
    case "article":
      return ok();

    // ---- hub: children or a strong cluster; catalog NOT required ----------
    case "hub":
      if (f.childCount > 0) return ok();
      if (f.productCount > 0 || (f.serviceCount || 0) > 0) return ok();
      if (f.semanticScore >= 40 && f.demandScore >= PDE_THRESHOLDS.minDemandInfo) return ok();
      if (f.keywordCount === 0) return rej("NO_SEMANTICS");
      return rej("LOW_VALUE");

    // ---- product: an assortment item is its own proof ---------------------
    case "product":
      if (f.isCatalogItem) return ok();
      if (f.keywordCount === 0) return rej("NO_SEMANTICS");
      if (!offer) return rej("NO_PRODUCTS");
      return ok();

    // ---- category: assortment IS mandatory --------------------------------
    case "category":
      if (f.keywordCount === 0) return rej("NO_SEMANTICS");
      if (!hasAssortment(f)) {
        // P9: a commercial cluster with real demand but no assortment yet is
        // a business decision, not a technical error -> manual review.
        if (f.demandScore >= PDE_THRESHOLDS.minDemandReview) return review("REVIEW_NO_OFFER");
        return rej("NO_PRODUCTS");
      }
      if (f.demandScore < PDE_THRESHOLDS.minDemandCommercial) return rej("LOW_DEMAND");
      return ok();

    // ---- service: products NOT required, an offer is -----------------------
    case "service":
      if (f.isCatalogItem) return ok();
      if (f.keywordCount === 0) return rej("NO_SEMANTICS");
      if (!offer) {
        if (f.demandScore >= PDE_THRESHOLDS.minDemandReview) return review("REVIEW_NO_OFFER");
        return rej("NO_OFFER");
      }
      if (isInfoIntent(f.intent) && !isCommercialIntent(f.intent)) return rej("LOW_VALUE");
      if (f.semanticScore < PDE_THRESHOLDS.minSemantic) return rej("LOW_VALUE");
      if (f.demandScore < PDE_THRESHOLDS.minDemandService) return rej("LOW_DEMAND");
      return ok();

    // ---- local: region intent, catalog NOT required ------------------------
    case "local":
      if (f.isCatalogItem) return ok();
      if (f.keywordCount === 0) return rej("NO_SEMANTICS");
      if (!offer && !hasAssortment(f) && isCommercialIntent(f.intent)
        && f.demandScore >= PDE_THRESHOLDS.minDemandReview
        && f.demandScore < PDE_THRESHOLDS.minDemandService) return review("REVIEW_NO_OFFER");
      if (f.demandScore < PDE_THRESHOLDS.minDemandService) return rej("LOW_DEMAND");
      return ok();

    // ---- informational: catalog NEVER required, value must be standalone ---
    case "informational":
    default:
      if (f.keywordCount === 0 && f.childCount === 0) return rej("NO_SEMANTICS");
      if (isCommercialIntent(f.intent) && !isInfoIntent(f.intent) && f.intent !== "unknown") {
        // Pure buying intent served by a text page = wrong page type.
        return rej("LOW_VALUE");
      }
      if (f.demandScore < PDE_THRESHOLDS.minDemandInfo) return rej("LOW_DEMAND");
      if (f.semanticScore < PDE_THRESHOLDS.minSemanticInfo) return rej("LOW_VALUE");
      return ok();
  }
}
