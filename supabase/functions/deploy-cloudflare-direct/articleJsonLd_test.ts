// Part C: every theme must emit EXACTLY ONE Article JSON-LD block.
// The 4 premium themes used to build their own `articleLd` on top of the shared
// one from seoChrome.ts, so each article page carried two Article blocks.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { PostInput, SiteChrome } from "./seoChrome.ts";
import { renderDarkArticle } from "./darkPage.ts";
import { renderExpertArticle } from "./expertPage.ts";
import { renderLocalArticle } from "./localPage.ts";
import { renderMinimalArticle } from "./minimalPage.ts";
import { renderMagazineArticle } from "./magazinePage.ts";
import { renderNewsArticle } from "./newsPage.ts";

const chrome: SiteChrome = {
  domain: "jsonld.example.com",
  siteName: "Тест Метизы",
  siteAbout: "Каталог крепежа и экспертные материалы",
  topic: "крепеж",
  lang: "ru",
  accent: "#6E56CF",
  headingFont: "Inter",
  bodyFont: "Inter",
  projectId: "jsonld-test",
};

const post: PostInput = {
  title: "Как выбрать анкерный болт",
  slug: "ankernyj-bolt",
  excerpt: "Практический разбор выбора анкерного крепежа для бетона и кирпича.",
  contentHtml: "<h2>Материалы</h2><p>Практика показывает, что выбор зависит от основания.</p>",
  publishedAt: "2026-08-01T10:00:00.000Z",
};

function articleLdCount(html: string): number {
  const blocks = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
  return blocks.filter((b) => /"@type"\s*:\s*"Article"/.test(b)).length;
}

const renderers: Record<string, (o: never) => string> = {
  dark: renderDarkArticle as never,
  expert: renderExpertArticle as never,
  local: renderLocalArticle as never,
  minimal: renderMinimalArticle as never,
  magazine: renderMagazineArticle as never,
  news: renderNewsArticle as never,
};

for (const [name, render] of Object.entries(renderers)) {
  Deno.test(`${name} article page emits exactly one Article JSON-LD`, () => {
    const html = render({ chrome, post, related: [] } as never);
    assertEquals(articleLdCount(html), 1, `${name}: duplicate or missing Article JSON-LD`);
  });
}
