// ============================================================================
// TEMPLATE RUNTIME v1 - DATA ADAPTERS for Category and Product.
//
//   CommerceCluster + ProductRow[] + subcategories + seo_content
//        -> CategoryTemplateData -> pages/category.html
//
//   ProductRow + related + breadcrumbs + BusinessInfo
//        -> ProductTemplateData -> pages/product.html
//
// Pure and deterministic. These adapters do NOT:
//   generate content, call an LLM or the DB, build URLs (paths arrive ready),
//   touch SEO meta/JSON-LD/canonical/sitemap, or change the link graph.
// They only reshape already-produced data into display-ready, pre-escaped
// values for the mustache-lite engine.
// ============================================================================

import { escHtml } from "./seoChrome.ts";
import { money, type BusinessInfo, type ProductRow } from "./commercePages.ts";
import { asSeoContent } from "./contentBlocks.ts";
import type { TemplateRow } from "./dbTemplate.ts";

/** Zero-or-one row array: renders a wrapper block only when data exists. */
const flag = (on: boolean): TemplateRow[] => (on ? [{}] : []);

export interface TemplateCrumb { label: string; href?: string }
export interface TemplateFilterLink { label: string; href: string; count?: number | null }

function telHref(phone?: string | null): string {
  return String(phone || "").replace(/[^\d+]/g, "");
}

function availabilityLabel(av: string | null | undefined, isRu: boolean): { text: string; mod: string } {
  const out = av === "out_of_stock";
  const order = av === "preorder" || av === "on_order";
  if (out) return { text: isRu ? "Нет в наличии" : "Out of stock", mod: "is-out" };
  if (order) return { text: isRu ? "Под заказ" : "On order", mod: "is-order" };
  return { text: isRu ? "В наличии" : "In stock", mod: "is-in" };
}

function shortDescription(p: ProductRow, limit = 110): string {
  const s = String(p.description || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit);
  return cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : limit).trim() + "...";
}

