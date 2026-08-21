// ============================================================================
// P17 - VISUAL ENGINE / COMPONENT LIBRARY (contract layer)
//
// Pure + deterministic. No DB, no LLM, no HTML.
// Owns: the catalogue of visual blocks, their variants, data sources and
// responsive behaviour. HTML/CSS rendering is intentionally NOT here - the
// build stays untouched until the component system is closed.
// ============================================================================

export type VisualBlockGroup =
  | "header" | "hero" | "trust" | "commercial" | "catalog"
  | "content" | "conversion" | "footer";

export type VisualDevice = "desktop" | "tablet" | "mobile";

export type VisualBlockType =
  // header
  | "header"
  // hero
  | "hero_product" | "hero_service" | "hero_category" | "hero_home" | "hero_article"
  // trust
  | "trust" | "certificates" | "brands" | "experience"
  // commercial
  | "advantages" | "delivery" | "payment" | "warranty" | "faq" | "reviews"
  // catalog
  | "breadcrumb" | "categories" | "subcategories" | "products" | "gallery"
  | "price" | "characteristics" | "comparison" | "related_products" | "filters"
  // content
  | "description" | "problem" | "solution" | "process" | "cases"
  | "expert_block" | "instruction" | "articles" | "article_header" | "author" | "article_body"
  // conversion
  | "cta" | "lead_form" | "callback"
  // footer
  | "footer";

export interface VisualBlockSpec {
  type: VisualBlockType;
  group: VisualBlockGroup;
  label_ru: string;
  label_en: string;
  /** Where the block takes its data from. "none" = static / profile driven. */
  source: "registry" | "content" | "seo" | "commercial" | "catalog" | "profile" | "blog" | "none";
  /** Block is meaningless without this data - QA reports an empty block. */
  requires?: ("h1" | "faq" | "characteristics" | "price" | "images" | "children" | "products" | "articles" | "reviews" | "content")[];
  variants: string[];
  /** Devices where the block is rendered. */
  devices: VisualDevice[];
  /** A block that must never be switched off (QA hard requirement). */
  mandatory?: boolean;
}

const D: VisualDevice[] = ["desktop", "tablet", "mobile"];

