export type MonitorKey =
  | "title" | "description" | "headings" | "content" | "word_count" | "images" | "alt"
  | "internal_links" | "external_links" | "faq" | "tables" | "lists" | "cta"
  | "schema" | "canonical" | "robots" | "prices";

export const MONITOR_KEYS: { key: MonitorKey; ru: string; en: string }[] = [
  { key: "title", ru: "Title", en: "Title" },
  { key: "description", ru: "Meta Description", en: "Meta Description" },
  { key: "headings", ru: "Заголовки H1-H6", en: "Headings H1-H6" },
  { key: "content", ru: "Основной текст", en: "Main content" },
  { key: "word_count", ru: "Объем текста", en: "Word count" },
  { key: "images", ru: "Изображения", en: "Images" },
  { key: "alt", ru: "Атрибуты alt", en: "Alt attributes" },
  { key: "internal_links", ru: "Внутренние ссылки", en: "Internal links" },
  { key: "external_links", ru: "Внешние ссылки", en: "External links" },
  { key: "faq", ru: "FAQ", en: "FAQ" },
  { key: "tables", ru: "Таблицы", en: "Tables" },
  { key: "lists", ru: "Списки", en: "Lists" },
  { key: "cta", ru: "CTA и кнопки", en: "CTA / buttons" },
  { key: "schema", ru: "Schema.org", en: "Schema.org" },
  { key: "canonical", ru: "Canonical", en: "Canonical" },
  { key: "robots", ru: "Robots", en: "Robots" },
  { key: "prices", ru: "Цены и коммерция", en: "Price / commercial info" },
];

export const FREQUENCIES: { value: string; ru: string; en: string }[] = [
  { value: "daily", ru: "Ежедневно", en: "Daily" },
  { value: "twice_week", ru: "2 раза в неделю", en: "2x per week" },
  { value: "weekly", ru: "1 раз в неделю", en: "Weekly" },
  { value: "manual", ru: "Вручную", en: "Manual" },
];

export const SEVERITY_META: Record<string, { ru: string; en: string; className: string }> = {
  low: { ru: "Низкая", en: "Low", className: "bg-muted text-muted-foreground" },
  medium: { ru: "Средняя", en: "Medium", className: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30" },
  high: { ru: "Высокая", en: "High", className: "bg-orange-500/15 text-orange-500 border-orange-500/30" },
  critical: { ru: "Критичная", en: "Critical", className: "bg-red-500/15 text-red-500 border-red-500/30" },
};

export function defaultMonitorConfig(): Record<MonitorKey, boolean> {
  return MONITOR_KEYS.reduce((acc, m) => { acc[m.key] = true; return acc; }, {} as Record<MonitorKey, boolean>);
}

/** Short human summary of a change row, e.g. "+420 слов, 3 FAQ, Title изменен". */
export function summarizeChange(summary: Record<string, unknown> | null | undefined, ru: boolean): string {
  const s = (summary || {}) as Record<string, number | boolean>;
  const parts: string[] = [];
  const wd = Number(s.words_delta || 0);
  if (wd) parts.push(`${wd > 0 ? "+" : ""}${wd} ${ru ? "слов" : "words"}`);
  if (s.h2_added) parts.push(`+${s.h2_added} H2`);
  if (s.headings_removed) parts.push(`-${s.headings_removed} ${ru ? "заголовков" : "headings"}`);
  if (s.faq_added) parts.push(`+${s.faq_added} FAQ`);
  if (s.tables_added) parts.push(`+${s.tables_added} ${ru ? "таблиц" : "tables"}`);
  if (s.internal_links_added) parts.push(`+${s.internal_links_added} ${ru ? "внутр. ссылок" : "internal links"}`);
  if (s.prices_added || s.prices_removed) parts.push(ru ? "изменены цены" : "prices changed");
  if (s.title_changed) parts.push(ru ? "Title изменен" : "Title changed");
  if (s.h1_changed) parts.push(ru ? "H1 изменен" : "H1 changed");
  if (s.description_changed) parts.push(ru ? "Description изменен" : "Description changed");
  if (!parts.length) parts.push(ru ? "мелкие правки" : "minor edits");
  return parts.join(", ");
}
