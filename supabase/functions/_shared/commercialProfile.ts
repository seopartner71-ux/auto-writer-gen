// ============================================================================
// P11 - COMMERCIAL DATA FOUNDATION
//
// Single normalizer for the commercial project profile, product data and
// service data. Pure + deterministic: no DB, no LLM, no network.
//
// Rule: every fact here comes from user input. Nothing is invented, and
// anything missing is reported as Missing Data instead of being filled in.
// ============================================================================

const t = (v: unknown): string => String(v ?? "").trim();
const ok = (v: unknown): boolean => t(v).length > 1;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v.filter((x) => t(x)) : []);

export interface ProfileField {
  key: string;
  label: string;
  group: string;
  value: string;
  filled: boolean;
  source: "project" | "commercial_profile";
}

export interface CommercialProfile {
  // COMPANY
  companyName: string; legalName: string; description: string;
  positioning: string; experience: string;
  // CONTACTS
  phone: string; email: string; address: string; workingHours: string;
  // REGION
  country: string; region: string; city: string; serviceArea: string;
  // COMMERCIAL
  delivery: string; payment: string; warranty: string; returns: string;
  advantages: string[]; guarantees: string; certificates: string[];
  brands: string[]; orderMethod: string; quoteMethod: string;
  // TRUST
  yearsInBusiness: string; licenses: string[]; manufacturers: string[]; clients: string;
  // CTA
  primaryCta: string; secondaryCta: string; contactMethods: string[];
  // meta
  isTestData: boolean;
}

export interface ProjectRowLike { [k: string]: unknown }

export function readCommercialProfile(project: ProjectRowLike): CommercialProfile {
  const cp = (project.commercial_profile || {}) as Record<string, unknown>;
  const pick = (cpKey: string, projectKey?: string): string =>
    t(cp[cpKey]) || (projectKey ? t(project[projectKey]) : "");
  return {
    companyName: pick("company_name", "company_name"),
    legalName: pick("legal_name", "juridical_inn"),
    description: pick("description", "site_about"),
    positioning: pick("positioning", "site_positioning"),
    experience: pick("experience"),
    phone: pick("phone", "company_phone"),
    email: pick("email", "company_email"),
    address: pick("address", "company_address"),
    workingHours: pick("working_hours", "work_hours"),
    country: pick("country"),
    region: pick("region", "region"),
    city: pick("city"),
    serviceArea: pick("service_area"),
    delivery: pick("delivery"),
    payment: pick("payment"),
    warranty: pick("warranty"),
    returns: pick("returns"),
    advantages: arr(cp.advantages).map(t),
    guarantees: pick("guarantees"),
    certificates: arr(cp.certificates).map(t),
    brands: arr(cp.brands).map(t),
    orderMethod: pick("order_method"),
    quoteMethod: pick("quote_method"),
    yearsInBusiness: pick("years_in_business") || t(project.founding_year),
    licenses: arr(cp.licenses).map(t),
    manufacturers: arr(cp.manufacturers).map(t),
    clients: pick("clients", "clients_count_text"),
    primaryCta: pick("primary_cta"),
    secondaryCta: pick("secondary_cta"),
    contactMethods: arr(cp.contact_methods).map(t),
    isTestData: cp.is_test_data === true,
  };
}

// --- coverage ---------------------------------------------------------------

interface Spec { key: string; label: string; group: string; weight: number; get: (p: CommercialProfile) => string }

const j = (v: string[]) => v.join(", ");