export const COMPONENT_LIBRARY: VisualBlockSpec[] = [
  // ---- HEADER -------------------------------------------------------------
  { type: "header", group: "header", label_ru: "Шапка", label_en: "Header", source: "profile",
    variants: ["compact", "classic", "split_contacts", "catalog_bar"], devices: D, mandatory: true },

  // ---- HERO ---------------------------------------------------------------
  { type: "hero_home", group: "hero", label_ru: "Hero главной", label_en: "Home hero", source: "seo",
    requires: ["h1"], variants: ["banner", "split", "search_first", "value_prop"], devices: D },
  { type: "hero_product", group: "hero", label_ru: "Hero товара", label_en: "Product hero", source: "catalog",
    requires: ["h1"], variants: ["gallery_left", "gallery_right", "compact"], devices: D },
  { type: "hero_service", group: "hero", label_ru: "Hero услуги", label_en: "Service hero", source: "seo",
    requires: ["h1"], variants: ["statement", "with_form", "split"], devices: D },
  { type: "hero_category", group: "hero", label_ru: "Hero категории", label_en: "Category hero", source: "seo",
    requires: ["h1"], variants: ["title_only", "with_intro", "with_tiles"], devices: D },
  { type: "hero_article", group: "hero", label_ru: "Hero статьи", label_en: "Article hero", source: "blog",
    requires: ["h1"], variants: ["title_only", "cover"], devices: D },

  // ---- TRUST --------------------------------------------------------------
  { type: "trust", group: "trust", label_ru: "Доверие", label_en: "Trust", source: "commercial",
    variants: ["cards", "inline_stats", "bar"], devices: D },
  { type: "experience", group: "trust", label_ru: "Опыт", label_en: "Experience", source: "profile",
    variants: ["counters", "timeline"], devices: D },
  { type: "certificates", group: "trust", label_ru: "Сертификаты", label_en: "Certificates", source: "commercial",
    variants: ["grid", "slider"], devices: ["desktop", "tablet"] },
  { type: "brands", group: "trust", label_ru: "Бренды", label_en: "Brands", source: "catalog",
    variants: ["logos", "list"], devices: D },

  // ---- COMMERCIAL ---------------------------------------------------------
  { type: "advantages", group: "commercial", label_ru: "Преимущества", label_en: "Advantages", source: "commercial",
    variants: ["icons_grid", "numbered", "two_col"], devices: D },
  { type: "delivery", group: "commercial", label_ru: "Доставка", label_en: "Delivery", source: "commercial",
    variants: ["cards", "table", "text"], devices: D },
  { type: "payment", group: "commercial", label_ru: "Оплата", label_en: "Payment", source: "commercial",
    variants: ["cards", "list"], devices: D },
  { type: "warranty", group: "commercial", label_ru: "Гарантия", label_en: "Warranty", source: "commercial",
    variants: ["panel", "list"], devices: D },
  { type: "faq", group: "commercial", label_ru: "FAQ", label_en: "FAQ", source: "seo",
    requires: ["faq"], variants: ["accordion", "two_col", "list"], devices: D },
  { type: "reviews", group: "commercial", label_ru: "Отзывы", label_en: "Reviews", source: "commercial",
    requires: ["reviews"], variants: ["cards", "slider"], devices: D },

  // ---- CATALOG ------------------------------------------------------------
  { type: "breadcrumb", group: "catalog", label_ru: "Хлебные крошки", label_en: "Breadcrumb", source: "registry",
    variants: ["plain"], devices: D },
  { type: "categories", group: "catalog", label_ru: "Категории", label_en: "Categories", source: "catalog",
    requires: ["children"], variants: ["tiles", "list", "icons"], devices: D },
  { type: "subcategories", group: "catalog", label_ru: "Подкатегории", label_en: "Subcategories", source: "catalog",
    requires: ["children"], variants: ["chips", "tiles"], devices: D },
  { type: "products", group: "catalog", label_ru: "Товары", label_en: "Products", source: "catalog",
    requires: ["products"], variants: ["grid_3", "grid_4", "rows", "table"], devices: D },
  { type: "filters", group: "catalog", label_ru: "Фильтры", label_en: "Filters", source: "catalog",
    variants: ["sidebar", "top_bar"], devices: ["desktop", "tablet"] },
  { type: "gallery", group: "catalog", label_ru: "Галерея", label_en: "Gallery", source: "catalog",
    requires: ["images"], variants: ["thumbs", "single", "slider"], devices: D },
  { type: "price", group: "catalog", label_ru: "Цена", label_en: "Price", source: "catalog",
    requires: ["price"], variants: ["panel", "inline", "on_request"], devices: D },
  { type: "characteristics", group: "catalog", label_ru: "Характеристики", label_en: "Characteristics", source: "catalog",
    requires: ["characteristics"], variants: ["table", "two_col", "spec_sheet"], devices: D },
  { type: "comparison", group: "catalog", label_ru: "Сравнение", label_en: "Comparison", source: "catalog",
    requires: ["products"], variants: ["table", "cards"], devices: ["desktop", "tablet"] },
  { type: "related_products", group: "catalog", label_ru: "Похожие товары", label_en: "Related products", source: "catalog",
    requires: ["products"], variants: ["grid_3", "slider"], devices: D },

  // ---- CONTENT ------------------------------------------------------------
  { type: "description", group: "content", label_ru: "Описание", label_en: "Description", source: "content",
    requires: ["content"], variants: ["prose", "columns", "with_toc"], devices: D },
  { type: "problem", group: "content", label_ru: "Проблема", label_en: "Problem", source: "content",
    variants: ["list", "cards"], devices: D },
  { type: "solution", group: "content", label_ru: "Решение", label_en: "Solution", source: "content",
    variants: ["steps", "prose"], devices: D },
  { type: "process", group: "content", label_ru: "Как работаем", label_en: "Process", source: "content",
    variants: ["steps", "timeline"], devices: D },
  { type: "cases", group: "content", label_ru: "Кейсы", label_en: "Cases", source: "content",
    variants: ["cards", "rows"], devices: D },
  { type: "expert_block", group: "content", label_ru: "Экспертный блок", label_en: "Expert block", source: "content",
    variants: ["quote", "panel"], devices: D },
  { type: "instruction", group: "content", label_ru: "Инструкция", label_en: "Instruction", source: "content",
    variants: ["steps", "checklist"], devices: D },
  { type: "articles", group: "content", label_ru: "Статьи", label_en: "Articles", source: "blog",
    requires: ["articles"], variants: ["cards", "list"], devices: D },
  { type: "article_header", group: "content", label_ru: "Заголовок статьи", label_en: "Article header", source: "blog",
    requires: ["h1"], variants: ["plain", "with_meta"], devices: D },
  { type: "author", group: "content", label_ru: "Автор", label_en: "Author", source: "profile",
    variants: ["inline", "card"], devices: D },
  { type: "article_body", group: "content", label_ru: "Текст статьи", label_en: "Article body", source: "blog",
    requires: ["content"], variants: ["prose", "with_toc"], devices: D },

  // ---- CONVERSION ---------------------------------------------------------
  { type: "cta", group: "conversion", label_ru: "Призыв к действию", label_en: "CTA", source: "commercial",
    variants: ["band", "card", "sticky_mobile"], devices: D },
  { type: "lead_form", group: "conversion", label_ru: "Форма заявки", label_en: "Lead form", source: "profile",
    variants: ["inline", "two_col", "compact"], devices: D },
  { type: "callback", group: "conversion", label_ru: "Обратный звонок", label_en: "Callback", source: "profile",
    variants: ["button", "bar"], devices: D },

  // ---- FOOTER -------------------------------------------------------------
  { type: "footer", group: "footer", label_ru: "Подвал", label_en: "Footer", source: "profile",
    variants: ["columns", "compact", "with_requisites"], devices: D, mandatory: true },
];

export const BLOCK_BY_TYPE: Record<string, VisualBlockSpec> = Object.fromEntries(
  COMPONENT_LIBRARY.map((b) => [b.type, b]),
);

export function isKnownBlock(type: string): type is VisualBlockType {
  return Boolean(BLOCK_BY_TYPE[type]);
}

export function defaultVariant(type: string): string {
  return BLOCK_BY_TYPE[type]?.variants[0] || "default";
}

/** Groups considered "conversion-critical" for the visual QA layer. */
export const HERO_BLOCKS = COMPONENT_LIBRARY.filter((b) => b.group === "hero").map((b) => b.type);
export const TRUST_BLOCKS = COMPONENT_LIBRARY.filter((b) => b.group === "trust").map((b) => b.type);
export const CTA_BLOCKS: VisualBlockType[] = ["cta", "lead_form", "callback"];
