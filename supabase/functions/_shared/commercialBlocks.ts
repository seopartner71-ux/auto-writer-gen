// ============================================================================
// P15 - TRUST & CONVERSION ENGINE (rules + renderer layer)
//
// Pure + deterministic. No DB, no LLM, no deploy.
// Owns: block matrix per page type, missing-data phrasing, block scoring,
// the CommercialBlockRenderer and the commercial Schema.org additions.
//
// Does NOT touch PDE, page_registry, Content Engine, SEO Engine, Build or QA.
// ============================================================================

export type CommercialPageType =
  | "product" | "service" | "category" | "hub"
  | "article" | "informational" | "local" | "system";

export type BlockType =
  | "trust_block"
  | "advantages_block"
  | "delivery_block"
  | "warranty_block"
  | "payment_block"
  | "cta_block"
  | "faq_block"
  | "reviews_block"
  | "certificates_block"
  | "description_block"
  | "specs_block"
  | "price_block"
  | "assortment_block"
  | "process_block"
  | "navigation_block"
  | "expert_block"
  | "links_block";

export interface BlockSpec {
  type: BlockType;
  /** Factors the block needs. Missing factors become Missing Data notes. */
  factors: string[];
  required: boolean;
  priority: number;
}

/** 4. Block matrix. Required blocks decide the page commercial status. */
export const BLOCK_MATRIX: Record<CommercialPageType, BlockSpec[]> = {
  product: [
    { type: "description_block", factors: [], required: true, priority: 10 },
    { type: "specs_block", factors: [], required: true, priority: 20 },
    { type: "price_block", factors: ["primary_cta"], required: true, priority: 30 },
    { type: "delivery_block", factors: ["delivery"], required: true, priority: 40 },
    { type: "warranty_block", factors: ["warranty", "return"], required: true, priority: 50 },
    { type: "payment_block", factors: ["payment"], required: false, priority: 55 },
    { type: "trust_block", factors: ["company_name", "experience"], required: false, priority: 60 },
    { type: "cta_block", factors: ["primary_cta", "phone", "order_process"], required: true, priority: 70 },
    { type: "faq_block", factors: [], required: true, priority: 80 },
  ],
  category: [
    { type: "description_block", factors: [], required: true, priority: 10 },
    { type: "advantages_block", factors: ["experience", "brands"], required: true, priority: 20 },
    { type: "assortment_block", factors: [], required: true, priority: 30 },
    { type: "delivery_block", factors: ["delivery"], required: true, priority: 40 },
    { type: "payment_block", factors: ["payment"], required: false, priority: 45 },
    { type: "cta_block", factors: ["primary_cta", "phone", "order_process"], required: true, priority: 50 },
    { type: "faq_block", factors: [], required: true, priority: 60 },
  ],
  service: [
    { type: "description_block", factors: [], required: true, priority: 10 },
    { type: "process_block", factors: ["order_process"], required: true, priority: 20 },
    { type: "advantages_block", factors: ["experience", "clients_cases"], required: true, priority: 30 },
    { type: "warranty_block", factors: ["warranty"], required: false, priority: 40 },
    { type: "cta_block", factors: ["primary_cta", "phone", "consultation"], required: true, priority: 50 },
    { type: "faq_block", factors: [], required: true, priority: 60 },
  ],
  hub: [
    { type: "description_block", factors: [], required: true, priority: 10 },
    { type: "navigation_block", factors: [], required: true, priority: 20 },
    { type: "advantages_block", factors: ["experience", "brands"], required: true, priority: 30 },
    { type: "cta_block", factors: ["primary_cta", "phone"], required: false, priority: 40 },
  ],
  article: [
    { type: "expert_block", factors: [], required: true, priority: 10 },
    { type: "links_block", factors: [], required: true, priority: 20 },
    { type: "cta_block", factors: ["primary_cta", "phone"], required: true, priority: 30 },
  ],
  informational: [
    { type: "expert_block", factors: [], required: true, priority: 10 },
    { type: "links_block", factors: [], required: true, priority: 20 },
    { type: "cta_block", factors: ["primary_cta", "phone"], required: true, priority: 30 },
  ],
  local: [
    { type: "trust_block", factors: ["company_name", "address", "working_hours"], required: true, priority: 10 },
    { type: "advantages_block", factors: ["experience"], required: true, priority: 20 },
    { type: "delivery_block", factors: ["delivery"], required: false, priority: 30 },
    { type: "cta_block", factors: ["primary_cta", "phone"], required: true, priority: 40 },
    { type: "faq_block", factors: [], required: true, priority: 50 },
  ],
  system: [],
};

export function blockSpecsFor(pageType: string): BlockSpec[] {
  return BLOCK_MATRIX[(pageType as CommercialPageType)] || [];
}

