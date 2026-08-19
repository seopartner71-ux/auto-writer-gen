// Commerce Content Engine - pure core (no DB, no network).
//
// One content model for every commercial page kind. Content is produced here
// (or by the LLM in generate-commerce-content), SAVED to the entity row and
// only then rendered. The deploy pipeline never generates content.

export type PageKind = "product" | "service" | "category" | "hub" | "article";

export interface FaqItem { q: string; a: string }

export interface SeoContent {
  seo_title: string;
  seo_description: string;
  h1: string;
  intro: string;
  /** Body as an ordered list of blocks - renderer turns it into HTML. */
  body: { heading: string; text: string }[];
  faq: FaqItem[];
  entities: string[];
  semantic_terms: string[];
  primary_keywords: string[];
  secondary_keywords: string[];
  schema_data: Record<string, unknown> | null;
  generated_by: string;
  version: number;
}

export const CONTENT_VERSION = 1;

const STOP = new Set([
  "и","в","на","для","с","по","из","от","до","the","a","an","of","for","and","to","in","on",
  "купить","цена","цены","заказать","под","при","или","что","как","это","все","buy","price",
]);

export function tokens(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Crude stem so "насосы" and "насос" collapse onto one intent. */
export function stem(w: string): string {
  return w.replace(/(ами|ями|ов|ев|ей|ах|ях|ые|ый|ая|ое|ой|ом|ем|ам|ям|ии|ия|и|ы|а|у|е|о|s)$/u, "");
}

export function intentSignature(keyword: string): string {
  return [...new Set(tokens(keyword).map(stem))].sort().join(" ");
}

function overlap(a: string[], b: Set<string>): number {
  if (!a.length || !b.size) return 0;
  let hit = 0;
  for (const w of new Set(a)) if (b.has(w)) hit++;
  return hit / new Set(a).size;
}

export function truncateAtWord(s: string, max: number): string {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const i = cut.lastIndexOf(" ");
  return (i > max * 0.6 ? cut.slice(0, i) : cut).replace(/[\s,;:.-]+$/, "");
}

// ---------------------------------------------------------------------------
// 1. Keyword -> target entity bridge + coverage
// ---------------------------------------------------------------------------

export interface KeywordRow {
  id: string;
  keyword: string;
  frequency?: number | null;
  intent?: string | null;
  silo_id?: string | null;
  site_cluster_id?: string | null;
}

export interface TargetEntity {
  id: string;
  kind: PageKind;
  name: string;
  /** Extra matchable text: brand, sku, characteristics, description. */
  text?: string;
  silo_id?: string | null;
  cluster_id?: string | null;
}

export interface KeywordAssignment {
  keyword_id: string;
  keyword: string;
  target_type: PageKind | null;
  target_id: string | null;
  role: "primary" | "secondary";
  score: number;
  coverage_status: "covered" | "uncovered" | "conflict" | "duplicate_intent";
}

export interface CoverageReport {
  total: number;
  covered: number;
  uncovered: number;
  conflict: number;
  duplicate_intent: number;
  assignments: KeywordAssignment[];
  /** keywords per target id */
  byTarget: Map<string, KeywordAssignment[]>;
}

const MAX_KW_PER_TARGET = 8;

/**
 * Maps commercial keywords onto existing pages. Never invents a page:
 * one search intent -> one target page, extra keywords become secondary.
 */
export function buildKeywordCoverage(keywords: KeywordRow[], entities: TargetEntity[]): CoverageReport {
  const ents = entities.map((e) => ({
    e,
    tok: new Set([...tokens(e.name), ...tokens(e.text || "")].map(stem)),
    nameTok: new Set(tokens(e.name).map(stem)),
  }));

  const scored: (KeywordAssignment & { sig: string })[] = [];
  for (const k of keywords) {
    const kt = tokens(k.keyword).map(stem);
    let best: { ent: TargetEntity; score: number } | null = null;
    for (const cand of ents) {
      // structural hints win over text similarity
      let score = overlap(kt, cand.nameTok) * 1.0 + overlap(kt, cand.tok) * 0.5;
      if (k.site_cluster_id && (cand.e.id === k.site_cluster_id || cand.e.cluster_id === k.site_cluster_id)) score += 0.35;
      if (k.silo_id && cand.e.silo_id === k.silo_id) score += 0.15;
      // informational keywords should not land on a product card
      if ((k.intent === "informational" || k.intent === "info") && (cand.e.kind === "product" || cand.e.kind === "service")) score -= 0.4;
      if (k.intent === "transactional" && cand.e.kind === "hub") score -= 0.2;
      if (!best || score > best.score) best = { ent: cand.e, score };
    }
    const ok = best && best.score >= 0.35;
    scored.push({
      keyword_id: k.id,
      keyword: k.keyword,
      target_type: ok ? best!.ent.kind : null,
      target_id: ok ? best!.ent.id : null,
      role: "secondary",
      score: ok ? Number(best!.score.toFixed(3)) : 0,
      coverage_status: ok ? "covered" : "uncovered",
      sig: intentSignature(k.keyword),
    });
  }

  // one intent -> one page
  const bySig = new Map<string, typeof scored>();
  for (const a of scored) {
    if (!a.target_id) continue;
    const arr = bySig.get(a.sig) || [];
    arr.push(a);
    bySig.set(a.sig, arr);
  }
  for (const [, arr] of bySig) {
    if (arr.length < 2) continue;
    const targets = new Set(arr.map((a) => a.target_id));
    arr.sort((a, b) => b.score - a.score);
    for (const a of arr.slice(1)) {
      a.coverage_status = targets.size > 1 ? "conflict" : "duplicate_intent";
      // conflicting duplicates are folded onto the strongest page, never a new one
      a.target_type = arr[0].target_type;
      a.target_id = arr[0].target_id;
    }
  }

  const byTarget = new Map<string, KeywordAssignment[]>();
  for (const a of scored) {
    if (!a.target_id) continue;
    const arr = byTarget.get(a.target_id) || [];
    arr.push(a);
    byTarget.set(a.target_id, arr);
  }
  for (const [id, arr] of byTarget) {
    arr.sort((a, b) => b.score - a.score || (b.keyword.length - a.keyword.length));
    arr[0].role = "primary";
    byTarget.set(id, arr.slice(0, MAX_KW_PER_TARGET));
    for (const extra of arr.slice(MAX_KW_PER_TARGET)) {
      extra.target_type = null; extra.target_id = null; extra.coverage_status = "uncovered";
    }
  }

  const assignments: KeywordAssignment[] = scored.map(({ sig: _sig, ...a }) => a);
  return {
    total: assignments.length,
    covered: assignments.filter((a) => a.coverage_status === "covered").length,
    uncovered: assignments.filter((a) => a.coverage_status === "uncovered").length,
    conflict: assignments.filter((a) => a.coverage_status === "conflict").length,
    duplicate_intent: assignments.filter((a) => a.coverage_status === "duplicate_intent").length,
    assignments,
    byTarget,
  };
}

// ---------------------------------------------------------------------------
// 2. Content model helpers
// ---------------------------------------------------------------------------

export interface ContentContext {
  kind: PageKind;
  name: string;
  siteName: string;
  lang: string;
  brand?: string | null;
  sku?: string | null;
  price?: string | null;
  availability?: string | null;
  description?: string | null;
  characteristics?: Record<string, unknown> | null;
  categoryName?: string | null;
  siloName?: string | null;
  childNames?: string[];
  primaryKeywords?: string[];
  secondaryKeywords?: string[];
  city?: string | null;
}

export function normalizeSeoContent(raw: unknown, ctx: ContentContext, generatedBy: string): SeoContent {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const str = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const arr = (v: unknown, n: number) =>
    (Array.isArray(v) ? v : []).map((x) => str(x)).filter(Boolean).slice(0, n);

  const body = (Array.isArray(o.body) ? o.body : [])
    .map((b: any) => ({ heading: str(b?.heading), text: str(b?.text) }))
    .filter((b: { heading: string; text: string }) => b.text.length > 40)
    .slice(0, 5);

  const faq = (Array.isArray(o.faq) ? o.faq : [])
    .map((f: any) => ({ q: str(f?.q ?? f?.question), a: str(f?.a ?? f?.answer) }))
    .filter((f: FaqItem) => f.q.length > 5 && f.a.length > 20)
    .slice(0, 6);

  const h1 = str(o.h1) || ctx.name;
  return {
    seo_title: truncateAtWord(str(o.seo_title) || `${ctx.name} - ${ctx.siteName}`, 65),
    seo_description: truncateAtWord(str(o.seo_description) || str(ctx.description) || `${ctx.name}. ${ctx.siteName}`, 158),
    h1: truncateAtWord(h1, 90),
    intro: str(o.intro),
    body,
    faq,
    entities: arr(o.entities, 12),
    semantic_terms: arr(o.semantic_terms, 20),
    primary_keywords: arr(o.primary_keywords, 3).length ? arr(o.primary_keywords, 3) : (ctx.primaryKeywords || []).slice(0, 3),
    secondary_keywords: arr(o.secondary_keywords, 10).length ? arr(o.secondary_keywords, 10) : (ctx.secondaryKeywords || []).slice(0, 10),
    schema_data: (o.schema_data && typeof o.schema_data === "object") ? o.schema_data : null,
    generated_by: generatedBy,
    version: CONTENT_VERSION,
  };
}

export function contentWordCount(c: SeoContent | null | undefined): number {
  if (!c) return 0;
  const text = [c.intro, ...(c.body || []).map((b) => `${b.heading} ${b.text}`), ...(c.faq || []).map((f) => `${f.q} ${f.a}`)].join(" ");
  return text.split(/\s+/).filter(Boolean).length;
}

/** Thresholds per page kind - a card must not become an AI wall of text. */
export const MIN_WORDS: Record<PageKind, number> = {
  product: 90, service: 120, category: 140, hub: 160, article: 300,
};
export const FAQ_REQUIRED: PageKind[] = ["category", "hub", "service"];

export function isContentThin(kind: PageKind, c: SeoContent | null | undefined): boolean {
  return contentWordCount(c) < MIN_WORDS[kind];
}

// ---------------------------------------------------------------------------
// 3. Deterministic fallback builder
//    Used when the LLM fails and as the offline fixture generator. Uses the
//    real attributes of the entity, so two entities never get the same text.
// ---------------------------------------------------------------------------

export function buildFallbackContent(ctx: ContentContext): SeoContent {
  const en = ctx.lang === "en";
  const t = (ru: string, e: string) => (en ? e : ru);
  const chars = ctx.characteristics && typeof ctx.characteristics === "object"
    ? Object.entries(ctx.characteristics).filter(([, v]) => v !== null && v !== "")
    : [];
  const charLine = chars.map(([k, v]) => `${k}: ${v}`).join(", ");
  const kw = (ctx.primaryKeywords || [])[0] || ctx.name;
  const where = ctx.categoryName || ctx.siloName || ctx.siteName;
  const body: { heading: string; text: string }[] = [];
  const faq: FaqItem[] = [];
  let intro = "";

  if (ctx.kind === "product" || ctx.kind === "service") {
    intro = t(
      `${ctx.name}${ctx.brand ? ` от ${ctx.brand}` : ""} - позиция раздела "${where}"${ctx.price ? `, стоимость ${ctx.price}` : ""}. ${ctx.description || ""}`,
      `${ctx.name}${ctx.brand ? ` by ${ctx.brand}` : ""} belongs to "${where}"${ctx.price ? `, priced at ${ctx.price}` : ""}. ${ctx.description || ""}`,
    ).trim();
    if (ctx.kind === "product") {
      body.push({
        heading: t("Где применяется", "Where it is used"),
        text: t(
          `Позиция закрывает запрос "${kw}" в разделе "${where}". ${charLine ? `Ключевые параметры: ${charLine}.` : ""} Подбор выполняется по задаче, а не по названию: сравните параметры с требованиями объекта.`,
          `The item covers the "${kw}" request inside "${where}". ${charLine ? `Key parameters: ${charLine}.` : ""} Match the parameters to your task rather than to the product name.`,
        ),
      });
      body.push({
        heading: t("Что учесть перед заказом", "What to check before ordering"),
        text: t(
          `Проверьте совместимость по типоразмеру, наличие ${ctx.sku ? `артикула ${ctx.sku}` : "нужного артикула"} на складе и условия доставки. ${ctx.availability === "out_of_stock" ? "Позиция под заказ - срок уточняется." : "Позиция доступна к отгрузке."}`,
          `Check size compatibility, ${ctx.sku ? `availability of SKU ${ctx.sku}` : "stock availability"} and delivery terms. ${ctx.availability === "out_of_stock" ? "Currently made to order." : "Ready to ship."}`,
        ),
      });
      faq.push({
        q: t(`Чем ${ctx.name} отличается от аналогов?`, `How does ${ctx.name} differ from alternatives?`),
        a: t(
          `Отличия видны по параметрам: ${charLine || "типоразмер, материал и ресурс"}. Сравнение проводится внутри раздела "${where}".`,
          `The difference is in the parameters: ${charLine || "size, material and lifetime"}. Compare inside "${where}".`,
        ),
      });
    } else {
      body.push({
        heading: t("Что входит в услугу", "What the service includes"),
        text: t(
          `Работы по запросу "${kw}": выезд и осмотр, расчет объема, выполнение работ, сдача результата. Направление относится к разделу "${where}".`,
          `Scope for "${kw}": site visit, scope estimate, execution and hand-over. The service belongs to "${where}".`,
        ),
      });
      body.push({
        heading: t("Как проходит работа", "How it works"),
        text: t(
          `Заявка - расчет - согласование сроков - выполнение - гарантия. ${ctx.price ? `Ориентир по стоимости: ${ctx.price}.` : "Стоимость зависит от объема."}`,
          `Request - estimate - schedule - execution - warranty. ${ctx.price ? `Reference price: ${ctx.price}.` : "The price depends on scope."}`,
        ),
      });
      faq.push({
        q: t(`Сколько стоит ${ctx.name}?`, `How much does ${ctx.name} cost?`),
        a: t(
          `${ctx.price ? `Базовая стоимость - ${ctx.price}.` : "Стоимость считается по объему работ."} Точная смета готовится после осмотра.`,
          `${ctx.price ? `Base price is ${ctx.price}.` : "The price depends on the scope."} A precise quote follows the site visit.`,
        ),
      });
      faq.push({
        q: t("Есть ли гарантия?", "Is there a warranty?"),
        a: t("Да, гарантия фиксируется в договоре и распространяется на выполненные работы.", "Yes, the warranty is fixed in the contract and covers the performed work."),
      });
    }
  } else if (ctx.kind === "category") {
    const kids = (ctx.childNames || []).slice(0, 8);
    intro = t(
      `Раздел "${ctx.name}"${ctx.siloName ? ` в направлении "${ctx.siloName}"` : ""} собирает позиции под запрос "${kw}". ${ctx.description || ""}`,
      `The "${ctx.name}" category${ctx.siloName ? ` inside "${ctx.siloName}"` : ""} covers the "${kw}" intent. ${ctx.description || ""}`,
    ).trim();
    body.push({
      heading: t("Как выбрать", "How to choose"),
      text: t(
        `Выбор в категории строится от задачи: сначала определяется типоразмер и условия эксплуатации, затем сравниваются параметры позиций${kids.length ? `: ${kids.join(", ")}` : ""}. Такой порядок исключает переплату за избыточные характеристики.`,
        `Start from the task: define the size and operating conditions, then compare the items${kids.length ? `: ${kids.join(", ")}` : ""}. This order prevents overpaying for excess specs.`,
      ),
    });
    body.push({
      heading: t("Что входит в раздел", "What the category contains"),
      text: t(
        `В разделе представлены позиции, закрывающие смежные запросы: ${(ctx.secondaryKeywords || []).slice(0, 6).join(", ") || kids.join(", ") || ctx.name}. Каждая карточка содержит параметры, цену и условия поставки.`,
        `The category contains items covering related intents: ${(ctx.secondaryKeywords || []).slice(0, 6).join(", ") || kids.join(", ") || ctx.name}. Every card lists specs, price and delivery terms.`,
      ),
    });
    faq.push({
      q: t(`Что входит в раздел "${ctx.name}"?`, `What is inside "${ctx.name}"?`),
      a: t(`Позиции раздела: ${kids.join(", ") || ctx.name}. Список пополняется по мере поступления.`, `Items: ${kids.join(", ") || ctx.name}. The list is updated regularly.`),
    });
    faq.push({
      q: t("Как уточнить наличие и цену?", "How to check stock and price?"),
      a: t("Цена указана в карточке позиции, наличие подтверждается при оформлении заявки.", "The price is on the item card, stock is confirmed when the request is placed."),
    });
  } else {
    const kids = (ctx.childNames || []).slice(0, 10);
    intro = t(
      `Направление "${ctx.name}" объединяет категории и позиции по теме "${kw}". ${ctx.description || ""}`,
      `The "${ctx.name}" section groups categories and items around "${kw}". ${ctx.description || ""}`,
    ).trim();
    body.push({
      heading: t("Структура направления", "Section structure"),
      text: t(
        `Направление разделено на категории: ${kids.join(", ") || ctx.name}. Каждая категория закрывает свой интент, поэтому переход по структуре ведет от общей задачи к конкретной позиции.`,
        `The section is split into categories: ${kids.join(", ") || ctx.name}. Each category covers its own intent, so navigation moves from the general task to a specific item.`,
      ),
    });
    body.push({
      heading: t("С чего начать", "Where to start"),
      text: t(
        `Если задача сформулирована - открывайте профильную категорию. Если нужен подбор - начните с параметров: назначение, типоразмер, бюджет. Материалы блога дополняют выбор практикой применения.`,
        `If the task is clear, open the relevant category. If you need help choosing, start from purpose, size and budget. Blog materials add practical context.`,
      ),
    });
    faq.push({
      q: t(`Что входит в направление "${ctx.name}"?`, `What does "${ctx.name}" include?`),
      a: t(`Категории: ${kids.join(", ") || ctx.name}.`, `Categories: ${kids.join(", ") || ctx.name}.`),
    });
    faq.push({
      q: t("Как быстро подобрать позицию?", "How to pick an item quickly?"),
      a: t("Определите задачу и откройте профильную категорию - внутри позиции отсортированы по параметрам.", "Define the task and open the matching category - items are sorted by parameters."),
    });
  }

  const entities = [ctx.brand, ctx.siloName, ctx.categoryName, ctx.city, ctx.siteName]
    .filter(Boolean).map((x) => String(x));
  const semantic = [...new Set([
    ...tokens(ctx.name),
    ...chars.flatMap(([k]) => tokens(k)),
    ...(ctx.secondaryKeywords || []).flatMap((k) => tokens(k)),
  ])].slice(0, 20);

  return normalizeSeoContent({
    seo_title: buildTitle(ctx),
    seo_description: buildDescription(ctx, intro),
    h1: ctx.kind === "product" || ctx.kind === "service" ? ctx.name : `${ctx.name}${ctx.city ? ` - ${ctx.city}` : ""}`,
    intro,
    body,
    faq,
    entities,
    semantic_terms: semantic,
    primary_keywords: ctx.primaryKeywords || [],
    secondary_keywords: ctx.secondaryKeywords || [],
  }, ctx, "fallback");
}

export function buildTitle(ctx: ContentContext): string {
  const en = ctx.lang === "en";
  const kw = (ctx.primaryKeywords || [])[0];
  const base = ctx.kind === "product" || ctx.kind === "service"
    ? `${ctx.name}${ctx.price ? ` - ${ctx.price}` : ""}`
    : `${ctx.name}${kw && !tokens(ctx.name).includes(tokens(kw)[0] || "") ? ` - ${kw}` : ""}`;
  return truncateAtWord(`${base} - ${ctx.siteName}`, 65);
}

export function buildDescription(ctx: ContentContext, intro: string): string {
  const src = intro || ctx.description || `${ctx.name}. ${ctx.siteName}`;
  return truncateAtWord(src, 158);
}