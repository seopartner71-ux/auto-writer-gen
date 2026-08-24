// ============================================================================
// TEMPLATE RUNTIME v1 - DATA ADAPTER for HUB (silo / cluster landing).
//
//   SiloRow + ClusterRow[] + article pages + catalog facts + seo_content
//        -> HubTemplateData -> pages/hub.html
//
// Pure and deterministic. No content generation, no LLM, no DB, no URL
// building (paths arrive ready), no SEO logic. Values are pre-escaped.
// ============================================================================

import { escHtml } from "./seoChrome.ts";
import { asSeoContent } from "./contentBlocks.ts";
import type { TemplateRow } from "./dbTemplate.ts";

const flag = (on: boolean): TemplateRow[] => (on ? [{}] : []);

export interface HubCategoryInput {
  name: string;
  href: string;
  description?: string | null;
  image?: string | null;
  count?: number | null;
}
export interface HubArticleInput {
  title: string;
  href: string;
  excerpt?: string | null;
  image?: string | null;
  date?: string | null;
}
export interface HubFactInput { label: string; value: string }

export interface HubTemplateData extends TemplateRow {
  [key: string]: string | TemplateRow[];
}

function initials(s: string): string {
  return String(s || "?").trim().slice(0, 2).toUpperCase();
}

function fmtDate(iso: string | null | undefined, lang: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleDateString(lang === "en" ? "en-US" : "ru-RU", {
      day: "numeric", month: "long", year: "numeric",
    });
  } catch { return iso.slice(0, 10); }
}

export function buildHubTemplateData(args: {
  lang: string;
  h1: string;
  intro?: string | null;
  seoContent?: unknown;
  categories: HubCategoryInput[];
  articles: HubArticleInput[];
  facts?: HubFactInput[];
  breadcrumbs: { label: string; href?: string }[];
  ctaTitle?: string;
  ctaText?: string;
  ctaPrimary?: { label: string; href: string };
  ctaSecondary?: { label: string; href: string } | null;
}): HubTemplateData {
  const lang = args.lang === "en" ? "en" : "ru";
  const isRu = lang === "ru";
  const L = (ru: string, en: string) => (isRu ? ru : en);
  const sc = asSeoContent(args.seoContent);

  const categories = args.categories.map((c) => ({
    name: escHtml(c.name),
    url: escHtml(c.href),
    description: escHtml(String(c.description || "")),
    has_description: flag(!!c.description),
    image: escHtml(String(c.image || "")),
    has_image: flag(!!c.image),
    no_image: flag(!c.image),
    image_placeholder: escHtml(initials(c.name)),
    count: c.count ? String(c.count) : "",
    has_count: flag(!!c.count),
    label_count_unit: escHtml(L("материалов", "items")),
    label_open: escHtml(L("Открыть", "Open")),
  }));

  const articles = args.articles.map((a) => {
    const date = fmtDate(a.date, lang);
    return {
      title: escHtml(a.title),
      url: escHtml(a.href),
      excerpt: escHtml(String(a.excerpt || "")),
      has_excerpt: flag(!!a.excerpt),
      image: escHtml(String(a.image || "")),
      has_image: flag(!!a.image),
      no_image: flag(!a.image),
      image_placeholder: escHtml(initials(a.title)),
      date: escHtml(date),
      has_date: flag(!!date),
    };
  });

  const facts = (args.facts || []).map((f) => ({
    label: escHtml(f.label), value: escHtml(f.value),
  }));

  const bodyBlocks = (sc?.body || []).map((b) => ({
    heading: escHtml(b.heading || ""),
    has_heading: flag(!!b.heading),
    text: escHtml(b.text || ""),
  }));
  const faq = (sc?.faq || []).map((f) => ({ q: escHtml(f.q), a: escHtml(f.a) }));

  const intro = sc?.intro || args.intro || "";
  const ctaSecondary = args.ctaSecondary === undefined
    ? { label: L("Весь каталог", "Full catalog"), href: "/catalog/" }
    : args.ctaSecondary;

  return {
    h1: escHtml(sc?.h1 || args.h1),
    intro: escHtml(intro),
    has_intro: flag(!!intro),

    label_categories: escHtml(L("Разделы", "Sections")),
    label_articles: escHtml(L("Материалы", "Articles")),
    label_faq: escHtml(L("Частые вопросы", "FAQ")),

    cta_title: escHtml(args.ctaTitle || L("Нужна помощь с подбором?", "Need help choosing?")),
    cta_text: escHtml(args.ctaText || L(
      "Расскажите задачу - подберем подходящее решение из этого направления.",
      "Tell us your task - we will match the right option from this section.",
    )),
    cta_primary: escHtml(args.ctaPrimary?.label || L("Связаться", "Contact us")),
    cta_primary_url: escHtml(args.ctaPrimary?.href || "/contacts.html"),
    cta_secondary: escHtml(ctaSecondary?.label || ""),
    cta_secondary_url: escHtml(ctaSecondary?.href || ""),
    has_cta_secondary: flag(!!ctaSecondary),

    categories, has_categories: flag(categories.length > 0),
    articles, has_articles: flag(articles.length > 0),
    facts, has_facts: flag(facts.length > 0),
    body_blocks: bodyBlocks, has_body: flag(bodyBlocks.length > 0),
    faq, has_faq: flag(faq.length > 0),
    breadcrumbs: args.breadcrumbs.map((c) => ({ label: escHtml(c.label), url: escHtml(c.href || "") })),
  };
}