export const BLOCK_TITLES: Record<BlockType, { ru: string; en: string }> = {
  trust_block: { ru: "О компании", en: "About the company" },
  advantages_block: { ru: "Почему выбирают нас", en: "Why clients choose us" },
  delivery_block: { ru: "Доставка", en: "Delivery" },
  warranty_block: { ru: "Гарантия и возврат", en: "Warranty and returns" },
  payment_block: { ru: "Оплата", en: "Payment" },
  cta_block: { ru: "Как оформить заказ", en: "How to order" },
  faq_block: { ru: "Частые вопросы", en: "FAQ" },
  reviews_block: { ru: "Отзывы", en: "Reviews" },
  certificates_block: { ru: "Сертификаты", en: "Certificates" },
  description_block: { ru: "Описание", en: "Description" },
  specs_block: { ru: "Характеристики", en: "Specifications" },
  price_block: { ru: "Цена и расчет", en: "Price and quote" },
  assortment_block: { ru: "Ассортимент", en: "Range" },
  process_block: { ru: "Этапы работы", en: "How we work" },
  navigation_block: { ru: "Направления", en: "Sections" },
  expert_block: { ru: "Экспертный вывод", en: "Expert takeaway" },
  links_block: { ru: "Полезные разделы", en: "Related sections" },
};

/** 3. No invented facts: absent data is stated as pending, never guessed. */
export const MISSING_DATA_TEXT: Record<string, { ru: string; en: string }> = {
  delivery: { ru: "Условия доставки уточняются у менеджера.", en: "Delivery terms are confirmed by a manager." },
  payment: { ru: "Способы оплаты уточняются у менеджера.", en: "Payment options are confirmed by a manager." },
  warranty: { ru: "Информация о гарантии уточняется у менеджера.", en: "Warranty details are confirmed by a manager." },
  return: { ru: "Условия возврата уточняются у менеджера.", en: "Return terms are confirmed by a manager." },
  primary_cta: { ru: "Оставьте заявку на сайте, и менеджер свяжется с вами.", en: "Leave a request and a manager will contact you." },
  phone: { ru: "Контактный телефон указан в разделе контактов.", en: "The phone number is listed on the contacts page." },
  order_process: { ru: "Порядок оформления заказа уточняется у менеджера.", en: "The ordering process is confirmed by a manager." },
  experience: { ru: "Опыт работы компании уточняется.", en: "Company experience is being confirmed." },
  certificates: { ru: "Сертификаты предоставляются по запросу.", en: "Certificates are provided on request." },
  clients_cases: { ru: "Примеры работ предоставляются по запросу.", en: "Case examples are provided on request." },
  brands: { ru: "Перечень брендов уточняется у менеджера.", en: "The brand list is confirmed by a manager." },
  consultation: { ru: "Консультацию можно получить по контактам на сайте.", en: "A consultation is available via the site contacts." },
  address: { ru: "Адрес указан в разделе контактов.", en: "The address is listed on the contacts page." },
  working_hours: { ru: "График работы указан в разделе контактов.", en: "Working hours are listed on the contacts page." },
  company_name: { ru: "Реквизиты компании уточняются.", en: "Company details are being confirmed." },
};

export function missingDataText(factor: string, ru: boolean): string {
  const v = MISSING_DATA_TEXT[factor];
  if (v) return ru ? v.ru : v.en;
  return ru ? "Информация уточняется у менеджера." : "This information is confirmed by a manager.";
}

// ---------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------

export interface StoredBlock {
  block_type: string;
  title: string | null;
  content: string | null;
  priority: number | null;
  status: string | null;
  missing_factors?: unknown;
}

export type BlockStatus = "PASS" | "REVIEW" | "FAIL";

export interface PageBlockReport {
  page_type: string;
  required: string[];
  present: string[];
  missing_blocks: string[];
  missing_factors: string[];
  score: number;
  status: BlockStatus;
}

const filled = (b: StoredBlock) => String(b.content || "").replace(/<[^>]+>/g, " ").trim().length > 30;

export function assessPageBlocks(pageType: string, blocks: StoredBlock[]): PageBlockReport {
  const specs = blocksSorted(blockSpecsFor(pageType));
  const have = new Map<string, StoredBlock>();
  for (const b of blocks) if (filled(b)) have.set(String(b.block_type), b);

  const required = specs.filter((s) => s.required).map((s) => s.type);
  const present = specs.filter((s) => have.has(s.type)).map((s) => s.type);
  const missingBlocks = required.filter((r) => !have.has(r));

  const missingFactors = new Set<string>();
  for (const b of blocks) {
    const mf = Array.isArray(b.missing_factors) ? b.missing_factors : [];
    for (const f of mf) missingFactors.add(String(f));
  }

  const weight = (s: BlockSpec) => (s.required ? 2 : 1);
  const max = specs.reduce((a, s) => a + weight(s), 0) || 1;
  const got = specs.filter((s) => have.has(s.type)).reduce((a, s) => a + weight(s), 0);
  const score = Math.round((got / max) * 100);

  const status: BlockStatus = specs.length === 0
    ? "PASS"
    : missingBlocks.length > 0
      ? (missingBlocks.length >= Math.ceil(required.length / 2) ? "FAIL" : "REVIEW")
      : missingFactors.size > 0 ? "REVIEW" : "PASS";

  return {
    page_type: pageType,
    required,
    present,
    missing_blocks: missingBlocks,
    missing_factors: [...missingFactors],
    score: specs.length ? Math.min(100, Math.max(0, score)) : 100,
    status,
  };
}

