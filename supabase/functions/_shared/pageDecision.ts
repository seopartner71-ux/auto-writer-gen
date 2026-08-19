// Page Decision Engine (PDE).
//
// Pure, deterministic, no LLM. Given semantic + catalog facts about an entity
// it returns a page type and a publish decision. BUILD reads the resulting
// page_registry instead of deciding on its own.

export type PdeIntent =
  | "commercial" | "transactional" | "informational" | "local" | "mixed" | "unknown";
export type PdePageType = "commercial" | "service" | "informational" | "local" | "hub";
export type PdeDecision = "candidate" | "approved" | "rejected";
export type PdeReason =
  | "APPROVED" | "LOW_DEMAND" | "NO_SEMANTICS" | "NO_PRODUCTS"
  | "DUPLICATE" | "CANNIBALIZATION" | "LOW_VALUE";

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
  mixed: 0.75,
  informational: 0.6,
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
  // 0 -> 0, 100 -> ~40, 1 000 -> ~60, 10 000 -> ~80, 100 000 -> 100
  const volPart = vol > 0 ? Math.min(100, (Math.log10(vol + 1) / 5) * 100) : 0;
  const kwPart = Math.min(100, kw * 12);
  const base = volPart * 0.65 + kwPart * 0.25 + prio * 0.1;
  const w = Math.min(1, Math.max(0, Number(inp.intentWeight) || 0.5));
  return Math.round(Math.min(100, base * (0.6 + 0.4 * w)));
}

/** Dominant intent out of the raw per-keyword intent labels. */
export function resolveIntent(labels: (string | null | undefined)[]): PdeIntent {
  const counts: Record<string, number> = {};
  for (const raw of labels) {
    const v = String(raw || "").toLowerCase();
    if (!v) continue;
    const key = v.startsWith("trans") ? "transactional"
      : v.startsWith("comm") ? "commercial"
      : v.startsWith("info") ? "informational"
      : v.startsWith("local") || v.startsWith("geo") ? "local"
      : "";
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  const keys = Object.keys(counts);
  if (!keys.length) return "unknown";
  if (keys.length > 2) return "mixed";
  keys.sort((a, b) => counts[b] - counts[a]);
  if (keys.length === 2 && counts[keys[0]] === counts[keys[1]]) return "mixed";
  return keys[0] as PdeIntent;
}

export function isCommercialIntent(i: PdeIntent): boolean {
  return i === "commercial" || i === "transactional" || i === "mixed";
}
export function isInfoIntent(i: PdeIntent): boolean {
  return i === "informational" || i === "mixed";
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
  productCount: number;
  childCount: number;
  duplicateScore: number;
  cannibalizationScore: number;
  /** Product/service entity flagged as a standalone service. */
  isService?: boolean;
  /** A real catalog row (product or service offering), not a semantic grouping. */
  isCatalogItem?: boolean;
  hasRegion?: boolean;
}

export interface PdeResult {
  pageType: PdePageType;
  decision: PdeDecision;
  reason: PdeReason;
}

export const PDE_THRESHOLDS = {
  minDemandCommercial: 20,
  minDemandService: 15,
  minDemandInfo: 15,
  minSemantic: 25,
  duplicate: 85,
  cannibalization: 80,
};

export function classifyPageType(f: EntityFacts): PdePageType {
  if (f.entityType === "hub") return "hub";
  if (f.entityType === "local" || (f.hasRegion && f.intent === "local")) return "local";
  if (f.entityType === "article") return "informational";
  if (f.entityType === "service" || f.isService) return "service";
  if (f.entityType === "product") return "commercial";
  // category
  if (isCommercialIntent(f.intent) && f.productCount > 0) return "commercial";
  if (isCommercialIntent(f.intent) && f.productCount === 0) return "service";
  if (isInfoIntent(f.intent)) return "informational";
  return f.productCount > 0 ? "commercial" : "informational";
}

export function decidePage(f: EntityFacts): PdeResult {
  const pageType = classifyPageType(f);
  const rej = (reason: PdeReason): PdeResult => ({ pageType, decision: "rejected", reason });
  const ok = (): PdeResult => ({ pageType, decision: "approved", reason: "APPROVED" });

  if (f.duplicateScore >= PDE_THRESHOLDS.duplicate) return rej("DUPLICATE");
  if (f.cannibalizationScore >= PDE_THRESHOLDS.cannibalization) return rej("CANNIBALIZATION");

  switch (pageType) {
    case "hub":
      // Hubs may exist without products, but need children or a strong cluster.
      if (f.childCount > 0 || f.productCount > 0) return ok();
      if (f.semanticScore >= 40 && f.demandScore >= PDE_THRESHOLDS.minDemandInfo) return ok();
      if (f.keywordCount === 0) return rej("NO_SEMANTICS");
      return rej("LOW_VALUE");

    case "commercial":
      // A real catalog item is its own proof of assortment.
      if (f.entityType === "product" || f.isCatalogItem) return ok();
      if (f.keywordCount === 0) return rej("NO_SEMANTICS");
      if (f.productCount === 0) return rej("NO_PRODUCTS");
      if (f.demandScore < PDE_THRESHOLDS.minDemandCommercial) return rej("LOW_DEMAND");
      return ok();

    case "service":
      // A real catalog service offering is its own proof of value.
      if (f.isCatalogItem) return ok();
      // Products are not required, but the service must stand on its own.
      if (f.keywordCount === 0 && f.productCount === 0) return rej("NO_SEMANTICS");
      if (!isCommercialIntent(f.intent) && f.intent !== "local" && f.intent !== "unknown") {
        return rej("LOW_VALUE");
      }
      if (f.semanticScore < PDE_THRESHOLDS.minSemantic && f.productCount === 0) return rej("LOW_VALUE");
      if (f.demandScore < PDE_THRESHOLDS.minDemandService) return rej("LOW_DEMAND");
      return ok();

    case "local":
      if (f.keywordCount === 0 && f.productCount === 0) return rej("NO_SEMANTICS");
      if (f.demandScore < PDE_THRESHOLDS.minDemandService) return rej("LOW_DEMAND");
      return ok();

    case "informational":
    default:
      if (f.entityType === "article") return ok();
      if (f.keywordCount === 0) return rej("NO_SEMANTICS");
      if (!isInfoIntent(f.intent) && f.intent !== "unknown") return rej("LOW_VALUE");
      if (f.demandScore < PDE_THRESHOLDS.minDemandInfo) return rej("LOW_DEMAND");
      if (f.semanticScore < PDE_THRESHOLDS.minSemantic) return rej("LOW_VALUE");
      return ok();
  }
}
