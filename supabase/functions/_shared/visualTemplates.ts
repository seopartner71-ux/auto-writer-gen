// ============================================================================
// P17 - VISUAL ENGINE / TEMPLATES + DESIGN PROFILES + VISUAL QA
//
// Pure + deterministic. No DB, no LLM, no HTML.
//   Registry -> Page Type -> Visual Template -> Component Library -> (build later)
// ============================================================================

import {
  BLOCK_BY_TYPE, CTA_BLOCKS, HERO_BLOCKS, TRUST_BLOCKS,
  defaultVariant, isKnownBlock, type VisualBlockType,
} from "./visualComponents.ts";

export type VisualPageType =
  | "home" | "hub" | "category" | "product" | "service"
  | "article" | "informational" | "local" | "system";

export type Industry = "ecommerce" | "services" | "informational" | "local_business" | "b2b_catalog";
export type VisualStyle = "industrial" | "minimal" | "corporate" | "bold" | "warm";
export type LayoutType = "wide" | "boxed" | "split";

export interface ColorScheme {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
}

export interface Typography {
  heading_font: string;
  body_font: string;
  scale: "compact" | "normal" | "large";
}

export interface VisualBlockConfig {
  type: VisualBlockType | string;
  enabled: boolean;
  variant?: string;
  order?: number;
}

export interface PageVisualConfig {
  type: VisualPageType;
  template: string;
  blocks: VisualBlockConfig[];
}

export interface ComponentsConfig {
  /** template id per page type */
  templates: Partial<Record<VisualPageType, string>>;
  /** block overrides per page type */
  blocks: Partial<Record<VisualPageType, VisualBlockConfig[]>>;
  header_variant?: string;
  footer_variant?: string;
  /** logo url or text mark */
  logo_url?: string | null;
  logo_text?: string | null;
  sticky_mobile_cta?: boolean;
}

export interface DesignProfile {
  name: string;
  industry: Industry;
  style: VisualStyle;
  color_scheme: ColorScheme;
  typography: Typography;
  layout_type: LayoutType;
  components_config: ComponentsConfig;
}

// ---------------------------------------------------------------------------
// PAGE TEMPLATES (block order per page type)
// ---------------------------------------------------------------------------
export interface PageTemplate {
  id: string;
  page_type: VisualPageType;
  label_ru: string;
  label_en: string;
  industries: Industry[];
  blocks: VisualBlockType[];
}

