// P24 - Faceted Navigation & Filter Engine (pure logic, no IO, no LLM).
//
// Layer position:  Catalog -> ATTRIBUTES -> Filter Engine -> SEO landings -> PDE
//
// Nothing here touches PDE, SILO, Registry or the renderer. The module only
// turns product characteristics into filter definitions and landing candidates.

import { slugifyPath } from "./siloUrl.ts";

export type FilterType = "enum" | "range";

export interface AttributeValue {
  value: string;
  slug: string;
  productCount: number;
  /** Parsed numeric part, when the value is numeric (10 for "M10", "10 мм"). */
  num: number | null;
}

export interface AttributeStat {
  attribute: string;
  slug: string;
  filterType: FilterType;
  values: AttributeValue[];
  productCount: number;
  /** Blocked by the SEO deny-list (price, stock, sorting...). */
  denied: boolean;
  reason: string;
}

export interface FilterThresholds {
  /** A landing needs at least this many products to exist at all. */
  minProducts: number;
  /** Second facet needs a stronger assortment. */
  minProductsPair: number;
  /** Attributes with more distinct values than this are noise (SKU-like). */
  maxValues: number;
  /** Attributes with fewer products than this are not worth a filter. */
  minAttributeProducts: number;
  /** Enum attribute needs at least this many distinct values. */
  minValues: number;
}

export const FILTER_DEFAULTS: FilterThresholds = {
  minProducts: 3,
  minProductsPair: 5,
  maxValues: 60,
  minAttributeProducts: 5,
  minValues: 2,
};

/** Attributes that must NEVER become an indexable landing. */
const DENY_PATTERNS: RegExp[] = [
  /цена|стоим|price|cost/i,
  /остат|нали[чч]|склад|stock|availab|quantity|колич/i,
  /сортир|sort|order\s?by/i,
  /артикул|sku|код\s?товар|barcode|штрих/i,
  /ссылк|url|фото|изображ|image|photo/i,
  /скидк|акция|discount|promo/i,
  /вес\s?упаков|упаковк\s?шт|pack\s?qty/i,
  /дата|срок\s?поставк|delivery\s?time/i,
];

/** Attributes that are indexable only with a healthy assortment. */
const CONDITIONAL_PATTERNS: RegExp[] = [/бренд|производ|brand|manufact|vendor/i];

/** Ordering of facets inside a multi-facet URL (SEO priority, high -> low). */
const PRIORITY_PATTERNS: [RegExp, number][] = [
  [/din|гост|gost|iso\b|стандарт/i, 100],
  [/материал|material|сталь|steel/i, 90],
  [/класс\s?прочн|прочн|strength|grade/i, 85],
  [/покрыт|coating|оцинк|finish/i, 80],
  [/диаметр|diameter|размер|size|резьб/i, 75],
  [/длин|length|высот|height|ширин|width/i, 70],
  [/тип|вид|type|form|исполн/i, 60],
  [/цвет|color|colour/i, 50],
  [/бренд|производ|brand|manufact/i, 40],
];

export function attributePriority(name: string): number {
  for (const [re, p] of PRIORITY_PATTERNS) if (re.test(name)) return p;
  return 30;
}

export function isDenied(name: string): boolean {
  return DENY_PATTERNS.some((re) => re.test(name));
}
export function isConditional(name: string): boolean {
  return CONDITIONAL_PATTERNS.some((re) => re.test(name));
}

/** Normalised attribute key: case / "ё" / punctuation insensitive. */
export function attrKey(v: string): string {
  return String(v || "").toLowerCase().replace(/ё/g, "е").replace(/[\s_]+/g, " ").trim();
}

export function normalizeValue(raw: unknown): string {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  return s.length > 60 ? "" : s;
}

