// ============================================================================
// P10 - UNIVERSAL PAGE QUALITY ENGINE (Commercial Quality Layer)
//
//   PDE -> PAGE TYPE -> QUALITY PROFILE -> CONTENT ENGINE -> QA -> BUILD
//
// PDE answers  : "does this page need to exist?"
// This layer   : "what must be on it so it is a complete page?"
//
// Pure + deterministic. No LLM, no DB, no network. Safe to import anywhere.
// ============================================================================

import type { PdeIntent, PdePageType } from "./pageDecision.ts";

export type FactorGroup =
  | "TRUST" | "COMMERCIAL" | "CONTENT" | "UX" | "SEO" | "LOCAL" | "STRUCTURE";

export type FactorLevel = "required" | "recommended" | "optional" | "na";

export type QualityStatus = "PASS" | "REVIEW" | "FAIL";

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

export interface QualityContent {
  h1?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  intro?: string | null;
  body?: { heading?: string; text?: string }[] | null;
  faq?: { q?: string; a?: string }[] | null;
  entities?: string[] | null;
  semantic_terms?: string[] | null;
  schema_data?: Record<string, unknown> | null;
}

export interface QualityEntity {
  /** catalog row facts (product / service offering) */
  price?: number | null;
  currency?: string | null;
  availability?: string | null;
  sku?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  characteristics?: Record<string, unknown> | unknown[] | null;
  benefits?: unknown[] | Record<string, unknown> | null;
  images?: string[] | null;
  description?: string | null;
  region?: string | null;
  variants?: unknown[] | null;
  certificates?: unknown[] | null;
  author?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
}

export interface QualityProject {
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  workHours?: string | null;
  region?: string | null;
  contacts?: string | null;
  deliveryInfo?: boolean;
  paymentInfo?: boolean;
  warrantyInfo?: boolean;
  authorName?: string | null;
  businessPages?: string[] | null;
}

export interface QualityCounts {
  products: number;
  services: number;
  children: number;
  keywords: number;
  relatedPages: number;
  relatedArticles: number;
  siblings: number;
}

export interface QualityInput {
  pageType: PdePageType;
  intent: PdeIntent;
  title: string;
  urlPath: string;
  hasOffer: boolean;
  demandScore: number;
  semanticScore: number;
  hasBreadcrumbs: boolean;
  content: QualityContent | null;
  entity: QualityEntity;
  project: QualityProject;
  counts: QualityCounts;
}

// ---------------------------------------------------------------------------
// Helpers (all tolerant to missing data)
// ---------------------------------------------------------------------------

const txt = (v: unknown): string => String(v ?? "").trim();
const has = (v: unknown): boolean => txt(v).length > 1;
const len = (v: unknown[] | null | undefined): number => (Array.isArray(v) ? v.length : 0);

function bodyText(c: QualityContent | null): string {
  if (!c) return "";
  const parts = [txt(c.intro)];
  for (const b of c.body || []) parts.push(txt(b?.heading), txt(b?.text));
  for (const f of c.faq || []) parts.push(txt(f?.q), txt(f?.a));
  return parts.join(" ");
}

