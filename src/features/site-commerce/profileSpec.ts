// P11 - client mirror of the commercial profile spec (supabase/functions/_shared/commercialProfile.ts).
// Keys and weights must stay in sync with the edge module.

export type FieldType = "text" | "textarea" | "list";

export interface ProfileFieldSpec {
  key: string;
  label: string;
  group: string;
  weight: number;
  type: FieldType;
  /** legacy project column used as a fallback value */
  legacy?: string;
  placeholder?: string;
}

export const PROFILE_GROUPS = [
  "Компания", "Контакты", "Регион", "Доставка", "Оплата",
  "Гарантия", "Почему выбирают", "CTA", "Доверие",
] as const;

export const PROFILE_FIELDS: ProfileFieldSpec[] = [
  { key: "company_name", label: "Название компании", group: "Компания", weight: 8, type: "text", legacy: "company_name" },
  { key: "legal_name", label: "Юридическое лицо / ИНН", group: "Компания", weight: 2, type: "text", legacy: "juridical_inn" },
  { key: "description", label: "Описание", group: "Компания", weight: 5, type: "textarea", legacy: "site_about" },
  { key: "positioning", label: "Позиционирование", group: "Компания", weight: 4, type: "textarea", legacy: "site_positioning" },
  { key: "experience", label: "Опыт", group: "Компания", weight: 3, type: "text" },

  { key: "phone", label: "Телефон", group: "Контакты", weight: 8, type: "text", legacy: "company_phone" },
  { key: "email", label: "E-mail", group: "Контакты", weight: 5, type: "text", legacy: "company_email" },
  { key: "address", label: "Адрес", group: "Контакты", weight: 4, type: "text", legacy: "company_address" },
  { key: "working_hours", label: "Часы работы", group: "Контакты", weight: 3, type: "text", legacy: "work_hours" },

  { key: "country", label: "Страна", group: "Регион", weight: 2, type: "text" },
  { key: "region", label: "Регион", group: "Регион", weight: 3, type: "text", legacy: "region" },
  { key: "city", label: "Город", group: "Регион", weight: 3, type: "text" },
  { key: "service_area", label: "Зона обслуживания", group: "Регион", weight: 3, type: "text" },

  { key: "delivery", label: "Доставка", group: "Доставка", weight: 8, type: "textarea" },
  { key: "payment", label: "Оплата", group: "Оплата", weight: 7, type: "textarea" },
  { key: "warranty", label: "Гарантия", group: "Гарантия", weight: 7, type: "textarea" },
  { key: "returns", label: "Возврат", group: "Гарантия", weight: 3, type: "textarea" },

  { key: "advantages", label: "Почему выбирают", group: "Почему выбирают", weight: 5, type: "list" },
  { key: "guarantees", label: "Обязательства", group: "Почему выбирают", weight: 3, type: "textarea" },
  { key: "brands", label: "Бренды", group: "Почему выбирают", weight: 2, type: "list" },

  { key: "order_method", label: "Как оформить заказ", group: "CTA", weight: 6, type: "textarea" },
  { key: "quote_method", label: "Как получить расчет", group: "CTA", weight: 4, type: "textarea" },
  { key: "primary_cta", label: "Основной CTA", group: "CTA", weight: 6, type: "text" },
  { key: "secondary_cta", label: "Дополнительный CTA", group: "CTA", weight: 2, type: "text" },
  { key: "contact_methods", label: "Каналы связи", group: "CTA", weight: 3, type: "list" },

  { key: "years_in_business", label: "Лет на рынке", group: "Доверие", weight: 3, type: "text", legacy: "founding_year" },
  { key: "licenses", label: "Лицензии", group: "Доверие", weight: 2, type: "list" },
  { key: "certificates", label: "Сертификаты", group: "Доверие", weight: 3, type: "list" },
  { key: "manufacturers", label: "Производители", group: "Доверие", weight: 2, type: "list" },
  { key: "clients", label: "Клиенты / кейсы", group: "Доверие", weight: 2, type: "text", legacy: "clients_count_text" },
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