export function blocksSorted(specs: BlockSpec[]): BlockSpec[] {
  return [...specs].sort((a, b) => a.priority - b.priority);
}

// ---------------------------------------------------------------------------
// 8. CommercialBlockRenderer (additive layer, never rewrites page content)
// ---------------------------------------------------------------------------

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const COMMERCIAL_BLOCK_CSS = `
.cbx{margin:28px 0;display:grid;gap:16px}
.cbx-item{border:1px solid rgba(0,0,0,.08);border-radius:10px;padding:16px 18px;background:rgba(0,0,0,.015)}
.cbx-item h2{margin:0 0 8px;font-size:1.15rem}
.cbx-item p{margin:0 0 8px;line-height:1.65}
.cbx-item ul{margin:0;padding-left:18px;line-height:1.7}
.cbx-note{opacity:.75;font-size:.92em}
`;

/** Renders stored commercial blocks as one HTML section, ordered by priority. */
export function renderCommercialBlocks(blocks: StoredBlock[], ru = true): string {
  const live = blocks
    .filter((b) => String(b.status || "ready") !== "archived" && filled(b))
    .sort((a, b) => (a.priority || 0) - (b.priority || 0));
  if (!live.length) return "";
  const parts = live.map((b) => {
    const type = String(b.block_type) as BlockType;
    const title = b.title || BLOCK_TITLES[type]?.[ru ? "ru" : "en"] || "";
    const body = /<(p|ul|ol|table|h[23])\b/i.test(String(b.content))
      ? String(b.content)
      : `<p>${esc(b.content)}</p>`;
    return `<section class="cbx-item cbx-${esc(type)}">${title ? `<h2>${esc(title)}</h2>` : ""}${body}</section>`;
  });
  return `<div class="cbx" data-layer="commercial">${parts.join("")}</div>`;
}

/** Inserts the commercial layer after page content, before footer / closing main. */
export function injectCommercialBlocks(html: string, blocksHtml: string): string {
  if (!blocksHtml) return html;
  if (html.includes('data-layer="commercial"')) return html;
  const withCss = /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `<style>${COMMERCIAL_BLOCK_CSS}</style>\n</head>`)
    : html;
  if (/<\/main>/i.test(withCss)) return withCss.replace(/<\/main>/i, `${blocksHtml}\n</main>`);
  if (/<footer\b/i.test(withCss)) return withCss.replace(/<footer\b/i, `${blocksHtml}\n<footer`);
  if (/<\/body>/i.test(withCss)) return withCss.replace(/<\/body>/i, `${blocksHtml}\n</body>`);
  return withCss + blocksHtml;
}

// ---------------------------------------------------------------------------
// 9. Commercial schema additions (no fake reviews, ever)
// ---------------------------------------------------------------------------

export interface SchemaOrgInput {
  companyName: string;
  url: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  hours?: string;
  isLocal?: boolean;
}

export function buildOrganizationSchema(i: SchemaOrgInput): Record<string, unknown> | null {
  if (!i.companyName) return null;
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": i.isLocal ? "LocalBusiness" : "Organization",
    name: i.companyName,
    url: i.url || undefined,
  };
  if (i.phone) node.telephone = i.phone;
  if (i.email) node.email = i.email;
  if (i.address || i.city) {
    node.address = {
      "@type": "PostalAddress",
      streetAddress: i.address || undefined,
      addressLocality: i.city || undefined,
      addressCountry: i.country || undefined,
    };
  }
  if (i.hours) node.openingHours = i.hours;
  return node;
}

export function buildOfferSchema(p: {
  price?: number | string | null;
  currency?: string | null;
  availability?: string | null;
  url?: string;
}): Record<string, unknown> | null {
  const price = Number(p.price);
  if (!price || price <= 0) return null;
  const av = String(p.availability || "").toLowerCase();
  return {
    "@type": "Offer",
    price: String(price),
    priceCurrency: p.currency || "RUB",
    availability: av.includes("out") || av.includes("нет")
      ? "https://schema.org/OutOfStock"
      : "https://schema.org/InStock",
    url: p.url || undefined,
  };
}

/** Only real, stored reviews produce AggregateRating. Never synthesized. */
export function buildAggregateRating(reviews: { rating?: number }[] | null | undefined) {
  const list = (reviews || []).filter((r) => Number(r?.rating) > 0);
  if (list.length < 1) return null;
  const value = list.reduce((a, r) => a + Number(r.rating), 0) / list.length;
  return {
    "@type": "AggregateRating",
    ratingValue: Math.round(value * 10) / 10,
    reviewCount: list.length,
  };
}

export function buildFaqSchema(faq: { q: string; a: string }[] | null | undefined) {
  const list = (faq || []).filter((f) => f?.q && f?.a);
  if (!list.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: list.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
