// ============================================================================
// P18 - VISUAL RENDERER / PAGE RENDERER + TEMPLATE SYSTEM
//
//   page_registry + page_visual_config + content + seo + commercial blocks
//   + design_profile  ->  [RENDERER]  ->  HTML
//
// Pure + deterministic: no DB, no LLM, no network. The renderer never invents
// data - a block without data is simply not rendered and is reported by QA.
// ============================================================================

import type { DesignProfile } from "../visualTemplates.ts";
import { buildTokens, designSystemCss, googleFonts, type DesignTokens } from "./designSystem.ts";
import {
  Advantages, ArticleContent, AuthorCard, Breadcrumbs, CardGrid, CatalogGrid, Characteristics,
  Chips, ComparisonTable, CTA, esc, ExpertBlock, FAQ, Footer, Gallery, Header, Hero, LeadForm,
  PriceBlock, Prose, RelatedContent, Reviews, Section, ServiceSteps, StickyCta, TrustBlock,
  type CardItem, type LinkProps, type ProductCardProps,
} from "./components.ts";

const t = (v: unknown) => String(v ?? "").trim();

export interface SiteContext {
  company: string;
  about?: string;
  phone?: string;
  email?: string;
  address?: string;
  nav: LinkProps[];
  footerColumns?: { title: string; links: LinkProps[] }[];
  copyright?: string;
  primaryCta?: string;
  stickyCta?: boolean;
}

export interface PageData {
  registry_id?: string;
  page_type: string;
  url_path: string;
  h1: string;
  title?: string;
  description?: string;
  breadcrumbs?: LinkProps[];
  intro?: string;
  body?: { heading?: string; text?: string }[];
  html?: string;
  faq?: { q: string; a: string }[];
  /** product / offer facts */
  price?: string;
  availability?: string;
  images?: string[];
  characteristics?: [string, string][];
  facts?: string[];
  /** catalog relations */
  subcategories?: LinkProps[];
  products?: ProductCardProps[];
  related?: ProductCardProps[];
  articles?: LinkProps[];
  comparison?: { head: string[]; rows: string[][] } | null;
  /** commercial + service */
  advantages?: CardItem[];
  trust?: CardItem[];
  delivery?: CardItem[];
  warranty?: CardItem[];
  payment?: CardItem[];
  certificates?: CardItem[];
  problem?: CardItem[];
  solution?: CardItem[];
  steps?: CardItem[];
  cases?: CardItem[];
  applications?: CardItem[];
  reviews?: { text: string; author?: string }[];
  expert?: { text: string; author?: string; role?: string } | null;
  author?: { name: string; role?: string; date?: string } | null;
  brands?: LinkProps[];
  cta?: { title?: string; text?: string; primary?: string } | null;
}

export interface VisualBlock { type: string; enabled?: boolean; variant?: string; order?: number }

// ---------------------------------------------------------------------------
// BLOCK -> HTML
// ---------------------------------------------------------------------------
function heroFor(page: PageData, site: SiteContext): string {
  return Hero({
    eyebrow: page.page_type === "product" ? "Каталог" : page.page_type === "service" ? "Услуги" : undefined,
    title: page.h1,
    subtitle: page.intro || page.description,
    image: (page.images || [])[0],
    facts: page.facts,
    cta: { label: site.primaryCta || "Оставить заявку", secondary: "Подробнее" },
  });
}

