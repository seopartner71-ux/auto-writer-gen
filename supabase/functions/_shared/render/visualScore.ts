// ============================================================================
// P18.1 - DESIGN SCORE (visual_score 0-100)
//
// Pure HTML analysis of a rendered page. No DB, no LLM.
// Factors: design system 25 / typography 15 / spacing 15 /
//          components 20 / mobile 15 / commercial UX 10
// ============================================================================

export type DesignStatus = "Premium" | "Good" | "Needs improvement" | "Fail";

export interface FactorScore {
  key: "design_system" | "typography" | "spacing" | "components" | "mobile" | "commercial_ux";
  label_ru: string;
  max: number;
  score: number;
  notes: string[];
}

export interface DesignScoreResult {
  visual_score: number;
  status: DesignStatus;
  factors: FactorScore[];
  issues: string[];
}

export interface ScoreInput {
  page_type: string;
  html: string;
  rendered: string[];
  /** hash of the sitewide css/header/footer - equal on every page of the site */
  cssHash?: string;
  siteCssHash?: string;
  headerHash?: string;
  siteHeaderHash?: string;
  footerHash?: string;
  siteFooterHash?: string;
}

export function designStatus(score: number): DesignStatus {
  if (score >= 90) return "Premium";
  if (score >= 75) return "Good";
  if (score >= 60) return "Needs improvement";
  return "Fail";
}

const count = (html: string, re: RegExp) => (html.match(re) || []).length;
const has = (html: string, re: RegExp) => re.test(html);

/** Blocks a page type must show to look like a real commercial page. */
const REQUIRED: Record<string, string[]> = {
  home: ["header", "trust", "footer"],
  hub: ["header", "breadcrumb", "footer"],
  category: ["header", "breadcrumb", "products", "footer"],
  product: ["header", "breadcrumb", "price", "characteristics", "footer"],
  service: ["header", "breadcrumb", "footer"],
  article: ["header", "breadcrumb", "footer"],
};

