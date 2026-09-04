// ============================================================================
// Deterministic SEO metadata builder (no LLM).
//
// The SEO Engine generates title/description/h1 through Gemini, one page per
// call. On projects with hundreds of pages that path never finishes inside an
// edge invocation, so page_seo rows were simply never written and the launch
// readiness panel reported "pages without a title" for the whole registry.
//
// This module builds a correct, word-safe metadata package from data that is
// already in the database (silo / category / product names and descriptions +
// company profile). It is used as:
//   - the fast bulk path (mode fast: true),
//   - the fallback whenever the LLM call fails or the time budget runs out.
// ============================================================================

import { sanitizeSeoText, truncateAtWord, TITLE_MAX, DESC_MAX, DESC_MIN, type SeoPageType } from "./seoEngine.ts";

const t = (v: unknown) => String(v ?? "").trim();

export interface FallbackInput {
  pageType: SeoPageType | string;
  lang?: string;
  /** Primary entity name: product / category / silo / registry title. */
  name: string;
  /** Free-form description of the entity, if any. */
  description?: string | null;
  siloName?: string | null;
  categoryName?: string | null;
  siteName?: string | null;
  companyName?: string | null;
  region?: string | null;
  delivery?: string | null;
  price?: number | string | null;
  currency?: string | null;
  /** Real body text of the page (intro, sections, commercial blocks). */
  pageText?: string | null;
}

export interface FallbackSeo { title: string; h1: string; description: string }

/** "{primary} - {suffix}" clamped at `max`, cut only on a word boundary. */
export function pairTitle(primary: string, suffix: string, max: number): string {
  const head = sanitizeSeoText(primary);
  const tail = sanitizeSeoText(suffix);
  if (!tail) return truncateAtWord(head, max);
  if (!head) return truncateAtWord(tail, max);
  const full = `${head} - ${tail}`;
  if (full.length <= max) return full;
  const room = max - head.length - 3;
  if (room >= 4) {
    const short = truncateAtWord(tail, room);
    if (short) return `${head} - ${short}`;
  }
  return truncateAtWord(head, max);
}

/** Joins sentences until the text fits the 120-160 description window. */
function composeDescription(parts: string[], max: number): string {
  const out: string[] = [];
  let len = 0;
  for (const raw of parts) {
    const p = sanitizeSeoText(raw).replace(/\s*[.;]+$/, "");
    if (!p) continue;
    const next = len ? len + 2 + p.length + 1 : p.length + 1;
    if (next > max) {
      if (!out.length) return `${truncateAtWord(p, max - 1)}.`;
      break;
    }
    out.push(p);
    len = next;
  }
  return out.length ? `${out.join(". ")}.` : "";
}

/** Strips markup and picks the first informative sentences of the page body. */
export function pageSummary(raw: unknown, maxSentences = 3): string {
  const text = String(raw ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[#*_>`|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 25);
  return sanitizeSeoText(sentences.slice(0, maxSentences).join(" "));
}

export function buildFallbackSeo(input: FallbackInput): FallbackSeo {
  const ru = String(input.lang || "ru").toLowerCase().startsWith("en") ? false : true;
  const L = (r: string, e: string) => (ru ? r : e);
  const pageType = String(input.pageType || "system") as SeoPageType;
  const max = TITLE_MAX[pageType] ?? 65;

  const name = sanitizeSeoText(input.name || input.categoryName || input.siloName || "");
  const site = sanitizeSeoText(input.siteName || input.companyName || "");
  const category = sanitizeSeoText(input.categoryName || "");
  const silo = sanitizeSeoText(input.siloName || "");

  const isProduct = pageType === "product" || pageType === "service";
  const isSection = pageType === "hub" || pageType === "category" || pageType === "informational";

  const titleHead = isProduct
    ? pairTitle(name, L("купить по цене", "buy online"), max)
    : name;
  const title = pairTitle(isProduct ? titleHead : name, isProduct ? "" : (site || silo), max);

  const h1 = truncateAtWord(
    isSection && category && category !== name ? name : name,
    90,
  );

  const priceText = input.price
    ? L(`Цена от ${input.price} ${t(input.currency) || "RUB"}`, `Price from ${input.price} ${t(input.currency) || "USD"}`)
    : "";

  // Page body first: metadata built from the real text beats a profile template.
  const bodySummary = pageSummary(input.pageText, 2);

  const parts = isProduct
    ? [
        bodySummary,
        sanitizeSeoText(input.description || ""),
        `${name}${silo ? L(` в разделе ${silo}`, ` in ${silo}`) : ""}`,
        priceText,
        input.delivery ? sanitizeSeoText(String(input.delivery)) : "",
        L("Подробные характеристики и условия заказа на странице товара", "Full specs and ordering details on the product page"),
      ]
    : [
        bodySummary,
        sanitizeSeoText(input.description || ""),
        L(`${name}: подборка позиций раздела`, `${name}: section overview`),
        input.region ? L(`Работаем в регионе ${sanitizeSeoText(String(input.region))}`, `Available in ${sanitizeSeoText(String(input.region))}`) : "",
        site ? L(`Каталог и условия заказа на сайте ${site}`, `Catalog and ordering terms at ${site}`) : "",
        L("Выберите подходящий вариант и оформите заказ", "Pick a suitable option and place your order"),
      ];

  let description = composeDescription(parts, DESC_MAX);
  if (description.length < DESC_MIN) {
    description = composeDescription(
      [...parts, L("Актуальный ассортимент, характеристики и условия доставки", "Current range, specifications and delivery terms")],
      DESC_MAX,
    );
  }

  return { title, h1: h1 || title, description };
}
