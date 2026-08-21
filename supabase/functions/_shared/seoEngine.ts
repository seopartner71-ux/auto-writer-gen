// ============================================================================
// P14 - SEO ENGINE (rules layer)
//
// Pure + deterministic. No DB, no LLM, no HTML.
// Owns: title/meta rules, robots, page type -> schema map, quality check.
//
// Does NOT touch PDE, Registry, SILO, Build, Content Engine or QA.
// ============================================================================

export type SeoPageType =
  | "hub" | "category" | "product" | "service"
  | "informational" | "local" | "article" | "system";

export type SeoStatus = "PASS" | "REVIEW" | "FAIL";

export interface SeoPackage {
  title: string;
  meta_description: string;
  h1: string;
  canonical: string;
  og_title: string;
  og_description: string;
  robots: string;
  schema_type: string;
  faq: { q: string; a: string }[];
}

export interface SeoIssue {
  code: string;
  severity: "error" | "warning";
  detail?: string;
}

// ---------------------------------------------------------------------------
// 3. TITLE RULES
// ---------------------------------------------------------------------------
export const TITLE_MAX: Record<SeoPageType, number> = {
  product: 65,
  service: 65,
  category: 60,
  hub: 60,
  informational: 70,
  article: 70,
  local: 65,
  system: 65,
};

export const TITLE_MIN = 20;

// 4. META DESCRIPTION
export const DESC_MIN = 120;
export const DESC_MAX = 160;

// 6. FAQ ENGINE
export const FAQ_COUNT: Record<SeoPageType, number> = {
  product: 3,
  service: 3,
  category: 4,
  hub: 5,
  informational: 5,
  article: 5,
  local: 4,
  system: 0,
};

export const FAQ_MIN_WORDS = 40;

// ---------------------------------------------------------------------------
// 7. SCHEMA ENGINE (no AI)
// ---------------------------------------------------------------------------
export const SCHEMA_MAP: Record<SeoPageType, string> = {
  product: "Product",
  service: "Service",
  category: "CollectionPage",
  hub: "CollectionPage",
  article: "Article",
  informational: "Article",
  local: "LocalBusiness",
  system: "WebPage",
};

export function schemaTypeFor(pageType: string): string {
  return SCHEMA_MAP[(pageType as SeoPageType)] || "WebPage";
}

