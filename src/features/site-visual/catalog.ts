// P17 Visual Engine - UI mirror of the shared component/template catalogue.
// Kept intentionally small: labels, groups and template lists for the panel
// and the preview. The source of truth stays in supabase/functions/_shared.

export type Industry = "ecommerce" | "services" | "informational" | "local_business" | "b2b_catalog";
export type VisualStyle = "industrial" | "minimal" | "corporate" | "bold" | "warm";
export type LayoutType = "wide" | "boxed" | "split";
export type VisualPageType =
  | "home" | "hub" | "category" | "product" | "service"
  | "article" | "informational" | "local" | "system";

export interface ColorScheme {
  primary: string; accent: string; background: string;
  surface: string; text: string; muted: string;
}
export interface Typography { heading_font: string; body_font: string; scale: "compact" | "normal" | "large" }
export interface VisualBlockConfig { type: string; enabled: boolean; variant?: string; order?: number }

export interface DesignProfileRow {
  id?: string;
  name: string;
  industry: Industry;
  style: VisualStyle;
  color_scheme: ColorScheme;
  typography: Typography;
  layout_type: LayoutType;
  components_config: {
    templates?: Partial<Record<VisualPageType, string>>;
    blocks?: Partial<Record<VisualPageType, VisualBlockConfig[]>>;
    header_variant?: string;
    footer_variant?: string;
    logo_url?: string | null;
    logo_text?: string | null;
    sticky_mobile_cta?: boolean;
  };
}

export interface PageVisualConfigRow {
  id: string;
  url_path: string;
  page_type: VisualPageType;
  template: string;
  blocks: VisualBlockConfig[];
  visual_status: "PASS" | "REVIEW" | "FAIL";
  visual_score: number;
  visual_issues: { code: string; severity: string; detail?: string }[] | null;
}

export const INDUSTRY_LABEL: Record<Industry, { ru: string; en: string }> = {
  ecommerce: { ru: "Интернет-магазин", en: "Ecommerce" },
  services: { ru: "Услуги", en: "Services" },
  informational: { ru: "Информационный сайт", en: "Informational" },
  local_business: { ru: "Локальный бизнес", en: "Local business" },
  b2b_catalog: { ru: "B2B каталог", en: "B2B catalog" },
};

export const STYLE_LABEL: Record<VisualStyle, { ru: string; en: string }> = {
  industrial: { ru: "Промышленный", en: "Industrial" },
  minimal: { ru: "Минимализм", en: "Minimal" },
  corporate: { ru: "Корпоративный", en: "Corporate" },
  bold: { ru: "Смелый", en: "Bold" },
  warm: { ru: "Теплый", en: "Warm" },
};

export const LAYOUT_LABEL: Record<LayoutType, { ru: string; en: string }> = {
  wide: { ru: "Широкий", en: "Wide" },
  boxed: { ru: "Контейнер", en: "Boxed" },
  split: { ru: "Разделенный", en: "Split" },
};

export const PAGE_TYPE_LABEL: Record<VisualPageType, { ru: string; en: string }> = {
  home: { ru: "Главная", en: "Home" },
  hub: { ru: "Хаб", en: "Hub" },
  category: { ru: "Категория", en: "Category" },
  product: { ru: "Товар", en: "Product" },
  service: { ru: "Услуга", en: "Service" },
  article: { ru: "Статья", en: "Article" },
  informational: { ru: "Информационная", en: "Informational" },
  local: { ru: "Локальная", en: "Local" },
  system: { ru: "Системная", en: "System" },
};