export const PAGE_TEMPLATES: PageTemplate[] = [
  // ---- HOME ---------------------------------------------------------------
  {
    id: "home_v1", page_type: "home", label_ru: "Главная - универсальная", label_en: "Home - universal",
    industries: ["ecommerce", "services", "informational", "local_business", "b2b_catalog"],
    blocks: ["header", "hero_home", "categories", "advantages", "trust", "products", "articles", "faq", "cta", "footer"],
  },
  {
    id: "industrial_home_v1", page_type: "home", label_ru: "Главная - B2B каталог", label_en: "Home - B2B catalog",
    industries: ["b2b_catalog"],
    blocks: ["header", "hero_home", "categories", "characteristics", "trust", "certificates", "products", "brands", "delivery", "faq", "lead_form", "footer"],
  },
  {
    id: "service_home_v1", page_type: "home", label_ru: "Главная - услуги", label_en: "Home - services",
    industries: ["services", "local_business"],
    blocks: ["header", "hero_home", "advantages", "process", "cases", "reviews", "trust", "faq", "lead_form", "footer"],
  },

  // ---- HUB ----------------------------------------------------------------
  {
    id: "hub_v1", page_type: "hub", label_ru: "Хаб - универсальный", label_en: "Hub - universal",
    industries: ["ecommerce", "services", "informational", "local_business", "b2b_catalog"],
    blocks: ["header", "breadcrumb", "hero_category", "categories", "products", "trust", "advantages", "expert_block", "articles", "faq", "cta", "footer"],
  },

  // ---- CATEGORY -----------------------------------------------------------
  {
    id: "category_v1", page_type: "category", label_ru: "Категория - универсальная", label_en: "Category - universal",
    industries: ["ecommerce", "services", "informational", "local_business", "b2b_catalog"],
    blocks: ["header", "breadcrumb", "hero_category", "description", "subcategories", "products", "comparison", "advantages", "faq", "articles", "footer"],
  },
  {
    id: "industrial_category_v1", page_type: "category", label_ru: "Категория - технический каталог", label_en: "Category - technical catalog",
    industries: ["b2b_catalog", "ecommerce"],
    blocks: ["header", "breadcrumb", "hero_category", "filters", "description", "subcategories", "products", "characteristics", "comparison", "delivery", "faq", "lead_form", "footer"],
  },

  {
    id: "industrial_catalog_v1", page_type: "category", label_ru: "Категория - промышленный каталог", label_en: "Category - industrial catalog",
    industries: ["b2b_catalog", "ecommerce"],
    blocks: ["header", "breadcrumb", "hero_category", "trust", "filters", "subcategories", "advantages", "products", "applications", "characteristics", "delivery", "faq", "cta", "footer"],
  },

  // ---- PRODUCT ------------------------------------------------------------
  {
    id: "product_v1", page_type: "product", label_ru: "Товар - универсальный", label_en: "Product - universal",
    industries: ["ecommerce", "local_business", "b2b_catalog"],
    blocks: ["header", "breadcrumb", "hero_product", "gallery", "price", "characteristics", "advantages", "delivery", "warranty", "faq", "related_products", "articles", "footer"],
  },
  {
    id: "industrial_product_v1", page_type: "product", label_ru: "Товар - промышленный", label_en: "Product - industrial",
    industries: ["b2b_catalog"],
    blocks: ["header", "breadcrumb", "hero_product", "characteristics", "gallery", "price", "trust", "certificates", "delivery", "payment", "warranty", "faq", "comparison", "related_products", "lead_form", "footer"],
  },

  // ---- SERVICE ------------------------------------------------------------
  {
    id: "service_v1", page_type: "service", label_ru: "Услуга - универсальная", label_en: "Service - universal",
    industries: ["services", "local_business", "b2b_catalog"],
    blocks: ["header", "breadcrumb", "hero_service", "problem", "solution", "advantages", "process", "cases", "reviews", "faq", "cta", "footer"],
  },

  // ---- ARTICLE / INFORMATIONAL -------------------------------------------
  {
    id: "article_v1", page_type: "article", label_ru: "Статья", label_en: "Article",
    industries: ["ecommerce", "services", "informational", "local_business", "b2b_catalog"],
    blocks: ["header", "breadcrumb", "article_header", "author", "article_body", "expert_block", "faq", "products", "cta", "footer"],
  },
  {
    id: "informational_v1", page_type: "informational", label_ru: "Информационная страница", label_en: "Informational page",
    industries: ["informational", "ecommerce", "services", "local_business", "b2b_catalog"],
    blocks: ["header", "breadcrumb", "hero_article", "description", "instruction", "expert_block", "faq", "articles", "cta", "footer"],
  },

  // ---- LOCAL --------------------------------------------------------------
  {
    id: "local_v1", page_type: "local", label_ru: "Локальная страница", label_en: "Local page",
    industries: ["local_business", "services", "ecommerce", "b2b_catalog"],
    blocks: ["header", "breadcrumb", "hero_service", "advantages", "trust", "delivery", "reviews", "faq", "callback", "cta", "footer"],
  },

  // ---- SYSTEM -------------------------------------------------------------
  {
    id: "system_v1", page_type: "system", label_ru: "Системная страница", label_en: "System page",
    industries: ["ecommerce", "services", "informational", "local_business", "b2b_catalog"],
    blocks: ["header", "breadcrumb", "description", "footer"],
  },
];

export const TEMPLATE_BY_ID: Record<string, PageTemplate> = Object.fromEntries(
  PAGE_TEMPLATES.map((t) => [t.id, t]),
);

export function templatesFor(pageType: VisualPageType, industry?: Industry): PageTemplate[] {
  return PAGE_TEMPLATES.filter(
    (t) => t.page_type === pageType && (!industry || t.industries.includes(industry)),
  );
}

// ---------------------------------------------------------------------------
// DESIGN PROFILE PRESETS
// ---------------------------------------------------------------------------
const TYPO: Record<VisualStyle, Typography> = {
  industrial: { heading_font: "IBM Plex Sans", body_font: "Inter", scale: "compact" },
  minimal: { heading_font: "Inter", body_font: "Inter", scale: "normal" },
  corporate: { heading_font: "Manrope", body_font: "Inter", scale: "normal" },
  bold: { heading_font: "Space Grotesk", body_font: "DM Sans", scale: "large" },
  warm: { heading_font: "Lora", body_font: "Source Sans 3", scale: "normal" },
};

