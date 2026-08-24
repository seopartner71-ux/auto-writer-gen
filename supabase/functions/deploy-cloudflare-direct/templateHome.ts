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
  css: string;
}

const TEMPLATE_DIR = "./site-templates/landing-home/";

/** Reads the on-disk template bundle. Returns null when unavailable (-> fallback). */
export async function loadHomeTemplate(): Promise<LoadedTemplate | null> {
  try {
    const base = new URL(TEMPLATE_DIR, import.meta.url);
    const [manifestRaw, home, css] = await Promise.all([
      Deno.readTextFile(new URL("template.json", base)),
      Deno.readTextFile(new URL("pages/home.html", base)),
      Deno.readTextFile(new URL("assets/theme.css", base)),
    ]);
    const manifest = JSON.parse(manifestRaw);
    if (!home.trim() || !css.trim() || !manifest?.pages?.home) return null;
    return { manifest, home, css };
  } catch (e) {
    console.warn("[template-home] template bundle unavailable:", (e as Error).message);
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
  const tpl = args.template ?? (await loadHomeTemplate());
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