export const PROFILE_SPEC: Spec[] = [
  { key: "company_name", label: "Название компании", group: "Компания", weight: 8, get: (p) => p.companyName },
  { key: "legal_name", label: "Юридическое лицо / ИНН", group: "Компания", weight: 2, get: (p) => p.legalName },
  { key: "description", label: "Описание", group: "Компания", weight: 5, get: (p) => p.description },
  { key: "positioning", label: "Позиционирование", group: "Компания", weight: 4, get: (p) => p.positioning },
  { key: "experience", label: "Опыт", group: "Компания", weight: 3, get: (p) => p.experience },

  { key: "phone", label: "Телефон", group: "Контакты", weight: 8, get: (p) => p.phone },
  { key: "email", label: "E-mail", group: "Контакты", weight: 5, get: (p) => p.email },
  { key: "address", label: "Адрес", group: "Контакты", weight: 4, get: (p) => p.address },
  { key: "working_hours", label: "Часы работы", group: "Контакты", weight: 3, get: (p) => p.workingHours },

  { key: "country", label: "Страна", group: "Регион", weight: 2, get: (p) => p.country },
  { key: "region", label: "Регион", group: "Регион", weight: 3, get: (p) => p.region },
  { key: "city", label: "Город", group: "Регион", weight: 3, get: (p) => p.city },
  { key: "service_area", label: "Зона обслуживания", group: "Регион", weight: 3, get: (p) => p.serviceArea },

  { key: "delivery", label: "Доставка", group: "Доставка", weight: 8, get: (p) => p.delivery },
  { key: "payment", label: "Оплата", group: "Оплата", weight: 7, get: (p) => p.payment },
  { key: "warranty", label: "Гарантия", group: "Гарантия", weight: 7, get: (p) => p.warranty },
  { key: "returns", label: "Возврат", group: "Гарантия", weight: 3, get: (p) => p.returns },

  { key: "advantages", label: "Почему выбирают", group: "Почему выбирают", weight: 5, get: (p) => j(p.advantages) },
  { key: "guarantees", label: "Обязательства", group: "Почему выбирают", weight: 3, get: (p) => p.guarantees },
  { key: "brands", label: "Бренды", group: "Почему выбирают", weight: 2, get: (p) => j(p.brands) },

  { key: "order_method", label: "Как оформить заказ", group: "CTA", weight: 6, get: (p) => p.orderMethod },
  { key: "quote_method", label: "Как получить расчет", group: "CTA", weight: 4, get: (p) => p.quoteMethod },
  { key: "primary_cta", label: "Основной CTA", group: "CTA", weight: 6, get: (p) => p.primaryCta },
  { key: "secondary_cta", label: "Дополнительный CTA", group: "CTA", weight: 2, get: (p) => p.secondaryCta },
  { key: "contact_methods", label: "Каналы связи", group: "CTA", weight: 3, get: (p) => j(p.contactMethods) },

  { key: "years_in_business", label: "Лет на рынке", group: "Доверие", weight: 3, get: (p) => p.yearsInBusiness },
  { key: "licenses", label: "Лицензии", group: "Доверие", weight: 2, get: (p) => j(p.licenses) },
  { key: "certificates", label: "Сертификаты", group: "Доверие", weight: 3, get: (p) => j(p.certificates) },
  { key: "manufacturers", label: "Производители", group: "Доверие", weight: 2, get: (p) => j(p.manufacturers) },
  { key: "clients", label: "Клиенты / кейсы", group: "Доверие", weight: 2, get: (p) => p.clients },
];

export interface ProfileCoverage {
  score: number;
  filled: number;
  total: number;
  fields: ProfileField[];
  missing: string[];
  byGroup: Record<string, { filled: number; total: number }>;
}

export function profileCoverage(p: CommercialProfile): ProfileCoverage {
  const fields: ProfileField[] = [];
  const byGroup: Record<string, { filled: number; total: number }> = {};
  let got = 0, max = 0;
  for (const s of PROFILE_SPEC) {
    const value = s.get(p);
    const filled = ok(value);
    max += s.weight;
    if (filled) got += s.weight;
    byGroup[s.group] = byGroup[s.group] || { filled: 0, total: 0 };
    byGroup[s.group].total++;
    if (filled) byGroup[s.group].filled++;
    fields.push({
      key: s.key, label: s.label, group: s.group, value,
      filled, source: "commercial_profile",
    });
  }
  return {
    score: max ? Math.round((got / max) * 100) : 0,
    filled: fields.filter((f) => f.filled).length,
    total: fields.length,
    fields,
    missing: fields.filter((f) => !f.filled).map((f) => f.key),
    byGroup,
  };
}

// --- product / service data foundation --------------------------------------

export interface EntityCoverage { score: number; missing: string[]; present: string[] }

const chCount = (v: unknown): number =>
  Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v as object).length : 0;

const PRODUCT_SPEC: { key: string; weight: number; get: (r: ProjectRowLike) => boolean }[] = [
  { key: "name", weight: 10, get: (r) => ok(r.name) },
  { key: "sku", weight: 6, get: (r) => ok(r.sku) },
  { key: "brand", weight: 6, get: (r) => ok(r.brand) },
  { key: "price", weight: 12, get: (r) => Number(r.price) > 0 },
  { key: "currency", weight: 3, get: (r) => ok(r.currency) },
  { key: "availability", weight: 10, get: (r) => ok(r.availability) },
  { key: "description", weight: 10, get: (r) => t(r.description).length > 40 },
  { key: "characteristics", weight: 14, get: (r) => chCount(r.characteristics) >= 3 },
  { key: "images", weight: 6, get: (r) => arr(r.images).length > 0 },
  { key: "category", weight: 8, get: (r) => !!r.site_cluster_id },
  { key: "silo", weight: 5, get: (r) => !!r.silo_id },
  { key: "region", weight: 4, get: (r) => ok(r.region) },
  { key: "benefits", weight: 6, get: (r) => arr(r.benefits).length > 0 },
];