export const DESIGN_PRESETS: Record<string, DesignProfile> = {
  industrial_b2b: {
    name: "Industrial B2B",
    industry: "b2b_catalog",
    style: "industrial",
    color_scheme: { primary: "#1F3A5F", accent: "#F59E0B", background: "#FFFFFF", surface: "#F4F6F8", text: "#111827", muted: "#6B7280" },
    typography: TYPO.industrial,
    layout_type: "wide",
    components_config: {
      templates: { home: "industrial_home_v1", hub: "hub_v1", category: "industrial_catalog_v1", product: "industrial_product_v1", service: "service_v1", article: "article_v1", informational: "informational_v1", local: "local_v1", system: "system_v1" },
      blocks: {},
      header_variant: "catalog_bar",
      footer_variant: "with_requisites",
      sticky_mobile_cta: true,
    },
  },
  service_studio: {
    name: "Service",
    industry: "services",
    style: "corporate",
    color_scheme: { primary: "#0F766E", accent: "#F97316", background: "#FFFFFF", surface: "#F1F5F9", text: "#0F172A", muted: "#64748B" },
    typography: TYPO.corporate,
    layout_type: "boxed",
    components_config: {
      templates: { home: "service_home_v1", hub: "hub_v1", category: "category_v1", product: "product_v1", service: "service_v1", article: "article_v1", informational: "informational_v1", local: "local_v1", system: "system_v1" },
      blocks: {},
      header_variant: "split_contacts",
      footer_variant: "columns",
      sticky_mobile_cta: true,
    },
  },
  ecommerce_clean: {
    name: "Ecommerce",
    industry: "ecommerce",
    style: "minimal",
    color_scheme: { primary: "#111827", accent: "#E11D48", background: "#FFFFFF", surface: "#F8FAFC", text: "#111827", muted: "#6B7280" },
    typography: TYPO.minimal,
    layout_type: "wide",
    components_config: {
      templates: { home: "home_v1", hub: "hub_v1", category: "industrial_category_v1", product: "product_v1", service: "service_v1", article: "article_v1", informational: "informational_v1", local: "local_v1", system: "system_v1" },
      blocks: {},
      header_variant: "classic",
      footer_variant: "columns",
      sticky_mobile_cta: true,
    },
  },
  local_business: {
    name: "Local business",
    industry: "local_business",
    style: "warm",
    color_scheme: { primary: "#7C2D12", accent: "#16A34A", background: "#FFFDF9", surface: "#F5F0E8", text: "#1C1917", muted: "#78716C" },
    typography: TYPO.warm,
    layout_type: "boxed",
    components_config: {
      templates: { home: "service_home_v1", hub: "hub_v1", category: "category_v1", product: "product_v1", service: "service_v1", article: "article_v1", informational: "informational_v1", local: "local_v1", system: "system_v1" },
      blocks: {},
      header_variant: "split_contacts",
      footer_variant: "with_requisites",
      sticky_mobile_cta: true,
    },
  },
  informational_media: {
    name: "Informational",
    industry: "informational",
    style: "bold",
    color_scheme: { primary: "#1D4ED8", accent: "#DB2777", background: "#FFFFFF", surface: "#F5F5F5", text: "#0A0A0A", muted: "#737373" },
    typography: TYPO.bold,
    layout_type: "boxed",
    components_config: {
      templates: { home: "home_v1", hub: "hub_v1", category: "category_v1", product: "product_v1", service: "service_v1", article: "article_v1", informational: "informational_v1", local: "local_v1", system: "system_v1" },
      blocks: {},
      header_variant: "compact",
      footer_variant: "compact",
      sticky_mobile_cta: false,
    },
  },
};

export const INDUSTRY_PRESET: Record<Industry, string> = {
  b2b_catalog: "industrial_b2b",
  services: "service_studio",
  ecommerce: "ecommerce_clean",
  local_business: "local_business",
  informational: "informational_media",
};

export function presetFor(industry: Industry): DesignProfile {
  return DESIGN_PRESETS[INDUSTRY_PRESET[industry]] || DESIGN_PRESETS.ecommerce_clean;
}

