// Renders SeoContent (already stored in the DB) into HTML + FAQ schema.
// Pure presentation: no generation happens here.

import { escHtml } from "./seoChrome.ts";
import type { SeoContent } from "../_shared/commerceContent.ts";

export function asSeoContent(raw: unknown): SeoContent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<SeoContent>;
  if (!o.h1 && !o.intro && !(o.body || []).length) return null;
  return {
    seo_title: String(o.seo_title || ""),
    seo_description: String(o.seo_description || ""),
    h1: String(o.h1 || ""),
    intro: String(o.intro || ""),
    body: Array.isArray(o.body) ? o.body : [],
    faq: Array.isArray(o.faq) ? o.faq : [],
    entities: Array.isArray(o.entities) ? o.entities : [],
    semantic_terms: Array.isArray(o.semantic_terms) ? o.semantic_terms : [],
    primary_keywords: Array.isArray(o.primary_keywords) ? o.primary_keywords : [],
    secondary_keywords: Array.isArray(o.secondary_keywords) ? o.secondary_keywords : [],
    schema_data: (o.schema_data as Record<string, unknown>) || null,
    generated_by: String(o.generated_by || "unknown"),
    version: Number(o.version || 1),
  };
}

export function introHtml(c: SeoContent | null): string {
  return c?.intro ? `<p class="lead cm-intro">${escHtml(c.intro)}</p>` : "";
}

export function bodyHtml(c: SeoContent | null): string {
  if (!c || !c.body?.length) return "";
  return `<section class="cm-seo">${c.body.map((b) =>
    `${b.heading ? `<h2>${escHtml(b.heading)}</h2>` : ""}<p>${escHtml(b.text)}</p>`).join("")}</section>`;
}

export function faqHtml(c: SeoContent | null, heading: string): string {
  if (!c || !c.faq?.length) return "";
  return `<section class="cm-faq"><h2>${escHtml(heading)}</h2>${c.faq.map((f) =>
    `<div class="cm-faq__item"><h3>${escHtml(f.q)}</h3><p>${escHtml(f.a)}</p></div>`).join("")}</section>`;
}

export function faqLd(c: SeoContent | null): Record<string, unknown> | null {
  if (!c || !c.faq?.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: c.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export function entitiesHtml(c: SeoContent | null, heading: string): string {
  if (!c || !c.entities?.length) return "";
  return `<section class="cm-entities"><h2>${escHtml(heading)}</h2><ul class="cm-entity-list">${
    c.entities.map((e) => `<li>${escHtml(e)}</li>`).join("")}</ul></section>`;
}

export const CONTENT_CSS = `
.cm-seo h2{margin-top:1.8rem}
.cm-faq{margin:2.2rem 0}
.cm-faq__item{padding:.9rem 0;border-bottom:1px solid rgba(0,0,0,.08)}
.cm-faq__item h3{margin:0 0 .35rem;font-size:1.02rem}
.cm-faq__item p{margin:0;opacity:.85}
.cm-entities{margin:1.5rem 0;font-size:.92rem;opacity:.85}
.cm-entity-list{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:.4rem .9rem}
.cm-intro{font-size:1.05rem}
`;