// ---------------------------------------------------------------------------
// 9. ROBOTS
// ---------------------------------------------------------------------------
export function robotsFor(input: {
  pageType: string;
  urlPath: string;
  indexable?: boolean | null;
}): string {
  const p = String(input.urlPath || "").toLowerCase();
  if (p.includes("/404") || p.endsWith("404.html")) return "noindex,follow";
  if (input.indexable === false) return "noindex,follow";
  // Privacy / Terms stay indexable by spec.
  return "index,follow";
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const t = (v: unknown) => String(v ?? "").trim();
const words = (v: unknown) => t(v).split(/\s+/).filter(Boolean).length;
export const normKey = (v: unknown) =>
  t(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Hard cut at word boundary, never mid-word. */
export function truncateAtWord(s: string, max: number): string {
  const v = t(s);
  if (v.length <= max) return v;
  const cut = v.slice(0, max);
  const i = cut.lastIndexOf(" ");
  return (i > max * 0.6 ? cut.slice(0, i) : cut).replace(/[\s,;:\-]+$/, "");
}

/** Formatting rules of the project: no em dash, no "е" with diaeresis, no bold. */
export function sanitizeSeoText(s: string): string {
  return t(s)
    .replace(/[\u2014\u2013]/g, "-")
    .replace(/\u0451/g, "\u0435")
    .replace(/\u0401/g, "\u0415")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// 10. QUALITY CHECK
// ---------------------------------------------------------------------------
export interface SeoCheckContext {
  pageType: string;
  /** Titles of every OTHER page in the project, normalized. */
  otherTitles: Set<string>;
  otherH1: Set<string>;
  otherCanonicals: Set<string>;
  /** Canonical taken from the registry - the only allowed source. */
  registryCanonical: string;
  isLocal?: boolean;
}

export function checkSeoPackage(pkg: SeoPackage, ctx: SeoCheckContext): {
  status: SeoStatus;
  issues: SeoIssue[];
} {
  const type = (ctx.pageType as SeoPageType) || "system";
  const issues: SeoIssue[] = [];
  const titleMax = TITLE_MAX[type] ?? 65;

  const title = t(pkg.title);
  const desc = t(pkg.meta_description);
  const h1 = t(pkg.h1);

  if (!title) issues.push({ code: "title_missing", severity: "error" });
  else {
    if (title.length > titleMax) {
      issues.push({ code: "title_too_long", severity: "error", detail: `${title.length}/${titleMax}` });
    }
    if (title.length < TITLE_MIN) {
      issues.push({ code: "title_too_short", severity: "warning", detail: `${title.length}/${TITLE_MIN}` });
    }
    if (ctx.otherTitles.has(normKey(title))) {
      issues.push({ code: "duplicate_title", severity: "error" });
    }
  }

  if (!desc) issues.push({ code: "description_missing", severity: "error" });
  else {
    if (desc.length < DESC_MIN || desc.length > DESC_MAX) {
      issues.push({
        code: "description_length",
        severity: desc.length > DESC_MAX ? "error" : "warning",
        detail: `${desc.length} (${DESC_MIN}-${DESC_MAX})`,
      });
    }
    if (normKey(desc) === normKey(title)) {
      issues.push({ code: "description_equals_title", severity: "error" });
    }
  }

  if (!h1) issues.push({ code: "h1_missing", severity: "error" });
  else if (ctx.otherH1.has(normKey(h1))) {
    issues.push({ code: "duplicate_h1", severity: "warning" });
  }

  if (!t(pkg.canonical)) {
    issues.push({ code: "canonical_missing", severity: "error" });
  } else if (t(pkg.canonical) !== t(ctx.registryCanonical)) {
    issues.push({ code: "canonical_mismatch", severity: "error" });
  } else if (ctx.otherCanonicals.has(t(pkg.canonical))) {
    issues.push({ code: "duplicate_canonical", severity: "error" });
  }

  if (!t(pkg.og_title)) issues.push({ code: "og_title_missing", severity: "warning" });
  if (!t(pkg.og_description)) issues.push({ code: "og_description_missing", severity: "warning" });
  if (!/^(index|noindex),(follow|nofollow)$/.test(t(pkg.robots))) {
    issues.push({ code: "robots_invalid", severity: "error" });
  }
  if (!t(pkg.schema_type) || t(pkg.schema_type) !== schemaTypeFor(type)) {
    issues.push({ code: "schema_missing", severity: "error" });
  }

  const need = FAQ_COUNT[type] ?? 0;
  const faq = Array.isArray(pkg.faq) ? pkg.faq.filter((f) => t(f?.q) && t(f?.a)) : [];
  if (need > 0) {
    if (faq.length < need) {
      issues.push({ code: "faq_count", severity: "error", detail: `${faq.length}/${need}` });
    }
    const short = faq.filter((f) => words(f.a) < FAQ_MIN_WORDS).length;
    if (short > 0) {
      issues.push({ code: "faq_answer_short", severity: "warning", detail: `${short}` });
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warns = issues.length - errors;
  const status: SeoStatus = errors > 0 ? "FAIL" : warns > 0 ? "REVIEW" : "PASS";
  return { status, issues };
}

// ---------------------------------------------------------------------------
// SCHEMA BUILDER (deterministic, never AI)
// ---------------------------------------------------------------------------
export interface SchemaContext {
  pageType: string;
  url: string;
  title: string;
  description: string;
  h1: string;
  siteName?: string;
  breadcrumbs?: { name: string; url: string }[];
  faq?: { q: string; a: string }[];
  product?: {
    name?: string; sku?: string; brand?: string;
    price?: string | number | null; currency?: string; availability?: string | null;
    image?: string | null;
  } | null;
  local?: {
    name?: string; phone?: string; address?: string; city?: string;
    country?: string; hours?: string;
  } | null;
  datePublished?: string | null;
  dateModified?: string | null;
}

export function buildSchema(ctx: SchemaContext): Record<string, unknown>[] {
  const type = schemaTypeFor(ctx.pageType);
  const out: Record<string, unknown>[] = [];
  const base = { "@context": "https://schema.org", url: ctx.url };

  if (type === "Product") {
    const p = ctx.product || {};
    const node: Record<string, unknown> = {
      ...base, "@type": "Product",
      name: t(p.name) || ctx.h1 || ctx.title,
      description: ctx.description,
    };
    if (t(p.sku)) node.sku = t(p.sku);
    if (t(p.brand)) node.brand = { "@type": "Brand", name: t(p.brand) };
    if (t(p.image)) node.image = t(p.image);
    if (p.price !== null && p.price !== undefined && t(p.price)) {
      node.offers = {
        "@type": "Offer",
        price: String(p.price),
        priceCurrency: t(p.currency) || "RUB",
        availability: `https://schema.org/${t(p.availability) === "out_of_stock" ? "OutOfStock" : "InStock"}`,
        url: ctx.url,
      };
    }
    out.push(node);
  } else if (type === "Service") {
    out.push({
      ...base, "@type": "Service",
      name: ctx.h1 || ctx.title,
      description: ctx.description,
      ...(t(ctx.siteName) ? { provider: { "@type": "Organization", name: t(ctx.siteName) } } : {}),
    });
  } else if (type === "CollectionPage") {
    out.push({ ...base, "@type": "CollectionPage", name: ctx.h1 || ctx.title, description: ctx.description });
  } else if (type === "Article") {
    out.push({
      ...base, "@type": "Article",
      headline: truncateAtWord(ctx.h1 || ctx.title, 110),
      description: ctx.description,
      ...(ctx.datePublished ? { datePublished: ctx.datePublished } : {}),
      ...(ctx.dateModified ? { dateModified: ctx.dateModified } : {}),
      ...(t(ctx.siteName) ? { publisher: { "@type": "Organization", name: t(ctx.siteName) } } : {}),
    });
  } else if (type === "LocalBusiness") {
    const l = ctx.local || {};
    out.push({
      ...base, "@type": "LocalBusiness",
      name: t(l.name) || t(ctx.siteName) || ctx.h1,
      description: ctx.description,
      ...(t(l.phone) ? { telephone: t(l.phone) } : {}),
      ...(t(l.address) || t(l.city)
        ? {
            address: {
              "@type": "PostalAddress",
              ...(t(l.address) ? { streetAddress: t(l.address) } : {}),
              ...(t(l.city) ? { addressLocality: t(l.city) } : {}),
              ...(t(l.country) ? { addressCountry: t(l.country) } : {}),
            },
          }
        : {}),
      ...(t(l.hours) ? { openingHours: t(l.hours) } : {}),
    });
  } else {
    out.push({ ...base, "@type": "WebPage", name: ctx.h1 || ctx.title, description: ctx.description });
  }

  // FAQ automatically becomes FAQPage.
  const faq = (ctx.faq || []).filter((f) => t(f?.q) && t(f?.a));
  if (faq.length) {
    out.push({
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: faq.map((f) => ({
        "@type": "Question", name: t(f.q),
        acceptedAnswer: { "@type": "Answer", text: t(f.a) },
      })),
    });
  }

  // Breadcrumb is a separate node.
  const bc = (ctx.breadcrumbs || []).filter((b) => t(b?.name) && t(b?.url));
  if (bc.length > 1) {
    out.push({
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: bc.map((b, i) => ({
        "@type": "ListItem", position: i + 1, name: t(b.name), item: t(b.url),
      })),
    });
  }

  return out;
}