// ---------------------------------------------------------------------------
// REGISTRY -> VISUAL PAGE TYPE
// ---------------------------------------------------------------------------
export function visualPageType(row: { page_type?: string | null; url_path?: string | null; entity_type?: string | null }): VisualPageType {
  const path = String(row.url_path || "").trim();
  if (path === "/" || path === "") return "home";
  const pt = String(row.page_type || "").toLowerCase();
  const map: Record<string, VisualPageType> = {
    home: "home", hub: "hub", category: "category", product: "product",
    service: "service", article: "article", informational: "informational",
    local: "local", system: "system",
  };
  return map[pt] || "system";
}

// ---------------------------------------------------------------------------
// VISUAL JSON BUILDER
// ---------------------------------------------------------------------------
export interface PageFacts {
  has_faq?: boolean;
  has_characteristics?: boolean;
  has_price?: boolean;
  has_images?: boolean;
  has_children?: boolean;
  has_products?: boolean;
  has_articles?: boolean;
  has_reviews?: boolean;
  has_content?: boolean;
  has_h1?: boolean;
}

const REQ_FACT: Record<string, keyof PageFacts> = {
  h1: "has_h1",
  faq: "has_faq",
  characteristics: "has_characteristics",
  price: "has_price",
  images: "has_images",
  children: "has_children",
  products: "has_products",
  articles: "has_articles",
  reviews: "has_reviews",
  content: "has_content",
};

/** Blocks whose data is missing get enabled=false instead of rendering empty. */
export function buildPageVisualConfig(
  pageType: VisualPageType,
  profile: DesignProfile,
  facts: PageFacts = {},
  aiOverrides?: VisualBlockConfig[],
): PageVisualConfig {
  const templateId = profile.components_config?.templates?.[pageType]
    || templatesFor(pageType, profile.industry)[0]?.id
    || templatesFor(pageType)[0]?.id
    || "system_v1";
  const template = TEMPLATE_BY_ID[templateId] || TEMPLATE_BY_ID.system_v1;

  const overrides = new Map<string, VisualBlockConfig>();
  for (const o of profile.components_config?.blocks?.[pageType] || []) overrides.set(String(o.type), o);
  for (const o of aiOverrides || []) if (isKnownBlock(String(o.type))) overrides.set(String(o.type), o);

  const ordered: VisualBlockConfig[] = [];
  const seen = new Set<string>();
  const push = (type: string, index: number) => {
    if (seen.has(type) || !isKnownBlock(type)) return;
    seen.add(type);
    const spec = BLOCK_BY_TYPE[type];
    const ov = overrides.get(type);
    const dataOk = (spec.requires || []).every((r) => facts[REQ_FACT[r]] !== false);
    const enabled = spec.mandatory ? true : (ov ? ov.enabled !== false : true) && dataOk;
    ordered.push({
      type: type as VisualBlockType,
      enabled,
      variant: ov?.variant && spec.variants.includes(ov.variant) ? ov.variant : defaultVariant(type),
      order: typeof ov?.order === "number" ? ov.order : index,
    });
  };

  template.blocks.forEach((b, i) => push(b, i));
  // AI can add blocks that are not part of the template.
  let extra = template.blocks.length;
  for (const [type, ov] of overrides) {
    if (!seen.has(type) && ov.enabled !== false) push(type, typeof ov.order === "number" ? ov.order : extra++);
  }
  ordered.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  ordered.forEach((b, i) => { b.order = i; });

  return { type: pageType, template: template.id, blocks: ordered };
}

// ---------------------------------------------------------------------------
// VISUAL QA
// ---------------------------------------------------------------------------
export type VisualStatus = "PASS" | "REVIEW" | "FAIL";

export interface VisualIssue {
  code: string;
  severity: "error" | "warning";
  detail?: string;
}

export interface VisualCheckResult {
  status: VisualStatus;
  score: number;
  issues: VisualIssue[];
}

const CONTENT_ONLY: VisualPageType[] = ["article", "informational", "system"];