export function scorePage(input: ScoreInput): DesignScoreResult {
  const { html, rendered, page_type } = input;
  const on = new Set(rendered);
  const issues: string[] = [];
  const factors: FactorScore[] = [];

  const add = (
    key: FactorScore["key"], label_ru: string, max: number,
    checks: { ok: boolean; weight: number; issue: string; note?: string }[],
  ) => {
    const notes: string[] = [];
    let lost = 0;
    for (const c of checks) {
      if (c.ok) continue;
      lost += c.weight;
      notes.push(c.issue);
      issues.push(c.issue);
    }
    factors.push({ key, label_ru, max, score: Math.max(0, Math.round(max - lost)), notes });
  };

  // ---- 1. DESIGN SYSTEM CONSISTENCY (25) ----------------------------------
  add("design_system", "Дизайн-система", 25, [
    { ok: has(html, /<style>/) || has(html, /rel="stylesheet"/), weight: 12, issue: "no_css" },
    { ok: has(html, /--color-primary|var\(--/), weight: 8, issue: "no_design_tokens" },
    { ok: !input.siteCssHash || input.cssHash === input.siteCssHash, weight: 10, issue: "css_drift" },
    { ok: !input.siteHeaderHash || input.headerHash === input.siteHeaderHash, weight: 6, issue: "header_drift" },
    { ok: !input.siteFooterHash || input.footerHash === input.siteFooterHash, weight: 4, issue: "footer_drift" },
    { ok: count(html, /style="/g) < 25, weight: 4, issue: "inline_style_overuse" },
  ]);

  // ---- 2. TYPOGRAPHY (15) --------------------------------------------------
  const h1 = count(html, /<h1[\s>]/g);
  const h2 = count(html, /<h2[\s>]/g);
  add("typography", "Типографика", 15, [
    { ok: h1 === 1, weight: 6, issue: h1 === 0 ? "no_h1" : "multiple_h1" },
    { ok: h2 >= 2, weight: 4, issue: "weak_heading_hierarchy" },
    { ok: has(html, /fonts\.googleapis\.com|font-family/), weight: 3, issue: "no_font_pair" },
    { ok: has(html, /clamp\(/), weight: 2, issue: "no_fluid_type" },
  ]);

  // ---- 3. SPACING (15) -----------------------------------------------------
  add("spacing", "Отступы и ритм", 15, [
    { ok: has(html, /<section/), weight: 6, issue: "no_sections" },
    { ok: count(html, /<section/g) >= 4, weight: 4, issue: "flat_rhythm" },
    { ok: has(html, /--space|padding|gap/), weight: 3, issue: "no_spacing_scale" },
    { ok: has(html, /container|max-width/), weight: 2, issue: "no_container" },
  ]);

  // ---- 4. COMPONENTS (20) --------------------------------------------------
  const need = REQUIRED[page_type] || ["header", "footer"];
  const missing = need.filter((b) => !on.has(b) && !(b === "products" && on.has("related_products")));
  add("components", "Компоненты", 20, [
    { ok: rendered.length >= 6, weight: 6, issue: `too_few_blocks:${rendered.length}` },
    { ok: missing.length === 0, weight: 8, issue: `missing_blocks:${missing.join(",") || "-"}` },
    { ok: has(html, /class="card|class="product-card|class="grid/), weight: 4, issue: "no_card_system" },
    { ok: has(html, /:hover/), weight: 2, issue: "no_hover_states" },
  ]);

  // ---- 5. MOBILE (15) ------------------------------------------------------
  add("mobile", "Мобильная версия", 15, [
    { ok: has(html, /name="viewport"/), weight: 6, issue: "no_mobile_viewport" },
    { ok: has(html, /@media/), weight: 5, issue: "no_media_queries" },
    { ok: has(html, /minmax\(|auto-fit|flex-wrap/), weight: 2, issue: "no_fluid_grid" },
    { ok: has(html, /sticky-cta|position:\s*sticky|position:\s*fixed/), weight: 2, issue: "no_mobile_cta" },
  ]);

  // ---- 6. COMMERCIAL UX (10) ----------------------------------------------
  const conversion = on.has("cta") || on.has("lead_form") || on.has("callback");
  add("commercial_ux", "Коммерческий UX", 10, [
    { ok: conversion, weight: 4, issue: "no_conversion_block" },
    { ok: count(html, /class="btn/g) >= 3, weight: 2, issue: "weak_cta_density" },
    { ok: has(html, /tel:|mailto:/), weight: 2, issue: "no_contacts" },
    { ok: on.has("trust") || on.has("advantages") || on.has("certificates") || on.has("reviews"), weight: 2, issue: "no_trust_block" },
  ]);

  // page-type specific hard requirements (do not change the score, report only)
  if (page_type === "product") {
    if (!on.has("gallery") && !has(html, /<img/)) issues.push("product_no_photo");
    if (!on.has("price")) issues.push("product_no_price");
    if (!on.has("characteristics")) issues.push("product_no_specs");
    if (!on.has("delivery")) issues.push("product_no_delivery");
    if (!on.has("warranty")) issues.push("product_no_warranty");
    if (!on.has("faq")) issues.push("product_no_faq");
  }
  if (page_type === "category" || page_type === "hub") {
    if (!on.has("products")) issues.push("category_no_catalog");
    if (!on.has("filters") && !on.has("subcategories")) issues.push("category_no_filters");
    if (!on.has("advantages")) issues.push("category_no_advantages");
    if (!conversion) issues.push("category_no_commercial_block");
  }
  if (page_type === "article") {
    if (!has(html, /<img/)) issues.push("article_no_cover");
    if (!on.has("article_body") && !on.has("description")) issues.push("article_no_body");
    if (!conversion) issues.push("article_no_commercial_insert");
  }

  const visual_score = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.score, 0)));
  return { visual_score, status: designStatus(visual_score), factors, issues: [...new Set(issues)] };
}