/** Numeric part of a value: "M10" -> 10, "10 мм" -> 10, "нержавейка" -> null. */
export function numericPart(value: string): number | null {
  const m = String(value).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  // Reject values that are mostly text with an incidental number.
  const digits = (String(value).match(/\d/g) || []).length;
  const letters = (String(value).match(/[a-zа-я]/gi) || []).length;
  if (letters > digits + 2) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function valueSlug(attribute: string, value: string): string {
  return slugifyPath(value) || slugifyPath(`${attribute}-v`);
}

export interface ProductLike {
  id: string;
  site_cluster_id: string | null;
  brand?: string | null;
  characteristics?: Record<string, unknown> | null;
}

/** Collects attribute statistics for one set of products (usually a category). */
export function analyzeAttributes(
  products: ProductLike[],
  th: FilterThresholds = FILTER_DEFAULTS,
): AttributeStat[] {
  const byAttr = new Map<string, { label: string; values: Map<string, { label: string; ids: Set<string> }> }>();

  const put = (label: string, rawValue: unknown, id: string) => {
    const value = normalizeValue(rawValue);
    if (!value || !label) return;
    const key = attrKey(label);
    if (!key) return;
    const entry = byAttr.get(key) || { label, values: new Map() };
    const vKey = attrKey(value);
    const v = entry.values.get(vKey) || { label: value, ids: new Set<string>() };
    v.ids.add(id);
    entry.values.set(vKey, v);
    byAttr.set(key, entry);
  };

  for (const p of products) {
    const ch = (p.characteristics || {}) as Record<string, unknown>;
    for (const [k, raw] of Object.entries(ch)) {
      if (raw === null || raw === undefined) continue;
      if (Array.isArray(raw)) { for (const item of raw) put(k, item, p.id); continue; }
      if (typeof raw === "object") continue;
      put(k, raw, p.id);
    }
    if (p.brand) put("Бренд", p.brand, p.id);
  }

  const stats: AttributeStat[] = [];
  for (const [, entry] of byAttr) {
    const values: AttributeValue[] = [...entry.values.values()]
      .map((v) => ({
        value: v.label,
        slug: valueSlug(entry.label, v.label),
        productCount: v.ids.size,
        num: numericPart(v.label),
      }))
      .sort((a, b) => (a.num !== null && b.num !== null ? a.num - b.num : b.productCount - a.productCount));

    const covered = new Set<string>();
    for (const v of entry.values.values()) for (const id of v.ids) covered.add(id);
    const numericShare = values.filter((v) => v.num !== null).length / Math.max(1, values.length);
    const filterType: FilterType = numericShare >= 0.8 ? "range" : "enum";

    let denied = false;
    let reason = "ok";
    if (isDenied(entry.label)) { denied = true; reason = "DENY_LIST"; }
    else if (values.length > th.maxValues) { denied = true; reason = "TOO_MANY_VALUES"; }
    else if (values.length < th.minValues) { denied = true; reason = "SINGLE_VALUE"; }
    else if (covered.size < th.minAttributeProducts) { denied = true; reason = "THIN_ATTRIBUTE"; }
    else if (isConditional(entry.label) && covered.size < th.minAttributeProducts * 2) {
      denied = true; reason = "THIN_BRAND";
    }

    stats.push({
      attribute: entry.label,
      slug: slugifyPath(entry.label),
      filterType,
      values,
      productCount: covered.size,
      denied,
      reason,
    });
  }

  return stats.sort((a, b) => attributePriority(b.attribute) - attributePriority(a.attribute)
    || b.productCount - a.productCount);
}

// ---------------------------------------------------------------------------
// Landing candidates
// ---------------------------------------------------------------------------

export interface Facet {
  attribute: string;
  attributeSlug: string;
  value: string;
  valueSlug: string;
}

export interface LandingCandidate {
  clusterId: string;
  facets: Facet[];
  urlPath: string;
  slug: string;
  title: string;
  productIds: string[];
  productCount: number;
  demandScore: number;
  keywordHits: number;
  indexable: boolean;
  /** Canonical target: self ("") means the landing is its own canonical. */
  canonical: string;
  reason: string;
}

function facetSegment(f: Facet): string {
  // "DIN" + "931" -> din-931 ; "Материал" + "Нержавейка" -> material-nerzhaveyka
  const a = f.attributeSlug;
  const v = f.valueSlug;
  return v.startsWith(a) ? v : `${a}-${v}`;
}

export function landingPath(clusterPath: string, facets: Facet[]): string {
  const base = clusterPath.endsWith("/") ? clusterPath : `${clusterPath}/`;
  return `${base}${facets.map(facetSegment).join("/")}/`;
}

/** Demand proxy: how many project keywords mention every facet value. */
export function keywordHits(facets: Facet[], keywords: string[]): number {
  let hits = 0;
  for (const kw of keywords) {
    const k = attrKey(kw);
    if (!k) continue;
    if (facets.every((f) => k.includes(attrKey(f.value)) || k.includes(f.valueSlug.replace(/-/g, " ")))) hits++;
  }
  return hits;
}

export function landingDemand(inp: {
  productCount: number; keywordHits: number; facets: number; indexableAttrs: boolean;
}): number {
  const prod = Math.min(45, Math.log10(inp.productCount + 1) * 45);
  const kw = Math.min(45, inp.keywordHits * 15);
  const depth = inp.facets === 1 ? 10 : 4;
  const base = prod + kw + depth;
  return Math.round(Math.min(100, inp.indexableAttrs ? base : base * 0.4));
}

export interface BuildLandingsInput {
  clusterId: string;
  clusterPath: string;
  clusterName: string;
  products: ProductLike[];
  stats: AttributeStat[];
  keywords: string[];
  thresholds?: FilterThresholds;
  /** Manual overrides: attribute key -> indexable. */
  overrides?: Map<string, boolean>;
  lang?: string;
}

function titleFor(clusterName: string, facets: Facet[], ru: boolean): string {
  const tail = facets.map((f) => `${f.attribute} ${f.value}`).join(", ");
  return ru ? `${clusterName} - ${tail}` : `${clusterName} - ${tail}`;
}

/**
 * Builds landing candidates for one category.
 * Rules:
 *   - only attributes that survived the deny-list become indexable landings;
 *   - a landing needs a real assortment (minProducts), otherwise it is skipped;
 *   - a second facet requires demand (keyword hit) or a strong assortment;
 *   - never more than 2 facets - deeper combinations are noindex by design.
 */
export function buildLandings(inp: BuildLandingsInput): LandingCandidate[] {
  const th = inp.thresholds || FILTER_DEFAULTS;
  const ru = (inp.lang || "ru") !== "en";
  const out: LandingCandidate[] = [];
  const seen = new Set<string>();

  const indexableAttr = (s: AttributeStat): boolean => {
    const ov = inp.overrides?.get(attrKey(s.attribute));
    if (ov !== undefined) return ov;
    return !s.denied;
  };

  const valueIds = new Map<string, Set<string>>();
  const keyOf = (attr: string, val: string) => `${attrKey(attr)}::${attrKey(val)}`;
  for (const p of inp.products) {
    const ch = (p.characteristics || {}) as Record<string, unknown>;
    const push = (a: string, v: unknown) => {
      const value = normalizeValue(v);
      if (!value) return;
      const k = keyOf(a, value);
      const set = valueIds.get(k) || new Set<string>();
      set.add(p.id);
      valueIds.set(k, set);
    };
    for (const [a, raw] of Object.entries(ch)) {
      if (Array.isArray(raw)) { for (const item of raw) push(a, item); continue; }
      if (raw && typeof raw === "object") continue;
      push(a, raw);
    }
    if (p.brand) push("Бренд", p.brand);
  }

  const idsFor = (facets: Facet[]): string[] => {
    let acc: Set<string> | null = null;
    for (const f of facets) {
      const set = valueIds.get(keyOf(f.attribute, f.value)) || new Set<string>();
      acc = acc === null ? new Set(set) : new Set([...acc].filter((id) => set.has(id)));
    }
    return acc ? [...acc] : [];
  };

  const add = (facets: Facet[], indexable: boolean, reason: string) => {
    const ids = idsFor(facets);
    const min = facets.length > 1 ? th.minProductsPair : th.minProducts;
    if (ids.length < th.minProducts) return;
    const hits = keywordHits(facets, inp.keywords);
    if (facets.length > 1 && ids.length < min && hits === 0) return;
    const urlPath = landingPath(inp.clusterPath, facets);
    if (seen.has(urlPath)) return;
    seen.add(urlPath);
    out.push({
      clusterId: inp.clusterId,
      facets,
      urlPath,
      slug: facets.map(facetSegment).join("--"),
      title: titleFor(inp.clusterName, facets, ru),
      productIds: ids,
      productCount: ids.length,
      keywordHits: hits,
      demandScore: landingDemand({
        productCount: ids.length, keywordHits: hits,
        facets: facets.length, indexableAttrs: indexable,
      }),
      indexable,
      canonical: indexable ? "" : inp.clusterPath,
      reason,
    });
  };

  const usable = inp.stats.filter((s) => s.values.length >= th.minValues);
  const indexed = usable.filter(indexableAttr)
    .sort((a, b) => attributePriority(b.attribute) - attributePriority(a.attribute));

  // ---- level 1: single facet ---------------------------------------------
  for (const s of usable) {
    const ok = indexableAttr(s);
    for (const v of s.values) {
      if (v.productCount < th.minProducts) continue;
      add(
        [{ attribute: s.attribute, attributeSlug: s.slug, value: v.value, valueSlug: v.slug }],
        ok,
        ok ? "INDEXABLE" : s.reason === "ok" ? "MANUAL_NOINDEX" : s.reason,
      );
    }
  }

  // ---- level 2: pairs of the two strongest indexable attributes -----------
  const pairAttrs = indexed.slice(0, 4);
  for (let i = 0; i < pairAttrs.length; i++) {
    for (let j = i + 1; j < pairAttrs.length; j++) {
      const a = pairAttrs[i];
      const b = pairAttrs[j];
      for (const va of a.values) {
        if (va.productCount < th.minProducts) continue;
        for (const vb of b.values) {
          if (vb.productCount < th.minProducts) continue;
          add([
            { attribute: a.attribute, attributeSlug: a.slug, value: va.value, valueSlug: va.slug },
            { attribute: b.attribute, attributeSlug: b.slug, value: vb.value, valueSlug: vb.slug },
          ], true, "INDEXABLE_PAIR");
        }
      }
    }
  }

  return out.sort((x, y) => y.demandScore - x.demandScore);
}

// ---------------------------------------------------------------------------
// QA
// ---------------------------------------------------------------------------

export interface FilterQaIssue { level: "blocker" | "warning"; code: string; path: string; detail: string }

export interface FilterPageLike {
  url_path: string;
  canonical: string | null;
  indexable: boolean;
  product_count: number;
  cluster_path?: string | null;
  seo_content?: unknown;
}

export function auditFilters(pages: FilterPageLike[], knownCategoryPaths: Set<string>): FilterQaIssue[] {
  const issues: FilterQaIssue[] = [];
  const seen = new Map<string, number>();
  for (const p of pages) {
    seen.set(p.url_path, (seen.get(p.url_path) || 0) + 1);
  }
  for (const [path, n] of seen) {
    if (n > 1) issues.push({ level: "blocker", code: "duplicate_filter_url", path, detail: `${n} страниц с одним URL` });
  }
  const byPath = new Map(pages.map((p) => [p.url_path, p]));
  for (const p of pages) {
    const canonical = String(p.canonical || "").trim();
    if (canonical && canonical === p.url_path && !p.indexable) {
      issues.push({ level: "blocker", code: "canonical_loop", path: p.url_path, detail: "noindex ссылается сам на себя" });
    }
    if (canonical && canonical !== p.url_path) {
      const target = byPath.get(canonical);
      if (target && String(target.canonical || "") && String(target.canonical) !== canonical) {
        issues.push({ level: "blocker", code: "canonical_loop", path: p.url_path, detail: "цепочка каноникалов" });
      }
      if (!target && !knownCategoryPaths.has(canonical)) {
        issues.push({ level: "blocker", code: "orphan_filter", path: p.url_path, detail: "каноникал ведет в никуда" });
      }
    }
    const parent = p.cluster_path || "";
    if (parent && !knownCategoryPaths.has(parent)) {
      issues.push({ level: "blocker", code: "orphan_filter", path: p.url_path, detail: "нет родительской категории" });
    }
    if (p.product_count === 0) {
      issues.push({ level: "warning", code: "empty_landing", path: p.url_path, detail: "нет товаров" });
    } else if (p.product_count < FILTER_DEFAULTS.minProducts) {
      issues.push({ level: "warning", code: "thin_landing", path: p.url_path, detail: `товаров: ${p.product_count}` });
    }
    const sc = (p.seo_content || {}) as Record<string, unknown>;
    if (!String(sc.intro || "").trim()) {
      issues.push({ level: "warning", code: "no_intro", path: p.url_path, detail: "нет вводного текста" });
    }
    if (!Array.isArray(sc.faq) || (sc.faq as unknown[]).length === 0) {
      issues.push({ level: "warning", code: "no_faq", path: p.url_path, detail: "нет FAQ" });
    }
  }
  return issues;
}