export function checkVisualConfig(
  config: PageVisualConfig,
  facts: PageFacts = {},
): VisualCheckResult {
  const issues: VisualIssue[] = [];
  const on = config.blocks.filter((b) => b.enabled).map((b) => String(b.type));
  const has = (list: string[]) => list.some((t) => on.includes(t));

  if (!on.includes("header")) issues.push({ code: "missing_header", severity: "error" });
  if (!on.includes("footer")) issues.push({ code: "missing_footer", severity: "error" });
  if (!has(HERO_BLOCKS)) issues.push({ code: "missing_hero", severity: "error" });

  if (!CONTENT_ONLY.includes(config.type) && !has(CTA_BLOCKS)) {
    issues.push({ code: "missing_cta", severity: "error" });
  }
  if (!CONTENT_ONLY.includes(config.type) && !has(TRUST_BLOCKS)) {
    issues.push({ code: "missing_trust", severity: "warning" });
  }

  // empty blocks: enabled but the data source is known to be absent
  for (const b of config.blocks) {
    if (!b.enabled) continue;
    const spec = BLOCK_BY_TYPE[String(b.type)];
    if (!spec) { issues.push({ code: "unknown_block", severity: "warning", detail: String(b.type) }); continue; }
    for (const r of spec.requires || []) {
      if (facts[REQ_FACT[r]] === false) {
        issues.push({ code: "empty_block", severity: "warning", detail: `${b.type}:${r}` });
      }
    }
  }

  // mobile readiness: every enabled block must render on mobile, and mobile
  // needs at least one reachable CTA.
  const desktopOnly = config.blocks
    .filter((b) => b.enabled && !(BLOCK_BY_TYPE[String(b.type)]?.devices || []).includes("mobile"))
    .map((b) => String(b.type));
  const mobileCta = CTA_BLOCKS.some((t) => on.includes(t)
    && (BLOCK_BY_TYPE[t]?.devices || []).includes("mobile"));
  if (!CONTENT_ONLY.includes(config.type) && !mobileCta) {
    issues.push({ code: "not_mobile_ready", severity: "error", detail: "no mobile CTA" });
  }
  if (desktopOnly.length && desktopOnly.length === on.length) {
    issues.push({ code: "not_mobile_ready", severity: "error", detail: desktopOnly.join(",") });
  }

  if (on.length < 4) issues.push({ code: "too_few_blocks", severity: "warning", detail: String(on.length) });

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  const score = Math.max(0, 100 - errors * 25 - warnings * 6);
  const status: VisualStatus = errors ? "FAIL" : warnings ? "REVIEW" : "PASS";
  return { status, score, issues };
}

/** Guardrails for anything an LLM proposes. */
export function sanitizeAiOverrides(raw: unknown): VisualBlockConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: VisualBlockConfig[] = [];
  for (const r of raw.slice(0, 40)) {
    const type = String((r as Record<string, unknown>)?.type || "").trim();
    if (!isKnownBlock(type)) continue;
    const spec = BLOCK_BY_TYPE[type];
    const variant = String((r as Record<string, unknown>)?.variant || "");
    out.push({
      type: type as VisualBlockType,
      enabled: spec.mandatory ? true : (r as Record<string, unknown>)?.enabled !== false,
      variant: spec.variants.includes(variant) ? variant : defaultVariant(type),
      order: Number((r as Record<string, unknown>)?.order) || undefined,
    });
  }
  return out;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export function sanitizeColorScheme(raw: unknown, fallback: ColorScheme): ColorScheme {
  const r = (raw || {}) as Record<string, unknown>;
  const pick = (k: keyof ColorScheme) => {
    const v = String(r[k] || "").trim();
    return HEX.test(v) ? v : fallback[k];
  };
  return {
    primary: pick("primary"), accent: pick("accent"), background: pick("background"),
    surface: pick("surface"), text: pick("text"), muted: pick("muted"),
  };
}

const ALLOWED_FONTS = [
  "Inter", "IBM Plex Sans", "Manrope", "DM Sans", "Space Grotesk", "Lora",
  "Source Sans 3", "Roboto", "Open Sans", "Merriweather", "Plus Jakarta Sans", "Outfit",
];

export function sanitizeTypography(raw: unknown, fallback: Typography): Typography {
  const r = (raw || {}) as Record<string, unknown>;
  const font = (v: unknown, fb: string) => (ALLOWED_FONTS.includes(String(v)) ? String(v) : fb);
  const scale = String(r.scale || "");
  return {
    heading_font: font(r.heading_font, fallback.heading_font),
    body_font: font(r.body_font, fallback.body_font),
    scale: (["compact", "normal", "large"].includes(scale) ? scale : fallback.scale) as Typography["scale"],
  };
}
