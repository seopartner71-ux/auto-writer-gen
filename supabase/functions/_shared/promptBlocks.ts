// Общие блоки для system-промтов универсального генератора.
// Собирают из document_types.*_config и client.anchors[]/client_pages[]
// человеко-читаемые инструкции для модели + подставляют {{переменные}}
// в system_prompt_template.

export interface ClientAnchor {
  id: string;
  text: string;
  text_variants?: string[];
  target_url: string;
  priority?: "high" | "medium" | "low";
  archived?: boolean;
}

export interface ClientPage {
  url: string;
  title?: string;
  description?: string;
  h1?: string;
  archived?: boolean;
}

export function parseAnchors(raw: unknown): ClientAnchor[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a: any) => a && typeof a === "object")
    .map((a: any) => ({
      id: String(a.id || crypto.randomUUID()),
      text: String(a.text || "").trim(),
      text_variants: Array.isArray(a.text_variants)
        ? a.text_variants.map((v: unknown) => String(v || "").trim()).filter(Boolean).slice(0, 8)
        : [],
      target_url: String(a.target_url || "").trim(),
      priority: (a.priority === "high" || a.priority === "low") ? a.priority : "medium",
      archived: Boolean(a.archived),
    }))
    .filter((a) => a.text && /^https?:\/\//i.test(a.target_url) && !a.archived);
}

export function parseClientPages(raw: unknown): ClientPage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p: any) => p && typeof p === "object")
    .map((p: any) => ({
      url: String(p.url || "").trim(),
      title: String(p.title || "").trim(),
      description: String(p.description || "").trim(),
      h1: String(p.h1 || "").trim(),
      archived: Boolean(p.archived),
    }))
    .filter((p) => /^https?:\/\//i.test(p.url) && !p.archived);
}

export interface AnchorsConfig {
  count_min?: number;
  count_max?: number;
  placement?: "body" | "final" | "both";
}

export interface ClientPagesConfig {
  count_min?: number;
  count_max?: number;
  placement_rules?: "by_h2" | "anywhere";
}

export function buildAnchorsBlock(
  anchors: ClientAnchor[],
  cfg: AnchorsConfig | null | undefined,
  ecosystemId: string,
): string {
  const min = Math.max(0, Number(cfg?.count_min ?? 0));
  const max = Math.max(min, Number(cfg?.count_max ?? 2));
  if (anchors.length === 0 || max === 0) return "";
  const placement = cfg?.placement || "body";
  const placementRule =
    placement === "final" ? "только в финальном блоке" :
    placement === "both" ? "в любом месте текста, включая финальный блок" :
    "в основной части текста (НЕ в финальном блоке)";
  const list = anchors.slice(0, 15).map((a) => {
    const forms = [a.text, ...(a.text_variants || [])].filter(Boolean).map((f) => `"${f}"`).join(" / ");
    return `- Формы: ${forms} → URL: ${a.target_url} (приоритет: ${a.priority || "medium"})`;
  }).join("\n");
  return "\n\n## Контекстные ссылки клиента (anchors)\n" +
    `Вставь ${min}-${max} ссылок ${placementRule} из этого пула SEO-якорей клиента:\n${list}\n\n` +
    "Правила:\n" +
    "- Используй ТОЛЬКО одну из одобренных форм (без изменения окончаний).\n" +
    "- Одна ссылка = одна форма якоря + соответствующий URL из той же строки.\n" +
    `- Формат: [Форма](URL?utm_source=ecosystem&utm_medium=document&utm_campaign=ecosystem_${ecosystemId}&utm_content=anchor_N) где N=1,2,...\n` +
    "- Приоритет high — предпочитай их при равнозначном контексте.\n" +
    `- Если ни один якорь не подходит по смыслу — вставь минимум (${min}).`;
}

export function buildClientPagesBlock(
  pages: ClientPage[],
  cfg: ClientPagesConfig | null | undefined,
  ecosystemId: string,
): string {
  const min = Math.max(0, Number(cfg?.count_min ?? 0));
  const max = Math.max(min, Number(cfg?.count_max ?? 4));
  if (pages.length === 0 || max === 0) return "";
  const rule = cfg?.placement_rules || "by_h2";
  const placement = rule === "by_h2"
    ? "распределяй ссылки по разным разделам H2 (не больше одной на раздел)"
    : "вставляй ссылки естественно в любом месте текста";
  const list = pages.slice(0, 20).map((p) => {
    const title = p.title || p.h1 || "страница клиента";
    const desc = p.description ? ` — ${p.description.slice(0, 120)}` : "";
    return `- ${p.url}${desc} (рекомендуемый anchor: "${title}")`;
  }).join("\n");
  return "\n\n## Внутренние страницы клиента (client_pages)\n" +
    `Вставь ${min}-${max} внутренних ссылок; ${placement}. Пул:\n${list}\n\n` +
    "Правила:\n" +
    "- Anchor text — по смыслу предложения, использовать рекомендуемый или его склонение.\n" +
    `- Формат: [Anchor](URL?utm_source=ecosystem&utm_medium=document&utm_campaign=ecosystem_${ecosystemId}&utm_content=client_page_N).\n` +
    "- Не дублируй одну и ту же страницу в двух ссылках.";
}

/** Заменить {{path.to.value}} на строковые значения. Неизвестные плейсхолдеры → пустая строка. */
export function renderTemplate(tpl: string, vars: Record<string, unknown>): string {
  if (!tpl) return "";
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, path: string) => {
    const parts = path.split(".");
    let cur: any = vars;
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") return "";
      cur = cur[p];
    }
    if (cur == null) return "";
    return String(cur);
  });
}