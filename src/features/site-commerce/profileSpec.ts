// P11 - client mirror of the commercial profile spec (supabase/functions/_shared/commercialProfile.ts).
// Keys and weights must stay in sync with the edge module.

export type FieldType = "text" | "textarea" | "list";

/**
 * req = "required"  - без него страницы падают в FAIL (обязательные факторы Quality Layer)
 * req = "important" - сильно влияет на commercial_score
 * req = "optional"  - желательно
 */
export type FieldReq = "required" | "important" | "optional";

export interface ProfileFieldSpec {
  key: string;
  label: string;
  group: string;
  weight: number;
  type: FieldType;
  req: FieldReq;
  hint?: string;
  /** legacy project column used as a fallback value */
  legacy?: string;
  placeholder?: string;
}

export const PROFILE_GROUPS = [
  "Компания", "Контакты", "Регион", "Доставка", "Оплата",
  "Гарантия", "Почему выбирают", "CTA", "Доверие",
] as const;

export const PROFILE_FIELDS: ProfileFieldSpec[] = [
  { key: "company_name", label: "Название компании", group: "Компания", weight: 8, type: "text", req: "required", hint: "Фактор TRUST: без него все страницы FAIL", legacy: "company_name" },
  { key: "legal_name", label: "Юридическое лицо / ИНН", group: "Компания", weight: 2, type: "text", req: "optional", legacy: "juridical_inn" },
  { key: "description", label: "Описание", group: "Компания", weight: 5, type: "textarea", req: "important", hint: "Источник фактов для вводных блоков", legacy: "site_about" },
  { key: "positioning", label: "Позиционирование", group: "Компания", weight: 4, type: "textarea", req: "important", legacy: "site_positioning" },
  { key: "experience", label: "Опыт", group: "Компания", weight: 3, type: "text", req: "optional" },

  { key: "phone", label: "Телефон", group: "Контакты", weight: 8, type: "text", req: "required", hint: "Фактор TRUST + CTA: нужен телефон или e-mail", legacy: "company_phone" },
  { key: "email", label: "E-mail", group: "Контакты", weight: 5, type: "text", req: "important", legacy: "company_email" },
  { key: "address", label: "Адрес", group: "Контакты", weight: 4, type: "text", req: "important", hint: "Обязателен для локальных страниц", legacy: "company_address" },
  { key: "working_hours", label: "Часы работы", group: "Контакты", weight: 3, type: "text", req: "important", legacy: "work_hours" },

  { key: "country", label: "Страна", group: "Регион", weight: 2, type: "text", req: "optional" },
  { key: "region", label: "Регион", group: "Регион", weight: 3, type: "text", req: "important", legacy: "region" },
  { key: "city", label: "Город", group: "Регион", weight: 3, type: "text", req: "important", hint: "Обязателен, если есть локальные страницы" },
  { key: "service_area", label: "Зона обслуживания", group: "Регион", weight: 3, type: "text", req: "optional" },

  { key: "delivery", label: "Доставка", group: "Доставка", weight: 8, type: "textarea", req: "required", hint: "Обязательный фактор для товарных страниц" },
  { key: "payment", label: "Оплата", group: "Оплата", weight: 7, type: "textarea", req: "important" },
  { key: "warranty", label: "Гарантия", group: "Гарантия", weight: 7, type: "textarea", req: "required", hint: "Обязательна для страниц товаров" },
  { key: "returns", label: "Возврат", group: "Гарантия", weight: 3, type: "textarea", req: "optional" },

  { key: "advantages", label: "Почему выбирают", group: "Почему выбирают", weight: 5, type: "list", req: "important" },
  { key: "guarantees", label: "Обязательства", group: "Почему выбирают", weight: 3, type: "textarea", req: "optional" },
  { key: "brands", label: "Бренды", group: "Почему выбирают", weight: 2, type: "list", req: "optional" },

  { key: "order_method", label: "Как оформить заказ", group: "CTA", weight: 6, type: "textarea", req: "required", hint: "Фактор CTA - обязателен для всех коммерческих страниц" },
  { key: "quote_method", label: "Как получить расчет", group: "CTA", weight: 4, type: "textarea", req: "important", hint: "Обязателен для страниц услуг" },
  { key: "primary_cta", label: "Основной CTA", group: "CTA", weight: 6, type: "text", req: "required", hint: "Например: Оставить заявку" },
  { key: "secondary_cta", label: "Дополнительный CTA", group: "CTA", weight: 2, type: "text", req: "optional" },
  { key: "contact_methods", label: "Каналы связи", group: "CTA", weight: 3, type: "list", req: "important" },

  { key: "years_in_business", label: "Лет на рынке", group: "Доверие", weight: 3, type: "text", req: "optional", legacy: "founding_year" },
  { key: "licenses", label: "Лицензии", group: "Доверие", weight: 2, type: "list", req: "optional" },
  { key: "certificates", label: "Сертификаты", group: "Доверие", weight: 3, type: "list", req: "optional" },
  { key: "manufacturers", label: "Производители", group: "Доверие", weight: 2, type: "list", req: "optional" },
  { key: "clients", label: "Клиенты / кейсы", group: "Доверие", weight: 2, type: "text", req: "optional", legacy: "clients_count_text" },
];

export type ProfileValues = Record<string, string | string[] | boolean | undefined>;

export function fieldValue(
  f: ProfileFieldSpec,
  profile: ProfileValues,
  project: Record<string, unknown>,
): string {
  const raw = profile[f.key];
  const asText = Array.isArray(raw) ? raw.join(", ") : String(raw ?? "").trim();
  if (asText) return asText;
  return f.legacy ? String(project[f.legacy] ?? "").trim() : "";
}

export function coverageOf(profile: ProfileValues, project: Record<string, unknown>) {
  let got = 0, max = 0, filled = 0;
  const missing: string[] = [];
  for (const f of PROFILE_FIELDS) {
    max += f.weight;
    if (fieldValue(f, profile, project).length > 1) { got += f.weight; filled++; }
    else missing.push(f.key);
  }
  return { score: max ? Math.round((got / max) * 100) : 0, filled, total: PROFILE_FIELDS.length, missing };
}

/** Незаполненные поля в разбивке по уровню обязательности. */
export function requirementStatus(profile: ProfileValues, project: Record<string, unknown>) {
  const missingRequired: ProfileFieldSpec[] = [];
  const missingImportant: ProfileFieldSpec[] = [];
  let requiredTotal = 0;
  for (const f of PROFILE_FIELDS) {
    const filled = fieldValue(f, profile, project).length > 1;
    if (f.req === "required") {
      requiredTotal++;
      if (!filled) missingRequired.push(f);
    } else if (f.req === "important" && !filled) {
      missingImportant.push(f);
    }
  }
  return {
    requiredTotal,
    requiredFilled: requiredTotal - missingRequired.length,
    missingRequired,
    missingImportant,
    ready: missingRequired.length === 0,
  };
}
