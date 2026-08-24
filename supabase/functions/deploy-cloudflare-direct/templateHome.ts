// ============================================================================
// POC - TEMPLATE-DRIVEN HOME RENDERER
//
//   HomeTemplateData -> expandTemplate() -> <main> html + theme css
//
// Uses the existing mustache-lite engine from dbTemplate.ts. Renders the page
// body only: head/header/breadcrumbs/footer/cookie/widgets stay in wrapPage().
// Anti-fingerprint is intentionally NOT applied to this output.
// ============================================================================

import { expandTemplate } from "./dbTemplate.ts";
import { buildHomeTemplateData, DEFAULT_HOME_THEME, type HomeThemeTokens } from "./homeTemplateData.ts";
import type { LandingContent, LandingCtx } from "./landingPage.ts";

export interface LoadedTemplate {
  manifest: { name: string; version: string; engine: string; pages: Record<string, string> };
  home: string;
  /** Template runtime v1: commerce page templates (optional). */
  category: string;
  product: string;
  hub: string;
  article: string;
  css: string;
}

const TEMPLATE_DIR = "./site-templates/landing-home/";

/** Reads the on-disk template bundle. Returns null when unavailable (-> fallback). */
export async function loadSiteTemplate(): Promise<LoadedTemplate | null> {
  try {
    const base = new URL(TEMPLATE_DIR, import.meta.url);
    const readOpt = async (rel: string): Promise<string> => {
      try { return await Deno.readTextFile(new URL(rel, base)); } catch { return ""; }
    };
    const [manifestRaw, home, css, category, product, hub, article] = await Promise.all([
      Deno.readTextFile(new URL("template.json", base)),
      Deno.readTextFile(new URL("pages/home.html", base)),
      Deno.readTextFile(new URL("assets/theme.css", base)),
      readOpt("pages/category.html"),
      readOpt("pages/product.html"),
      readOpt("pages/hub.html"),
      readOpt("pages/article.html"),
    ]);
    const manifest = JSON.parse(manifestRaw);
    if (!home.trim() || !css.trim() || !manifest?.pages?.home) return null;
    return { manifest, home, category, product, hub, article, css };
  } catch (e) {
    console.warn("[template-home] template bundle unavailable:", (e as Error).message);
    return null;
  }
}


// ---------------------------------------------------------------------------
// TEMPLATE IMPORT V1: load an imported bundle by template_id.
// Metadata comes from public.site_templates, files from the private
// "site-templates" Storage bucket. Same LoadedTemplate shape as the built-in
// bundle, so every renderer below stays unchanged.
// ---------------------------------------------------------------------------
export async function loadSiteTemplateById(
  db: { from: (t: string) => any; storage: { from: (b: string) => any } },
  templateId: string,
): Promise<LoadedTemplate | null> {
  try {
    const { data: row, error } = await db
      .from("site_templates")
      .select("id, name, version, engine, manifest, pages, css_path, status")
      .eq("id", templateId)
      .maybeSingle();
    if (error || !row || row.status !== "installed") return null;

    const dl = async (p?: string): Promise<string> => {
      if (!p) return "";
      const { data } = await db.storage.from("site-templates").download(p);
      return data ? await data.text() : "";
    };
    const pages = (row.pages || {}) as Record<string, string>;
    const [home, category, product, hub, article, css] = await Promise.all([
      dl(pages.home), dl(pages.category), dl(pages.product), dl(pages.hub), dl(pages.article),
      dl(row.css_path),
    ]);
    if (!home.trim() || !css.trim()) return null;

    return {
      manifest: {
        name: String(row.name || "imported"),
        version: String(row.version || "1.0.0"),
        engine: String(row.engine || "mustache-lite@dbTemplate"),
        pages,
      },
      home, category, product, hub, article, css,
    };
  } catch (e) {
    console.warn("[template-import] bundle load failed:", (e as Error).message);
    return null;
  }
}


export interface TemplateHomeResult {
  mainHtml: string;
  css: string;
  templateName: string;
  templateVersion: string;
}

/** DATA -> TEMPLATE -> HTML. No DB, no LLM, no image generation, no SEO changes. */
export async function renderTemplateHome(args: {
  ctx: LandingCtx;
  content: LandingContent;
  theme?: HomeThemeTokens;
  heroImageUrl?: string;
  template?: LoadedTemplate | null;
}): Promise<TemplateHomeResult | null> {
  const tpl = args.template ?? (await loadSiteTemplate());
  if (!tpl) return null;

  const data = buildHomeTemplateData({
    ctx: args.ctx,
    content: args.content,
    theme: args.theme || DEFAULT_HOME_THEME,
    heroImageUrl: args.heroImageUrl,
  });

  return {
    mainHtml: expandTemplate(tpl.home, data),
    css: expandTemplate(tpl.css, data),
    templateName: String(tpl.manifest.name || "landing-home"),
    templateVersion: String(tpl.manifest.version || "0"),
  };
}


// ---------------------------------------------------------------------------
// Template runtime v1: commerce page bodies (Category, Product).
// The templates render <main> content only. wrapPage() still owns the SEO
// shell: head, title, description, canonical, JSON-LD, breadcrumbs, header,
// footer, cookie banner and widgets.
// ---------------------------------------------------------------------------

/** Theme CSS with the tokens resolved. Append once per bundle. */
export function renderTemplateThemeCss(tpl: LoadedTemplate, tokens: TemplateRowLike): string {
  return expandTemplate(tpl.css, tokens as never);
}

type TemplateRowLike = Record<string, unknown>;

export function renderTemplateCategory(tpl: LoadedTemplate, data: TemplateRowLike): string | null {
  if (!tpl.category?.trim()) return null;
  return expandTemplate(tpl.category, data as never);
}

export function renderTemplateProduct(tpl: LoadedTemplate, data: TemplateRowLike): string | null {
  if (!tpl.product?.trim()) return null;
  return expandTemplate(tpl.product, data as never);
}

export function renderTemplateHub(tpl: LoadedTemplate, data: TemplateRowLike): string | null {
  if (!tpl.hub?.trim()) return null;
  return expandTemplate(tpl.hub, data as never);
}

export function renderTemplateArticle(tpl: LoadedTemplate, data: TemplateRowLike): string | null {
  if (!tpl.article?.trim()) return null;
  return expandTemplate(tpl.article, data as never);
}

/**
 * Swaps only the <main> content of an already rendered page. The SEO shell -
 * head, title, canonical, JSON-LD, header, breadcrumbs, footer, widgets -
 * stays byte-identical.
 */
export function swapMainContent(page: string, mainHtml: string, themeHref?: string): string {
  const m = /<main[^>]*>/i.exec(page);
  const close = page.lastIndexOf("</main>");
  if (!m || close < 0 || close < m.index) return page;
  let out = page.slice(0, m.index + m[0].length) + mainHtml + page.slice(close);
  if (themeHref && !out.includes(themeHref)) {
    out = out.replace("</head>", `<link rel="stylesheet" href="${themeHref}"></head>`);
  }
  return out;
}

/** @deprecated kept for compatibility: the loader serves every page type. */
export const loadHomeTemplate = loadSiteTemplate;