function words(s: string): number {
  return s.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

function mentions(s: string, re: RegExp): boolean {
  return re.test(s.toLowerCase());
}

const RE = {
  delivery: /доставк|самовывоз|отгрузк|shipping|delivery/,
  payment: /оплат|наличн|безнал|счет|payment|invoice/,
  warranty: /гарант|возврат|обмен|warranty|return/,
  cta: /заказ|заявк|позвон|свяжитесь|консультац|купить|оставьте|запрос|contact|order|request/,
  process: /этап|шаг|как мы работаем|процесс|порядок работ|step|process/,
  audience: /для кого|подойдет|клиент|заказчик|audience/,
  scope: /что входит|объем работ|состав услуг|включа|scope/,
  timing: /срок|время выполнения|за \d+\s*(дн|час|недел)|timeline|lead time/,
  pricing: /цена|стоимость|от \d|прайс|price|pricing|расчет стоимости/,
  usage: /применен|использу|где нужн|для чего|назначен|application/,
  advantages: /преимуществ|почему|плюс|выгод|benefit|advantage/,
  address: /ул\.|улиц|просп|д\.\s?\d|адрес|address/,
  hours: /график|режим работы|с \d{1,2}:\d{2}|пн-|working hours/,
  geo: /город|район|обл\.|области|регион|выезд|zone|area/,
  sources: /источник|по данным|https?:\/\/|reference/,
};

function schemaHas(c: QualityContent | null, type: string): boolean {
  const raw = JSON.stringify(c?.schema_data ?? {}).toLowerCase();
  return raw.includes(`"${type.toLowerCase()}"`);
}

function characteristicsCount(e: QualityEntity): number {
  const ch = e.characteristics;
  if (!ch) return 0;
  if (Array.isArray(ch)) return ch.length;
  return Object.keys(ch as Record<string, unknown>).length;
}

// ---------------------------------------------------------------------------
// Factor model
// ---------------------------------------------------------------------------

export interface QualityFactor {
  key: string;
  name: string;
  group: FactorGroup;
  weight: number;
  /** requirement level for this concrete page; "na" = not applicable */
  level: (i: QualityInput) => FactorLevel;
  /** does the page satisfy the factor? */
  check: (i: QualityInput) => boolean;
}

const R = (): FactorLevel => "required";
const RC = (): FactorLevel => "recommended";
const OPT = (): FactorLevel => "optional";

/** conditional: required only when the condition holds, otherwise optional */
const cond = (fn: (i: QualityInput) => boolean) =>
  (i: QualityInput): FactorLevel => (fn(i) ? "required" : "optional");

// --- shared factor library --------------------------------------------------

const F = {
  h1: (): QualityFactor => ({
    key: "h1", name: "H1", group: "SEO", weight: 6, level: R,
    check: (i) => has(i.content?.h1),
  }),
  title: (): QualityFactor => ({
    key: "title", name: "Title", group: "SEO", weight: 6, level: R,
    check: (i) => {
      const t = txt(i.content?.seo_title);
      return t.length >= 15 && t.length <= 70;
    },
  }),
  description: (): QualityFactor => ({
    key: "description", name: "Meta description", group: "SEO", weight: 5, level: R,
    check: (i) => {
      const d = txt(i.content?.seo_description);
      return d.length >= 50 && d.length <= 180;
    },
  }),
  canonical: (): QualityFactor => ({
    key: "canonical", name: "Canonical URL", group: "SEO", weight: 3, level: R,
    check: (i) => /^\/[^\s]*$/.test(txt(i.urlPath)),
  }),
  schema: (type: string, weight = 5, level: QualityFactor["level"] = R): QualityFactor => ({
    key: `schema_${type.toLowerCase()}`, name: `${type} Schema`, group: "SEO", weight, level,
    check: (i) => schemaHas(i.content, type),
  }),
  breadcrumbs: (): QualityFactor => ({
    key: "breadcrumbs", name: "Breadcrumbs", group: "STRUCTURE", weight: 4, level: R,
    check: (i) => i.hasBreadcrumbs || schemaHas(i.content, "BreadcrumbList"),
  }),
  uniqueContent: (minWords: number, weight: number): QualityFactor => ({
    key: "unique_content", name: "Уникальный текст", group: "CONTENT", weight, level: R,
    check: (i) => words(bodyText(i.content)) >= minWords,
  }),
  intro: (): QualityFactor => ({
    key: "intro", name: "Вводный блок", group: "CONTENT", weight: 4, level: R,
    check: (i) => words(txt(i.content?.intro)) >= 25,
  }),
  faq: (level: QualityFactor["level"] = RC, weight = 8): QualityFactor => ({
    key: "faq", name: "FAQ", group: "CONTENT", weight, level,
    check: (i) => len(i.content?.faq) >= 3,
  }),
  entities: (level: QualityFactor["level"] = RC): QualityFactor => ({
    key: "entities", name: "Сущности / термины", group: "CONTENT", weight: 6, level,
    check: (i) => len(i.content?.entities) + len(i.content?.semantic_terms) >= 4,
  }),
  company: (): QualityFactor => ({
    key: "company", name: "Компания", group: "TRUST", weight: 4, level: R,
    check: (i) => has(i.project.companyName),
  }),
  contacts: (): QualityFactor => ({
    key: "contacts", name: "Контакты", group: "TRUST", weight: 6, level: R,
    check: (i) => has(i.project.phone) || has(i.project.email) || has(i.project.contacts),
  }),
  cta: (weight = 12): QualityFactor => ({
    key: "cta", name: "CTA / способ заказа", group: "COMMERCIAL", weight, level: R,
    check: (i) => mentions(bodyText(i.content), RE.cta)
      && (has(i.project.phone) || has(i.project.email) || has(i.project.contacts)),
  }),
  delivery: (level: QualityFactor["level"] = R, weight = 8): QualityFactor => ({
    key: "delivery", name: "Доставка", group: "COMMERCIAL", weight, level,
    check: (i) => i.project.deliveryInfo === true || mentions(bodyText(i.content), RE.delivery),
  }),
  payment: (level: QualityFactor["level"] = RC, weight = 7): QualityFactor => ({
    key: "payment", name: "Оплата", group: "COMMERCIAL", weight, level,
    check: (i) => i.project.paymentInfo === true || mentions(bodyText(i.content), RE.payment),
  }),
  warranty: (): QualityFactor => ({
    key: "warranty", name: "Гарантия / возврат", group: "COMMERCIAL", weight: 5,
    level: cond((i) => i.project.warrantyInfo === true || i.pageType === "product"),
    check: (i) => i.project.warrantyInfo === true || mentions(bodyText(i.content), RE.warranty),
  }),
  relatedArticles: (): QualityFactor => ({
    key: "related_articles", name: "Связанные статьи", group: "STRUCTURE", weight: 3, level: RC,
    check: (i) => i.counts.relatedArticles > 0,
  }),
  relatedPages: (name: string, level: QualityFactor["level"] = RC): QualityFactor => ({
    key: "related_pages", name, group: "STRUCTURE", weight: 4, level,
    check: (i) => i.counts.relatedPages > 0 || i.counts.siblings > 0,
  }),
  reviews: (): QualityFactor => ({
    key: "reviews", name: "Отзывы", group: "TRUST", weight: 3, level: OPT,
    check: (i) => mentions(bodyText(i.content), /отзыв|review|кейс/),
  }),
  ux: (): QualityFactor => ({
    key: "ux_structure", name: "Читаемая структура (H2)", group: "UX", weight: 5, level: RC,
    check: (i) => len(i.content?.body) >= 3,
  }),
  images: (level: QualityFactor["level"] = RC): QualityFactor => ({
    key: "images", name: "Изображения", group: "UX", weight: 4, level,
    check: (i) => len(i.entity.images) > 0,
  }),
};

// ---------------------------------------------------------------------------
// 16. PAGE TYPE MATRIX - single source of truth
// ---------------------------------------------------------------------------

export const PAGE_QUALITY_MATRIX: Record<PdePageType, QualityFactor[]> = {
  // ---------------------------- PRODUCT -------------------------------------
  product: [
    F.company(), F.contacts(),
    { key: "brand", name: "Бренд", group: "TRUST", weight: 3, level: RC,
      check: (i) => has(i.entity.brand) },
    { key: "manufacturer", name: "Производитель", group: "TRUST", weight: 2, level: OPT,
      check: (i) => has(i.entity.manufacturer) || has(i.entity.brand) },
    { key: "certificates", name: "Сертификаты", group: "TRUST", weight: 2,
      level: cond((i) => len(i.entity.certificates as unknown[]) > 0),
      check: (i) => len(i.entity.certificates as unknown[]) > 0 },
    { key: "price", name: "Цена", group: "COMMERCIAL", weight: 10, level: R,
      check: (i) => Number(i.entity.price) > 0 || mentions(bodyText(i.content), RE.pricing) },
    { key: "availability", name: "Наличие", group: "COMMERCIAL", weight: 10, level: R,
      check: (i) => has(i.entity.availability) },
    { key: "sku", name: "Артикул / SKU", group: "COMMERCIAL", weight: 4, level: RC,
      check: (i) => has(i.entity.sku) },
    { key: "characteristics", name: "Характеристики", group: "COMMERCIAL", weight: 12, level: R,
      check: (i) => characteristicsCount(i.entity) >= 3 },
    { key: "variants", name: "Модификации", group: "COMMERCIAL", weight: 2, level: OPT,
      check: (i) => len(i.entity.variants as unknown[]) > 0 },
    F.delivery(R, 8), F.payment(RC, 6), F.warranty(),
    F.cta(12),
    F.uniqueContent(120, 8), F.intro(),
    { key: "applications", name: "Применение", group: "CONTENT", weight: 5, level: RC,
      check: (i) => mentions(bodyText(i.content), RE.usage) },
    { key: "advantages", name: "Преимущества", group: "CONTENT", weight: 4, level: RC,
      check: (i) => mentions(bodyText(i.content), RE.advantages) },
    F.faq(RC, 6), F.images(RC), F.ux(), F.reviews(),
    F.breadcrumbs(),
    { key: "category_link", name: "Ссылка на категорию", group: "STRUCTURE", weight: 4, level: R,
      check: (i) => i.counts.relatedPages > 0 || /\/.+\/.+/.test(i.urlPath) },
    F.relatedPages("Похожие товары"), F.relatedArticles(),
    F.h1(), F.title(), F.description(), F.canonical(),
    F.schema("Product", 5), F.schema("Offer", 4), F.schema("BreadcrumbList", 3),
  ],

  // ---------------------------- CATEGORY ------------------------------------
  category: [
    F.company(), F.contacts(),
    { key: "listing", name: "Листинг товаров/подкатегорий", group: "COMMERCIAL", weight: 14,
      level: cond((i) => i.hasOffer || i.counts.children > 0),
      check: (i) => i.counts.products + i.counts.services + i.counts.children > 0 },
    { key: "category_intro", name: "Вводный текст категории", group: "CONTENT", weight: 8, level: R,
      check: (i) => words(txt(i.content?.intro)) >= 30 },
    { key: "filters", name: "Фильтры / навигация по ассортименту", group: "UX", weight: 3,
      level: cond((i) => i.counts.products >= 12),
      check: (i) => i.counts.products >= 12 && i.counts.children > 0 },
    { key: "commercial_info", name: "Коммерческая информация", group: "COMMERCIAL", weight: 8, level: R,
      check: (i) => mentions(bodyText(i.content), RE.pricing) || i.counts.products > 0 },
    F.delivery(RC, 6), F.payment(RC, 5), F.cta(10),
    F.uniqueContent(150, 8), F.faq(RC, 6), F.entities(RC), F.ux(),
    F.breadcrumbs(), F.relatedPages("Смежные категории", RC), F.relatedArticles(),
    F.h1(), F.title(), F.description(), F.canonical(),
    F.schema("CollectionPage", 4), F.schema("ItemList", 3, RC), F.schema("BreadcrumbList", 3),
  ],

  // ---------------------------- SERVICE -------------------------------------
  service: [
    F.company(), F.contacts(),
    { key: "service_scope", name: "Что входит в услугу", group: "COMMERCIAL", weight: 12, level: R,
      check: (i) => mentions(bodyText(i.content), RE.scope) },
    { key: "process", name: "Процесс работы", group: "COMMERCIAL", weight: 12, level: R,
      check: (i) => mentions(bodyText(i.content), RE.process) },
    { key: "audience", name: "Целевая аудитория", group: "CONTENT", weight: 5, level: RC,
      check: (i) => mentions(bodyText(i.content), RE.audience) },
    { key: "benefits", name: "Выгоды", group: "CONTENT", weight: 6, level: RC,
      check: (i) => mentions(bodyText(i.content), RE.advantages) || len(i.entity.benefits as unknown[]) > 0 },
    { key: "timing", name: "Сроки", group: "COMMERCIAL", weight: 6, level: RC,
      check: (i) => mentions(bodyText(i.content), RE.timing) },
    { key: "price", name: "Цена или способ расчета", group: "COMMERCIAL", weight: 8,
      level: cond((i) => Number(i.entity.price) > 0),
      check: (i) => Number(i.entity.price) > 0 || mentions(bodyText(i.content), RE.pricing) },
    { key: "guarantees", name: "Гарантии", group: "TRUST", weight: 5, level: RC,
      check: (i) => mentions(bodyText(i.content), RE.warranty) },
    { key: "region", name: "Регион оказания", group: "LOCAL", weight: 5, level: RC,
      check: (i) => has(i.entity.region) || has(i.project.region) || mentions(bodyText(i.content), RE.geo) },
    F.cta(12), F.uniqueContent(150, 8), F.intro(), F.faq(RC, 6), F.ux(), F.reviews(),
    F.breadcrumbs(), F.relatedPages("Смежные услуги", RC), F.relatedArticles(),
    F.h1(), F.title(), F.description(), F.canonical(),
    F.schema("Service", 5), F.schema("Provider", 3, RC), F.schema("BreadcrumbList", 3),
  ],

  // ------------------------- INFORMATIONAL ----------------------------------
  informational: [
    F.h1(), F.title(), F.description(), F.canonical(),
    F.uniqueContent(400, 18), F.intro(),
    F.entities(R),
    { key: "factual_content", name: "Фактура по теме", group: "CONTENT", weight: 10, level: R,
      check: (i) => len(i.content?.body) >= 3 && words(bodyText(i.content)) >= 500 },
    F.faq(RC, 8),
    { key: "author", name: "Автор / экспертиза", group: "TRUST", weight: 5, level: RC,
      check: (i) => has(i.entity.author) || has(i.project.authorName) },
    { key: "sources", name: "Источники", group: "TRUST", weight: 4, level: OPT,
      check: (i) => mentions(bodyText(i.content), RE.sources) },
    F.ux(),
    F.relatedPages("Связанные материалы", RC), F.relatedArticles(),
    { key: "commercial_cta", name: "Коммерческая ссылка", group: "COMMERCIAL", weight: 4, level: OPT,
      check: (i) => i.counts.relatedPages > 0 || mentions(bodyText(i.content), RE.cta) },
    F.breadcrumbs(),
    F.schema("Article", 4), F.schema("BreadcrumbList", 3),
  ],

  // ---------------------------- LOCAL ---------------------------------------
  local: [
    F.company(), F.contacts(),
    { key: "location", name: "Локация", group: "LOCAL", weight: 12, level: R,
      check: (i) => has(i.entity.region) || has(i.project.region) },
    { key: "service_area", name: "Зона обслуживания", group: "LOCAL", weight: 8, level: R,
      check: (i) => mentions(bodyText(i.content), RE.geo) || has(i.entity.region) },
    { key: "address", name: "Адрес", group: "LOCAL", weight: 6,
      level: cond((i) => has(i.project.address)),
      check: (i) => has(i.project.address) || mentions(bodyText(i.content), RE.address) },
    { key: "phone", name: "Телефон", group: "LOCAL", weight: 8, level: R,
      check: (i) => has(i.project.phone) },
    { key: "work_hours", name: "Часы работы", group: "LOCAL", weight: 5, level: RC,
      check: (i) => has(i.project.workHours) || mentions(bodyText(i.content), RE.hours) },
    { key: "map", name: "Карта / контактный блок", group: "UX", weight: 4, level: OPT,
      check: (i) => has(i.project.address) || has(i.project.contacts) },
    { key: "localized_offer", name: "Локализованное описание предложения", group: "CONTENT", weight: 10, level: R,
      check: (i) => words(bodyText(i.content)) >= 150 && mentions(bodyText(i.content), RE.geo) },
    F.cta(12), F.faq(RC, 6), F.ux(),
    F.breadcrumbs(), F.relatedPages("Связанные страницы", RC),
    F.h1(), F.title(), F.description(), F.canonical(),
    F.schema("LocalBusiness", 5), F.schema("BreadcrumbList", 3),
  ],

  // ----------------------------- HUB ----------------------------------------
  hub: [
    F.h1(), F.title(), F.description(), F.canonical(),
    { key: "topic", name: "Явная тема раздела", group: "CONTENT", weight: 8, level: R,
      check: (i) => has(i.title) && has(i.content?.h1) },
    { key: "hub_intro", name: "Осмысленное введение", group: "CONTENT", weight: 10, level: R,
      check: (i) => words(txt(i.content?.intro)) >= 40 },
    { key: "children", name: "Дочерние разделы", group: "STRUCTURE", weight: 16, level: R,
      check: (i) => i.counts.children + i.counts.products + i.counts.services > 0 },
    { key: "semantic_links", name: "Семантические связи", group: "STRUCTURE", weight: 8, level: RC,
      check: (i) => i.counts.keywords >= 2 || i.counts.relatedPages > 0 },
    F.uniqueContent(200, 10), F.entities(RC), F.ux(),
    F.relatedArticles(),
    { key: "commercial_links", name: "Коммерческие ссылки", group: "COMMERCIAL", weight: 5,
      level: cond((i) => i.hasOffer),
      check: (i) => i.counts.products + i.counts.services > 0 },
    F.contacts(),
    F.breadcrumbs(),
    F.schema("CollectionPage", 4, RC), F.schema("WebPage", 3, RC), F.schema("BreadcrumbList", 3),
  ],

  // ---------------------------- ARTICLE -------------------------------------
  article: [
    F.h1(), F.title(), F.description(), F.canonical(),
    F.uniqueContent(500, 18), F.intro(),
    { key: "author", name: "Автор", group: "TRUST", weight: 8, level: R,
      check: (i) => has(i.entity.author) || has(i.project.authorName) },
    { key: "dates", name: "Дата публикации / обновления", group: "SEO", weight: 6, level: R,
      check: (i) => has(i.entity.publishedAt) || has(i.entity.updatedAt) },
    F.entities(RC), F.faq(RC, 6), F.ux(),
    F.relatedArticles(),
    { key: "related_commercial", name: "Ссылки на коммерческие страницы", group: "STRUCTURE", weight: 5, level: RC,
      check: (i) => i.counts.relatedPages > 0 },
    F.breadcrumbs(),
    F.schema("Article", 5), F.schema("BreadcrumbList", 3),
  ],
};

// ---------------------------------------------------------------------------
// 12. Configurable thresholds
// ---------------------------------------------------------------------------

export const QUALITY_THRESHOLDS = {
  /** commercial_quality_score needed for PASS */
  pass: 70,
  /** below this score the page is FAIL even without missing required factors */
  hardFloor: 40,
  /** how many recommended factors may be missing while still PASS */
  maxMissingRecommended: 3,
};

// ---------------------------------------------------------------------------
// 11. Score formula (pure)
// ---------------------------------------------------------------------------

const COMMERCIAL_GROUPS: FactorGroup[] =
  ["TRUST", "COMMERCIAL", "CONTENT", "UX", "STRUCTURE", "LOCAL"];

export interface FactorResult {
  key: string;
  name: string;
  group: FactorGroup;
  level: Exclude<FactorLevel, "na">;
  weight: number;
  passed: boolean;
}

export function scoreFactors(results: FactorResult[], groups: FactorGroup[]): number {
  const applicable = results.filter((r) => groups.includes(r.group));
  const total = applicable.reduce((s, r) => s + r.weight, 0);
  if (!total) return 0;
  const got = applicable.reduce((s, r) => s + (r.passed ? r.weight : 0), 0);
  return Math.round((got / total) * 100);
}

// ---------------------------------------------------------------------------
// 13. Quality Check Engine
// ---------------------------------------------------------------------------

export interface QualityReport {
  page_type: PdePageType;
  quality_status: QualityStatus;
  commercial_score: number;
  seo_score: number;
  factors: FactorResult[];
  passed: string[];
  missing_required: string[];
  missing_recommended: string[];
  warnings: string[];
}

export function checkPageQuality(input: QualityInput): QualityReport {
  const matrix = PAGE_QUALITY_MATRIX[input.pageType] || PAGE_QUALITY_MATRIX.informational;
  const factors: FactorResult[] = [];

  for (const f of matrix) {
    const level = f.level(input);
    if (level === "na") continue;
    factors.push({
      key: f.key, name: f.name, group: f.group, level, weight: f.weight,
      passed: (() => { try { return !!f.check(input); } catch { return false; } })(),
    });
  }

  const commercial_score = scoreFactors(factors, COMMERCIAL_GROUPS);
  const seo_score = scoreFactors(factors, ["SEO"]);

  const missing_required = factors.filter((f) => f.level === "required" && !f.passed).map((f) => f.key);
  const missing_recommended = factors.filter((f) => f.level === "recommended" && !f.passed).map((f) => f.key);
  const passed = factors.filter((f) => f.passed).map((f) => f.key);

  const warnings: string[] = [];
  if (!input.content) warnings.push("no_content");
  if (input.pageType === "category" && input.counts.products + input.counts.children === 0) warnings.push("empty_category");
  if (input.pageType === "hub" && input.counts.children === 0) warnings.push("empty_hub");
  if (input.pageType === "product" && !input.hasOffer) warnings.push("missing_product_offer");
  if (input.pageType === "service" && missing_required.includes("cta")) warnings.push("missing_service_cta");
  if (input.pageType === "local" && missing_required.includes("location")) warnings.push("missing_local_data");
  if (input.pageType === "informational" && words(bodyText(input.content)) < 400) warnings.push("thin_informational");
  if (commercial_score < QUALITY_THRESHOLDS.pass) warnings.push("low_commercial_score");

  let quality_status: QualityStatus;
  if (missing_required.length > 0 || commercial_score < QUALITY_THRESHOLDS.hardFloor) {
    quality_status = "FAIL";
  } else if (
    commercial_score < QUALITY_THRESHOLDS.pass
    || missing_recommended.length > QUALITY_THRESHOLDS.maxMissingRecommended
  ) {
    quality_status = "REVIEW";
  } else {
    quality_status = "PASS";
  }

  return {
    page_type: input.pageType,
    quality_status,
    commercial_score,
    seo_score,
    factors,
    passed,
    missing_required,
    missing_recommended,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 17. Content Engine contract - what the next stage MUST cover
// ---------------------------------------------------------------------------

export interface ContentRequirement {
  key: string;
  name: string;
  group: FactorGroup;
  level: "required" | "recommended";
}

/** Required + recommended factors the Content Engine has to satisfy. */
export function contentRequirements(pageType: PdePageType, input?: QualityInput): ContentRequirement[] {
  const matrix = PAGE_QUALITY_MATRIX[pageType] || PAGE_QUALITY_MATRIX.informational;
  const probe = input || null;
  const out: ContentRequirement[] = [];
  for (const f of matrix) {
    const level = probe ? f.level(probe) : "required";
    if (level === "required" || level === "recommended") {
      out.push({ key: f.key, name: f.name, group: f.group, level });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 18. QA integration - map a report onto audit issues
// ---------------------------------------------------------------------------

export type QaLevel = "critical" | "warning" | "info";

export interface QualityAuditIssue { level: QaLevel; kind: string; page: string; detail?: string }

const CRITICAL_WARNINGS = new Set([
  "empty_category", "empty_hub", "missing_product_offer", "missing_local_data",
]);

export function qualityToAuditIssues(page: string, r: QualityReport): QualityAuditIssue[] {
  const out: QualityAuditIssue[] = [];
  for (const key of r.missing_required) {
    out.push({
      level: CRITICAL_WARNINGS.has(key) ? "critical" : "warning",
      kind: "missing_required_factor",
      page,
      detail: `${r.page_type}: ${key}`,
    });
  }
  for (const w of r.warnings) {
    out.push({
      level: CRITICAL_WARNINGS.has(w) ? "critical" : w === "low_commercial_score" ? "warning" : "info",
      kind: w,
      page,
      detail: `score ${r.commercial_score}`,
    });
  }
  for (const key of r.missing_recommended) {
    out.push({ level: "info", kind: "missing_recommended_factor", page, detail: key });
  }
  return out;
}