export function renderBlock(type: string, page: PageData, site: SiteContext): string {
  switch (type) {
    case "header": return Header({ logo: site.company, nav: site.nav, phone: site.phone, cta: site.primaryCta });
    case "breadcrumb": return Breadcrumbs({ items: page.breadcrumbs });
    case "hero_home": case "hero_product": case "hero_service":
    case "hero_category": case "hero_article": return heroFor(page, site);
    case "article_header": return heroFor(page, site);
    case "gallery": return Section({ title: "Фото", body: Gallery({ images: (page.images || []).slice(1), alt: page.h1 }) });
    case "price": return Section({ body: PriceBlock({ price: page.price, availability: page.availability, cta: site.primaryCta }) });
    case "characteristics": return Section({ title: "Характеристики", alt: true, body: Characteristics({ rows: page.characteristics }) });
    case "description": case "article_body":
      return Section({ id: "content", title: page.page_type === "article" ? undefined : "О продукте", body: page.html ? Prose({ html: page.html }) : ArticleContent({ blocks: page.body }) });
    case "instruction": return Section({ title: "Как это работает", body: ServiceSteps({ steps: page.steps }) });
    case "advantages": return Section({ title: "Преимущества", alt: true, body: Advantages({ items: page.advantages }) });
    case "trust": case "experience": return Section({ title: "Почему нам доверяют", body: TrustBlock({ items: page.trust }) });
    case "certificates": return Section({ title: "Сертификаты", body: CardGrid({ items: page.certificates, cols: 4, flat: true }) });
    case "delivery": return Section({ title: "Доставка", alt: true, body: CardGrid({ items: page.delivery, cols: 3 }) });
    case "payment": return Section({ title: "Оплата", body: CardGrid({ items: page.payment, cols: 3 }) });
    case "warranty": return Section({ title: "Гарантия", body: CardGrid({ items: page.warranty, cols: 2 }) });
    case "problem": return Section({ title: "Задача клиента", body: CardGrid({ items: page.problem, cols: 3, flat: true }) });
    case "solution": return Section({ title: "Решение", alt: true, body: CardGrid({ items: page.solution, cols: 3 }) });
    case "process": return Section({ title: "Этапы работы", body: ServiceSteps({ steps: page.steps }) });
    case "applications": return Section({ title: "Область применения", body: CardGrid({ items: page.applications, cols: 3 }) });
    case "cases": return Section({ title: "Кейсы", alt: true, body: CardGrid({ items: page.cases, cols: 3 }) });
    case "reviews": return Section({ title: "Отзывы", body: Reviews({ items: page.reviews }) });
    case "expert_block": return Section({ title: "Мнение специалиста", body: ExpertBlock(page.expert || {}) });
    case "author": return Section({ body: AuthorCard(page.author || {}) });
    case "categories": case "subcategories":
      return Section({ title: "Разделы", body: Chips({ items: page.subcategories }) });
    case "filters": return Section({ body: Chips({ items: (page.subcategories || []).slice(0, 12) }) });
    case "products": return Section({ title: "Каталог", body: CatalogGrid({ items: page.products, cols: 3 }) });
    case "related_products": return Section({ title: "Похожие позиции", alt: true, body: CatalogGrid({ items: page.related, cols: 3 }) });
    case "comparison": return Section({ title: "Сравнение", body: page.comparison ? ComparisonTable(page.comparison) : "" });
    case "articles": return Section({ title: "Статьи по теме", body: RelatedContent({ items: page.articles }) });
    case "brands": return Section({ title: "Бренды", body: Chips({ items: page.brands }) });
    case "faq": return Section({ title: "Вопросы и ответы", alt: true, body: FAQ({ items: page.faq }) });
    case "cta": return Section({ body: CTA({ ...(page.cta || {}), phone: site.phone }) });
    case "lead_form": case "callback":
      return Section({ body: LeadForm({ title: page.cta?.title, text: page.cta?.text, cta: site.primaryCta }) });
    case "footer": return Footer({
      company: site.company, about: site.about, phone: site.phone, email: site.email,
      address: site.address, columns: site.footerColumns, copyright: site.copyright,
    });
    default: return "";
  }
}

// ---------------------------------------------------------------------------
// PAGE RENDERER
// ---------------------------------------------------------------------------
export interface RenderResult {
  html: string;
  rendered: string[];
  skipped: string[];
  tokens: DesignTokens;
}

