import {
  assertEquals,
  assertLessOrEqual,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildArticleTitle,
  buildMetaDescription,
  truncateAtWord,
} from "./metaTitles.ts";

Deno.test("truncateAtWord never keeps a partial final word", () => {
  const source = "Трактор может внезапно начать ломаться после долгой работы";
  const limitInsideWord = source.indexOf("ломаться") + 6;
  assertEquals(truncateAtWord(source, limitInsideWord), "Трактор может внезапно начать");
});

Deno.test("meta description ends at a whole word and stays within 160 chars", () => {
  const source = "Практика показывает, что регулярное техническое обслуживание помогает заранее выявить неисправности, снизить расходы и не допустить ситуации, когда трактор начинает ломаться в разгар работ на участке.";
  const description = buildMetaDescription(source);
  assertLessOrEqual(description.length, 160);
  assertEquals(description.endsWith("."), true);
  assertEquals(description.includes("ломать."), false);
});

Deno.test("article title preserves H1 with a 100 character hard limit", () => {
  const h1 = "Техническое обслуживание мини-трактора: полный регламент сезонных работ";
  const title = buildArticleTitle(h1, "Большая энциклопедия владельца мини-трактора");
  assertEquals(title, h1);
  assertLessOrEqual(title.length, 100);
});

Deno.test("article title above 90 chars drops suffix and truncates H1 at a word", () => {
  const h1 = "Подробное техническое обслуживание мини-трактора для надежной эксплуатации в течение всего сезона без неожиданных поломок";
  const title = buildArticleTitle(h1, "Энциклопедия техники");
  assertLessOrEqual(title.length, 100);
  assertEquals(title.includes("Энциклопедия техники"), false);
  assertEquals(title, truncateAtWord(h1, 90));
});

Deno.test("reported Factory description is safe for meta, Open Graph, Twitter and figcaption", () => {
  const lead = "Честно говоря, многие владельцы минитракторов забывают про регулярное техническое обслуживание. А потом удивляются, почему техника начинает капризничать, ломаться в самый неподходящий момент.";
  const description = buildMetaDescription(lead);
  const surfaces = {
    metaDescription: description,
    ogDescription: description,
    twitterDescription: description,
    figcaption: truncateAtWord(lead, 200),
  };

  assertEquals(surfaces.metaDescription.endsWith("капризничать."), true);
  assertEquals(surfaces.ogDescription, surfaces.metaDescription);
  assertEquals(surfaces.twitterDescription, surfaces.metaDescription);
  assertEquals(surfaces.figcaption.includes("ломат "), false);
  assertEquals(Object.values(surfaces).every((value) => !value.endsWith("ломат")), true);
});