function specsOf(p: ProductRow): [string, string][] {
  const c = p.characteristics;
  if (!c || typeof c !== "object") return [];
  return Object.entries(c as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
}

/** ProductRow -> card row used by both Category grid and Product "related". */
export function productCardRow(p: ProductRow, href: string, lang: string): TemplateRow {
  const isRu = lang !== "en";
  const img = (p.images || []).filter(Boolean)[0] || "";
  const av = availabilityLabel(p.availability, isRu);
  const price = money(p.price, p.currency, lang);
  return {
    name: escHtml(p.name),
    url: escHtml(href),
    image: escHtml(img),
    has_image: flag(!!img),
    no_image: flag(!img),
    image_placeholder: escHtml(String(p.name || "?").trim().slice(0, 2).toUpperCase()),
    price: escHtml(price || (isRu ? "Цена по запросу" : "Price on request")),
    has_price: flag(!!price),
    currency: escHtml((p.currency || "RUB").toUpperCase()),
    brand: escHtml(p.brand || ""),
    has_brand: flag(!!p.brand),
    sku: escHtml(p.sku || ""),
    has_sku: flag(!!p.sku),
    availability: escHtml(av.text),
    availability_mod: av.mod,
    short_description: escHtml(shortDescription(p)),
    has_short_description: flag(!!shortDescription(p)),
  };
}

// ---------------------------------------------------------------------------
// CATEGORY
// ---------------------------------------------------------------------------

export interface CategoryTemplateData extends TemplateRow {
  [key: string]: string | TemplateRow[];
}

export function buildCategoryTemplateData(args: {
  lang: string;
  h1: string;
  /** Plain intro text (already produced by the content engine or description). */
  intro: string;
  seoContent?: unknown;
  breadcrumbs: TemplateCrumb[];
  subcategories: { name: string; href: string; count?: number | null }[];
  products: { product: ProductRow; href: string }[];
  filters?: TemplateFilterLink[];
  catalogHref?: string;
  business?: BusinessInfo;
}): CategoryTemplateData {
  const lang = args.lang === "en" ? "en" : "ru";
  const isRu = lang === "ru";
  const L = (ru: string, en: string) => (isRu ? ru : en);
  const sc = asSeoContent(args.seoContent);

  const products = args.products.map(({ product, href }) => productCardRow(product, href, lang));
  const subcategories = args.subcategories.map((s) => ({
    name: escHtml(s.name), url: escHtml(s.href),
    count: s.count ? String(s.count) : "",
    has_count: flag(!!s.count),
  }));
  const filters = (args.filters || []).map((f) => ({
    label: escHtml(f.label), url: escHtml(f.href),
    count: f.count ? String(f.count) : "",
    has_count: flag(!!f.count),
  }));
  const bodyBlocks = (sc?.body || []).map((b) => ({
    heading: escHtml(b.heading || ""),
    has_heading: flag(!!b.heading),
    text: escHtml(b.text || ""),
  }));
  const faq = (sc?.faq || []).map((f) => ({ q: escHtml(f.q), a: escHtml(f.a) }));
  const phone = args.business?.phone || "";

  return {
    h1: escHtml(args.h1),
    intro: escHtml(sc?.intro || args.intro || ""),
    has_intro: flag(!!(sc?.intro || args.intro)),

    label_filters: escHtml(L("Подборки", "Collections")),
    label_subcategories: escHtml(L("Разделы", "Sections")),
    label_products: escHtml(L("Товары раздела", "Products in this category")),
    label_faq: escHtml(L("Частые вопросы", "FAQ")),
    label_details: escHtml(L("Подробнее", "Details")),
    label_catalog: escHtml(L("Весь каталог", "Full catalog")),
    products_count: String(products.length),
    label_products_count: escHtml(L("позиций в разделе", "items in this category")),

    catalog_url: escHtml(args.catalogHref || "/catalog/"),
    cta_title: escHtml(L("Нужна помощь с подбором?", "Need help choosing?")),
    cta_text: escHtml(L(
      "Пришлите спецификацию - подберем позиции и рассчитаем стоимость.",
      "Send us your specification - we will match items and quote the price.",
    )),
    cta_primary: escHtml(phone ? L("Позвонить", "Call us") : L("Оставить заявку", "Request a quote")),
    cta_primary_url: escHtml(phone ? `tel:${telHref(phone)}` : "/contacts.html"),
    cta_secondary: escHtml(L("Весь каталог", "Full catalog")),
    cta_secondary_url: escHtml(args.catalogHref || "/catalog/"),
    phone: escHtml(phone),
    has_phone: flag(!!phone),

    // repeatable blocks
    filters, has_filters: flag(filters.length > 0),
    subcategories, has_subcategories: flag(subcategories.length > 0),
    products, has_products: flag(products.length > 0),
    body_blocks: bodyBlocks, has_body: flag(bodyBlocks.length > 0),
    faq, has_faq: flag(faq.length > 0),
    breadcrumbs: args.breadcrumbs.map((c) => ({ label: escHtml(c.label), url: escHtml(c.href || "") })),
  };
}

// ---------------------------------------------------------------------------
// PRODUCT
// ---------------------------------------------------------------------------

export interface ProductTemplateData extends TemplateRow {
  [key: string]: string | TemplateRow[];
}

export function buildProductTemplateData(args: {
  lang: string;
  product: ProductRow;
  seoContent?: unknown;
  breadcrumbs: TemplateCrumb[];
  related: { product: ProductRow; href: string }[];
  business?: BusinessInfo;
  categoryHref?: string;
  categoryName?: string;
  catalogHref?: string;
}): ProductTemplateData {
  const lang = args.lang === "en" ? "en" : "ru";
  const isRu = lang === "ru";
  const L = (ru: string, en: string) => (isRu ? ru : en);
  const p = args.product;
  const sc = asSeoContent(args.seoContent);
  const isService = p.kind === "service";

  const gallery = (p.images || []).filter(Boolean).slice(0, 6);
  const specs = specsOf(p);
  const av = availabilityLabel(p.availability, isRu);
  const price = money(p.price, p.currency, lang);
  const phone = args.business?.phone || "";
  const related = args.related.map(({ product, href }) => productCardRow(product, href, lang));
  const faq = (sc?.faq || []).map((f) => ({ q: escHtml(f.q), a: escHtml(f.a) }));
  const bodyBlocks = (sc?.body || []).map((b) => ({
    heading: escHtml(b.heading || ""),
    has_heading: flag(!!b.heading),
    text: escHtml(b.text || ""),
  }));
  const deliveryLines = [
    args.business?.address ? `${L("Самовывоз", "Pickup")}: ${args.business.address}` : "",
    args.business?.workHours ? `${L("Режим работы", "Hours")}: ${args.business.workHours}` : "",
    L("Доставка по согласованию с менеджером.", "Delivery terms are agreed with the manager."),
  ].filter(Boolean);

  return {
    h1: escHtml(sc?.h1 || p.name),
    name: escHtml(p.name),
    price: escHtml(price || L("Цена по запросу", "Price on request")),
    has_price: flag(!!price),
    currency: escHtml((p.currency || "RUB").toUpperCase()),
    availability: escHtml(av.text),
    availability_mod: av.mod,
    brand: escHtml(p.brand || ""),
    has_brand: flag(!!p.brand),
    sku: escHtml(p.sku || ""),
    has_sku: flag(!!p.sku),
    description: escHtml(String(p.description || "").trim()),
    has_description: flag(!!String(p.description || "").trim()),
    intro: escHtml(sc?.intro || ""),
    has_intro: flag(!!sc?.intro),

    label_brand: escHtml(L("Бренд", "Brand")),
    label_sku: escHtml(L("Артикул", "SKU")),
    label_description: escHtml(L("Описание", "Description")),
    label_specs: escHtml(L("Характеристики", "Specifications")),
    label_delivery: escHtml(L("Доставка и оплата", "Delivery and payment")),
    label_faq: escHtml(L("Частые вопросы", "FAQ")),
    label_related: escHtml(L("Смотрите также", "See also")),
    label_details: escHtml(L("Подробнее", "Details")),

    cta_primary: escHtml(
      phone
        ? (isService ? L("Заказать услугу", "Request service") : L("Заказать по телефону", "Order by phone"))
        : L("Оставить заявку", "Request a quote"),
    ),
    cta_primary_url: escHtml(phone ? `tel:${telHref(phone)}` : "/contacts.html"),
    cta_secondary: escHtml(args.categoryName ? L("Все в разделе", "All in category") : L("Весь каталог", "Full catalog")),
    cta_secondary_url: escHtml(args.categoryHref || args.catalogHref || "/catalog/"),
    cta_note: escHtml(L(
      "Ответим в рабочее время и подтвердим наличие.",
      "We reply during business hours and confirm availability.",
    )),
    phone: escHtml(phone),
    has_phone: flag(!!phone),
    catalog_url: escHtml(args.catalogHref || "/catalog/"),
    label_catalog: escHtml(L("Весь каталог", "Full catalog")),
    category_url: escHtml(args.categoryHref || ""),
    category_name: escHtml(args.categoryName || ""),
    has_category: flag(!!args.categoryHref),

    // repeatable blocks
    gallery: gallery.map((src, i) => ({
      src: escHtml(src), alt: escHtml(p.name), is_main: flag(i === 0),
    })),
    has_gallery: flag(gallery.length > 0),
    no_gallery: flag(gallery.length === 0),
    gallery_thumbs: gallery.slice(1).map((src) => ({ src: escHtml(src), alt: escHtml(p.name) })),
    has_thumbs: flag(gallery.length > 1),
    gallery_main: escHtml(gallery[0] || ""),
    image_placeholder: escHtml(String(p.name || "?").trim().slice(0, 2).toUpperCase()),

    key_specs: specs.slice(0, 4).map(([k, v]) => ({ key: escHtml(k), value: escHtml(v) })),
    has_key_specs: flag(specs.length > 0),
    specs: specs.map(([k, v]) => ({ key: escHtml(k), value: escHtml(v) })),
    has_specs: flag(specs.length > 0),
    delivery: deliveryLines.map((t) => ({ text: escHtml(t) })),
    has_delivery: flag(deliveryLines.length > 0),
    body_blocks: bodyBlocks, has_body: flag(bodyBlocks.length > 0),
    faq, has_faq: flag(faq.length > 0),
    related, has_related: flag(related.length > 0),
    breadcrumbs: args.breadcrumbs.map((c) => ({ label: escHtml(c.label), url: escHtml(c.href || "") })),
  };
}
