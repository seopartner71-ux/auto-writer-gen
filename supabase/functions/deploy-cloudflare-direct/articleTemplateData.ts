// ============================================================================
// TEMPLATE RUNTIME v1 - DATA ADAPTER for ARTICLE pages.
//
//   post (already generated HTML) + author + related -> ArticleTemplateData
//        -> pages/article.html
//
// Pure and deterministic. The adapter does NOT generate text, build URLs, do
// SEO work or touch the DB. The article HTML is passed through as-is; the only
// mechanical touch is adding missing `id` attributes to <h2> so the table of
// contents can link to them (no content, order or markup changes otherwise).
// ============================================================================

import { escHtml } from "./seoChrome.ts";
import type { TemplateRow } from "./dbTemplate.ts";

const flag = (on: boolean): TemplateRow[] => (on ? [{}] : []);

export interface ArticleRelatedInput {
  title: string;
  href: string;
  excerpt?: string | null;
  image?: string | null;
  date?: string | null;
}

export interface ArticleTemplateData extends TemplateRow {
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

function slugifyAnchor(text: string, i: number): string {
  const base = text.toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base ? `s-${base}` : `s-${i + 1}`;
}

/** Adds ids to <h2> without one and returns the TOC rows. */
function withToc(html: string): { html: string; toc: { id: string; title: string }[] } {
  const toc: { id: string; title: string }[] = [];
  let i = 0;
  const out = String(html || "").replace(
    /<h2([^>]*)>([\s\S]*?)<\/h2>/gi,
    (m, attrs: string, inner: string) => {
      const plain = inner.replace(/<[^>]+>/g, "").trim();
      if (!plain) return m;
      const existing = /\sid\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const id = existing ? existing[1] : slugifyAnchor(plain, i);
      toc.push({ id, title: plain });
      i++;
      return existing ? m : `<h2${attrs} id="${id}">${inner}</h2>`;
    },
  );
  return { html: out, toc };
}

function readingMinutes(html: string): number {
  const words = String(html || "").replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 180));
}

export function buildArticleTemplateData(args: {
  lang: string;
  title: string;
  html: string;
  excerpt?: string | null;
  image?: string | null;
  publishedAt?: string | null;
  author?: { name: string; image?: string | null } | null;
  related: ArticleRelatedInput[];
  breadcrumbs: { label: string; href?: string }[];
  withToc?: boolean;
}): ArticleTemplateData {
  const lang = args.lang === "en" ? "en" : "ru";
  const isRu = lang === "ru";
  const L = (ru: string, en: string) => (isRu ? ru : en);

  const useToc = args.withToc !== false;
  const prepared = useToc ? withToc(args.html || "") : { html: args.html || "", toc: [] };
  const date = fmtDate(args.publishedAt, lang);
  const minutes = readingMinutes(args.html || "");

  const related = args.related.map((r) => {
    const d = fmtDate(r.date, lang);
    return {
      title: escHtml(r.title),
      url: escHtml(r.href),
      excerpt: escHtml(String(r.excerpt || "")),
      has_excerpt: flag(!!r.excerpt),
      image: escHtml(String(r.image || "")),
      has_image: flag(!!r.image),
      no_image: flag(!r.image),
      image_placeholder: escHtml(initials(r.title)),
      date: escHtml(d),
      has_date: flag(!!d),
    };
  });

  return {
    h1: escHtml(args.title),
    excerpt: escHtml(String(args.excerpt || "")),
    has_excerpt: flag(!!args.excerpt),
    // Raw, already-prepared article HTML - the template renders it verbatim.
    html: prepared.html,
    date: escHtml(date),
    date_iso: escHtml(String(args.publishedAt || "").slice(0, 10)),
    has_date: flag(!!date),
    author: escHtml(args.author?.name || ""),
    has_author: flag(!!args.author?.name),
    author_image: escHtml(String(args.author?.image || "")),
    has_author_image: flag(!!args.author?.image),
    reading_time: escHtml(`${minutes} ${L("мин чтения", "min read")}`),
    has_reading_time: flag(true),
    image: escHtml(String(args.image || "")),
    has_image: flag(!!args.image),

    label_toc: escHtml(L("Содержание", "Contents")),
    label_related: escHtml(L("Еще материалы", "More stories")),

    toc: prepared.toc.map((t) => ({ id: escHtml(t.id), title: escHtml(t.title) })),
    has_toc: flag(prepared.toc.length > 1),
    related, has_related: flag(related.length > 0),
    breadcrumbs: args.breadcrumbs.map((c) => ({ label: escHtml(c.label), url: escHtml(c.href || "") })),
  };
}