export function renderPage(args: {
  page: PageData;
  site: SiteContext;
  profile: DesignProfile;
  blocks: VisualBlock[];
  fragment?: boolean;
}): RenderResult {
  const { page, site, profile } = args;
  const tokens = buildTokens(profile);
  const ordered = [...(args.blocks || [])]
    .filter((b) => b.enabled !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const rendered: string[] = [];
  const skipped: string[] = [];
  const head: string[] = [];
  const body: string[] = [];
  const foot: string[] = [];

  for (const b of ordered) {
    const html = renderBlock(String(b.type), page, site);
    if (!t(html)) { skipped.push(String(b.type)); continue; }
    rendered.push(String(b.type));
    if (b.type === "header") head.push(html);
    else if (b.type === "footer") foot.push(html);
    else body.push(html);
  }

  // Global guarantees: every page of the site has the same header / footer /
  // conversion path. Internal pages never degrade into raw HTML.
  if (!head.length) { head.push(renderBlock("header", page, site)); rendered.push("header"); }
  if (!foot.length) { foot.push(renderBlock("footer", page, site)); rendered.push("footer"); }
  if (!rendered.some((x) => x.startsWith("hero") || x === "article_header")) {
    body.unshift(heroFor(page, site));
    rendered.unshift("hero_" + (page.page_type === "home" ? "home" : page.page_type));
  }
  if (!rendered.includes("lead_form") && !rendered.includes("cta")) {
    body.push(Section({ body: LeadForm({ cta: site.primaryCta }) }));
    rendered.push("lead_form");
  }
  if (site.stickyCta !== false) body.push(StickyCta({ label: site.primaryCta, phone: site.phone }));

  const inner = `${head.join("\n")}\n<main>\n${body.join("\n")}\n</main>\n${foot.join("\n")}`;
  if (args.fragment) return { html: inner, rendered, skipped, tokens };

  const html = `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title || page.h1)}</title>
${page.description ? `<meta name="description" content="${esc(page.description)}">` : ""}
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${googleFonts(tokens)}">
<style>${designSystemCss(tokens)}</style>
</head><body>
${inner}
</body></html>`;

  return { html, rendered, skipped, tokens };
}

// ---------------------------------------------------------------------------
// VISUAL READY GATE (pre-build)
// ---------------------------------------------------------------------------
export interface ReadyResult { ok: boolean; blocked: string[]; warnings: string[] }

export function visualReady(args: {
  page: PageData; blocks: VisualBlock[]; profile: DesignProfile | null; rendered?: string[];
}): ReadyResult {
  const blocked: string[] = [];
  const warnings: string[] = [];
  const on = (args.blocks || []).filter((b) => b.enabled !== false).map((b) => String(b.type));

  if (!args.profile) blocked.push("no_design_profile");
  if (!on.length) blocked.push("no_components");
  if (!t(args.page.h1)) blocked.push("no_h1");
  if (!on.some((x) => x.startsWith("hero") || x === "article_header")) warnings.push("no_hero_block");
  if (!on.includes("cta") && !on.includes("lead_form") && !on.includes("callback")) warnings.push("no_cta_block");
  if (!args.page.intro && !(args.page.body || []).length && !t(args.page.html)) warnings.push("thin_first_screen");
  if (!(args.page.images || []).length) warnings.push("no_images");
  const skipped = (args.blocks || []).length - (args.rendered?.length ?? (args.blocks || []).length);
  if (args.rendered && skipped > 0) warnings.push(`empty_blocks:${skipped}`);

  return { ok: blocked.length === 0, blocked, warnings };
}

// ---------------------------------------------------------------------------
// SITE DESIGN QA (visual consistency across pages)
// ---------------------------------------------------------------------------
export interface PageQaInput { url_path: string; page_type: string; html: string; rendered: string[] }
export interface SiteQaResult {
  status: "PASS" | "REVIEW" | "FAIL";
  score: number;
  issues: { code: string; severity: "error" | "warning"; detail?: string }[];
  pages: { url_path: string; page_type: string; bytes: number; blocks: number; issues: string[] }[];
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
const between = (html: string, open: RegExp, close: string) => {
  const m = open.exec(html);
  if (!m) return "";
  const end = html.indexOf(close, m.index);
  return end < 0 ? "" : html.slice(m.index, end);
};

export function siteDesignQa(pages: PageQaInput[]): SiteQaResult {
  const issues: SiteQaResult["issues"] = [];
  const rows: SiteQaResult["pages"] = [];
  const headers = new Set<string>();
  const footers = new Set<string>();
  const css = new Set<string>();

  for (const p of pages) {
    const pageIssues: string[] = [];
    headers.add(hash(between(p.html, /<header/, "</header>")));
    footers.add(hash(between(p.html, /<footer/, "</footer>")));
    css.add(hash(between(p.html, /<style>/, "</style>")));

    if (!/<style>/.test(p.html) && !/rel="stylesheet"/.test(p.html)) pageIssues.push("no_css");
    if (!/class="btn/.test(p.html)) pageIssues.push("no_buttons");
    if (!/<h1/.test(p.html)) pageIssues.push("no_h1");
    if (!/viewport/.test(p.html)) pageIssues.push("no_mobile_viewport");
    if (p.rendered.length < 5) pageIssues.push("too_few_blocks");
    if (p.html.length < 4000) pageIssues.push("thin_page");
    if (p.html.length > 600_000) pageIssues.push("heavy_page");

    for (const code of pageIssues) {
      issues.push({ code, severity: ["no_css", "no_h1", "no_mobile_viewport"].includes(code) ? "error" : "warning", detail: p.url_path });
    }
    rows.push({ url_path: p.url_path, page_type: p.page_type, bytes: p.html.length, blocks: p.rendered.length, issues: pageIssues });
  }

  if (headers.size > 1) issues.push({ code: "design_inconsistency", severity: "warning", detail: "header" });
  if (footers.size > 1) issues.push({ code: "design_inconsistency", severity: "warning", detail: "footer" });
  if (css.size > 1) issues.push({ code: "design_inconsistency", severity: "error", detail: "css tokens" });

  const errors = issues.filter((i) => i.severity === "error").length;
  const warns = issues.length - errors;
  const score = Math.max(0, 100 - errors * 20 - warns * 5);
  return { status: errors ? "FAIL" : warns ? "REVIEW" : "PASS", score, issues, pages: rows };
}