export const BLOCK_LABEL: Record<string, { ru: string; en: string }> = {
  header: { ru: "Шапка", en: "Header" },
  hero_home: { ru: "Hero главной", en: "Home hero" },
  hero_product: { ru: "Hero товара", en: "Product hero" },
  hero_service: { ru: "Hero услуги", en: "Service hero" },
  hero_category: { ru: "Hero категории", en: "Category hero" },
  hero_article: { ru: "Hero статьи", en: "Article hero" },
  trust: { ru: "Доверие", en: "Trust" },
  experience: { ru: "Опыт", en: "Experience" },
  certificates: { ru: "Сертификаты", en: "Certificates" },
  brands: { ru: "Бренды", en: "Brands" },
  advantages: { ru: "Преимущества", en: "Advantages" },
  delivery: { ru: "Доставка", en: "Delivery" },
  payment: { ru: "Оплата", en: "Payment" },
  warranty: { ru: "Гарантия", en: "Warranty" },
  faq: { ru: "FAQ", en: "FAQ" },
  reviews: { ru: "Отзывы", en: "Reviews" },
  breadcrumb: { ru: "Хлебные крошки", en: "Breadcrumb" },
  categories: { ru: "Категории", en: "Categories" },
  subcategories: { ru: "Подкатегории", en: "Subcategories" },
  products: { ru: "Товары", en: "Products" },
  filters: { ru: "Фильтры", en: "Filters" },
  gallery: { ru: "Галерея", en: "Gallery" },
  price: { ru: "Цена", en: "Price" },
  characteristics: { ru: "Характеристики", en: "Characteristics" },
  comparison: { ru: "Сравнение", en: "Comparison" },
  related_products: { ru: "Похожие товары", en: "Related products" },
  description: { ru: "Описание", en: "Description" },
  problem: { ru: "Проблема", en: "Problem" },
  solution: { ru: "Решение", en: "Solution" },
  process: { ru: "Процесс", en: "Process" },
  cases: { ru: "Кейсы", en: "Cases" },
  expert_block: { ru: "Экспертный блок", en: "Expert block" },
  instruction: { ru: "Инструкция", en: "Instruction" },
  articles: { ru: "Статьи", en: "Articles" },
  article_header: { ru: "Заголовок статьи", en: "Article header" },
  author: { ru: "Автор", en: "Author" },
  article_body: { ru: "Текст статьи", en: "Article body" },
  cta: { ru: "Призыв к действию", en: "CTA" },
  lead_form: { ru: "Форма заявки", en: "Lead form" },
  callback: { ru: "Обратный звонок", en: "Callback" },
  footer: { ru: "Подвал", en: "Footer" },
};

export const ISSUE_LABEL: Record<string, { ru: string; en: string }> = {
  missing_header: { ru: "Нет шапки", en: "No header" },
  missing_footer: { ru: "Нет подвала", en: "No footer" },
  missing_hero: { ru: "Нет hero", en: "No hero" },
  missing_cta: { ru: "Нет CTA", en: "No CTA" },
  missing_trust: { ru: "Нет блока доверия", en: "No trust block" },
  empty_block: { ru: "Пустой блок", en: "Empty block" },
  not_mobile_ready: { ru: "Не готово для мобильных", en: "Not mobile ready" },
  too_few_blocks: { ru: "Слишком мало блоков", en: "Too few blocks" },
  unknown_block: { ru: "Неизвестный блок", en: "Unknown block" },
};

/** Preview-only fallback structures, mirrors PAGE_TEMPLATES defaults. */
export const PREVIEW_FALLBACK: Record<string, string[]> = {
  home: ["header", "hero_home", "categories", "advantages", "trust", "products", "articles", "faq", "cta", "footer"],
  category: ["header", "breadcrumb", "hero_category", "description", "subcategories", "products", "advantages", "faq", "footer"],
  product: ["header", "breadcrumb", "hero_product", "gallery", "price", "characteristics", "advantages", "delivery", "warranty", "faq", "related_products", "footer"],
  article: ["header", "breadcrumb", "article_header", "author", "article_body", "faq", "products", "cta", "footer"],
};

export const DEFAULT_COLORS: ColorScheme = {
  primary: "#111827", accent: "#E11D48", background: "#FFFFFF",
  surface: "#F8FAFC", text: "#111827", muted: "#6B7280",
};

export const DEFAULT_TYPO: Typography = { heading_font: "Inter", body_font: "Inter", scale: "normal" };

export const FONTS = [
  "Inter", "IBM Plex Sans", "Manrope", "DM Sans", "Space Grotesk", "Lora",
  "Source Sans 3", "Roboto", "Open Sans", "Merriweather", "Plus Jakarta Sans", "Outfit",
];
