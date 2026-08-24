// ============================================================================
// LENIENT TEMPLATE INTAKE
//
// Allows importing ordinary HTML templates (html5up and friends) that were not
// authored against the strict Template Import V1 contract:
//   - no template.json required
//   - pages can be uploaded one by one, or mapped from an arbitrary ZIP
//   - missing page types are derived from `home`
//
// Everything is still sanitized: scripts, event handlers and external imports
// are stripped before storage. Runtime and the strict contract stay untouched.
// ============================================================================

import { REQUIRED_PAGES } from "./templateContract.ts";
import { sanitizeCss, sanitizeHtml, type TemplateManifest } from "./templateValidator.ts";

export interface LenientBundle {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: TemplateManifest;
  pages?: Record<string, string>;
  css?: string;
}

/** Extracts <main> or <body> content out of a full HTML document. */
export function extractMain(html: string): string {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  if (main) return main[1];
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return body ? body[1] : html;
}

/** Pulls inline <style> blocks so the look survives without external css. */
function inlineStyles(html: string): string {
  let css = "";
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) css += `\n${m[1]}`;
  return css;
}

function cleanPage(raw: string): string {
  const body = extractMain(raw)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<\/?(html|head|body|main)\b[^>]*>/gi, "");
  return sanitizeHtml(body).trim();
}

/**
 * @param rawPages   page type -> raw html (full document or fragment)
 * @param rawCss     concatenated css text (may be empty)
 * @param name       template name shown in the UI
 */
export function buildLenientBundle(
  rawPages: Record<string, string>,
  rawCss: string,
  name: string,
): LenientBundle {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!rawPages.home || !rawPages.home.trim()) {
    errors.push("Нужен как минимум шаблон главной страницы (home)");
    return { ok: false, errors, warnings };
  }

  let css = rawCss || "";
  const pages: Record<string, string> = {};
  for (const type of REQUIRED_PAGES) {
    const raw = rawPages[type];
    if (raw && raw.trim()) {
      css += inlineStyles(raw);
      pages[type] = cleanPage(raw);
      if (!pages[type]) errors.push(`${type}: после очистки не осталось разметки`);
    } else {
      pages[type] = ""; // filled from home below
      warnings.push(`Страница "${type}" не загружена - используется разметка главной`);
    }
  }
  for (const type of REQUIRED_PAGES) {
    if (!pages[type]) pages[type] = pages.home;
  }

  css = sanitizeCss(css).slice(0, 512 * 1024);
  if (!css.trim()) warnings.push("CSS не найден - страницы будут без оформления шаблона");

  if (errors.length) return { ok: false, errors, warnings };

  const manifest: TemplateManifest = {
    name: name || "Imported template",
    version: "1.0.0",
    engine: "mustache-lite@dbTemplate",
    description: "Импортирован в упрощенном режиме (без template.json)",
    pages: Object.fromEntries(REQUIRED_PAGES.map((t) => [t, `pages/${t}.html`])),
    assets: { css: "assets/theme.css" },
  };

  return { ok: true, errors, warnings, manifest, pages, css };
}
