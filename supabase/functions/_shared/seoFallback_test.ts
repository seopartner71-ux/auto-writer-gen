// SILO hub / category pages must always get title, description and H1 built
// from data that already exists (silo or category name + description), even
// when the LLM path is unavailable.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildFallbackSeo } from "./seoFallback.ts";

Deno.test("hub page gets non-empty title / description / h1", () => {
  const seo = buildFallbackSeo({
    pageType: "hub",
    lang: "ru",
    name: "Крепеж",
    description: "Каталог крепежных изделий: болты, гайки, анкеры, дюбели.",
    siteName: "Тест Метизы",
    region: "Москва",
  });
  assert(seo.title.length > 0 && seo.title.length <= 65, seo.title);
  assert(seo.h1.includes("Крепеж"));
  assert(seo.description.length >= 60 && seo.description.length <= 160, seo.description);
  assertEquals(/[\u2014\u2013\u0451]/.test(`${seo.title}${seo.description}${seo.h1}`), false);
});

Deno.test("category page without description still produces metadata", () => {
  const seo = buildFallbackSeo({
    pageType: "category",
    lang: "ru",
    name: "Заклепки вытяжные",
    siloName: "Заклепки",
    siteName: "Тест Метизы",
  });
  assert(seo.title.startsWith("Заклепки вытяжные"));
  assert(seo.description.length > 40);
  assertEquals(seo.h1, "Заклепки вытяжные");
});

Deno.test("titles are cut only on word boundaries", () => {
  const seo = buildFallbackSeo({
    pageType: "category",
    lang: "ru",
    name: "Анкерный болт оцинкованный повышенной прочности для бетонных оснований",
    siteName: "Очень длинное название сайта про крепеж",
  });
  assert(seo.title.length <= 65);
  const src = "Анкерный болт оцинкованный повышенной прочности для бетонных оснований Очень длинное название сайта про крепеж";
  for (const w of seo.title.replace(/-/g, " ").split(" ").filter(Boolean)) {
    assert(src.includes(w), `truncated word: ${w}`);
  }
});

Deno.test("product page description mentions price when it exists", () => {
  const seo = buildFallbackSeo({
    pageType: "product",
    lang: "ru",
    name: "Болт анкерный М10",
    price: 149.5,
    currency: "RUB",
    siloName: "Крепеж",
  });
  assert(seo.description.includes("149.5"));
  assert(seo.title.includes("Болт анкерный М10"));
});