const SERVICE_SPEC: { key: string; weight: number; get: (r: ProjectRowLike, m: Record<string, unknown>) => boolean }[] = [
  { key: "service_name", weight: 10, get: (r) => ok(r.name) },
  { key: "description", weight: 12, get: (r) => t(r.description).length > 40 },
  { key: "scope", weight: 14, get: (_r, m) => ok(m.scope) || arr(m.scope).length > 0 },
  { key: "process", weight: 12, get: (_r, m) => ok(m.process) || arr(m.process).length > 0 },
  { key: "duration", weight: 8, get: (_r, m) => ok(m.duration) },
  { key: "pricing_method", weight: 12, get: (r, m) => ok(m.pricing_method) || Number(r.price) > 0 },
  { key: "benefits", weight: 8, get: (r, m) => arr(r.benefits).length > 0 || arr(m.benefits).length > 0 },
  { key: "warranty", weight: 8, get: (_r, m) => ok(m.warranty) },
  { key: "region", weight: 8, get: (r) => ok(r.region) },
  { key: "cta", weight: 8, get: (_r, m) => ok(m.cta) },
];

export function productCoverage(row: ProjectRowLike): EntityCoverage {
  let got = 0, max = 0;
  const missing: string[] = [], present: string[] = [];
  for (const s of PRODUCT_SPEC) {
    max += s.weight;
    if (s.get(row)) { got += s.weight; present.push(s.key); } else missing.push(s.key);
  }
  return { score: max ? Math.round((got / max) * 100) : 0, missing, present };
}

export function serviceCoverage(row: ProjectRowLike): EntityCoverage {
  const meta = (row.service_meta || {}) as Record<string, unknown>;
  let got = 0, max = 0;
  const missing: string[] = [], present: string[] = [];
  for (const s of SERVICE_SPEC) {
    max += s.weight;
    if (s.get(row, meta)) { got += s.weight; present.push(s.key); } else missing.push(s.key);
  }
  return { score: max ? Math.round((got / max) * 100) : 0, missing, present };
}

/** True service offering, not just kind=service. */
export function isRealService(row: ProjectRowLike): boolean {
  return serviceCoverage(row).score >= 50;
}

// --- prompt facts -----------------------------------------------------------

/** Only non-empty facts, so the model can never read an empty slot as licence to invent. */
export function profileFacts(p: CommercialProfile): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (Array.isArray(v) ? v.length : ok(v)) out[k] = v;
  };
  put("company", p.companyName);
  put("positioning", p.positioning);
  put("experience", p.experience);
  put("years_in_business", p.yearsInBusiness);
  put("phone", p.phone);
  put("email", p.email);
  put("address", p.address);
  put("working_hours", p.workingHours);
  put("region", [p.city, p.region, p.country].filter(Boolean).join(", "));
  put("service_area", p.serviceArea);
  put("delivery", p.delivery);
  put("payment", p.payment);
  put("warranty", p.warranty);
  put("returns", p.returns);
  put("guarantees", p.guarantees);
  put("advantages", p.advantages);
  put("brands", p.brands);
  put("certificates", p.certificates);
  put("licenses", p.licenses);
  put("manufacturers", p.manufacturers);
  put("order_method", p.orderMethod);
  put("quote_method", p.quoteMethod);
  put("primary_cta", p.primaryCta);
  put("secondary_cta", p.secondaryCta);
  put("contact_methods", p.contactMethods);
  put("clients", p.clients);
  return out;
}

/** Commercial facts the quality layer looks for in project data. */
export function qualityProjectFromProfile(p: CommercialProfile) {
  return {
    companyName: p.companyName || null,
    phone: p.phone || null,
    email: p.email || null,
    address: p.address || null,
    workHours: p.workingHours || null,
    region: [p.city, p.region].filter(Boolean).join(", ") || null,
    contacts: [p.phone, p.email, p.contactMethods.join(" "), p.orderMethod].filter(Boolean).join(" ") || null,
    deliveryInfo: ok(p.delivery),
    paymentInfo: ok(p.payment),
    warrantyInfo: ok(p.warranty) || ok(p.returns),
  };
}
