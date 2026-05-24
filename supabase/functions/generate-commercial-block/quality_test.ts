import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyAntiFakeGuard,
  countWords,
  keywordDensity,
  stripFences,
} from "./quality.ts";

Deno.test("countWords strips tags and counts words", () => {
  assertEquals(countWords("<p>один два три</p>"), 3);
  assertEquals(countWords("<h2>Привет</h2><p>мир</p>"), 2);
  assertEquals(countWords(""), 0);
});

Deno.test("keywordDensity finds occurrences case-insensitively", () => {
  const html = "<p>SEO услуги seo продвижение. SEO для бизнеса.</p>";
  const d = keywordDensity(html, "seo");
  assertEquals(d.count, 3);
  assert(d.density > 0);
});

Deno.test("keywordDensity returns zero for empty keyword", () => {
  const d = keywordDensity("<p>любой текст</p>", "");
  assertEquals(d.count, 0);
  assertEquals(d.density, 0);
});

Deno.test("stripFences removes ``` wrappers", () => {
  assertEquals(stripFences("```html\n<p>x</p>\n```"), "<p>x</p>");
  assertEquals(stripFences("```\n<p>x</p>\n```"), "<p>x</p>");
  assertEquals(stripFences("<p>x</p>"), "<p>x</p>");
});

Deno.test("applyAntiFakeGuard neutralizes fabricated phone", () => {
  const html = "<p>Звоните +7 (495) 123-45-67 круглосуточно.</p>";
  const { content, flagged } = applyAntiFakeGuard(html, { keyword: "услуги" });
  assert(content.includes("по телефону на сайте"));
  assert(flagged.some((f) => f.startsWith("phone:")));
});

Deno.test("applyAntiFakeGuard keeps phone present in brief", () => {
  const html = "<p>Звоните +7 (495) 123-45-67.</p>";
  const { content, flagged } = applyAntiFakeGuard(html, {
    parsed_phone: "+74951234567",
  });
  assert(content.includes("123-45-67"));
  assertEquals(flagged.filter((f) => f.startsWith("phone:")).length, 0);
});

Deno.test("applyAntiFakeGuard neutralizes fake email", () => {
  const html = "<p>Пишите на info@example-fake.ru.</p>";
  const { content, flagged } = applyAntiFakeGuard(html, {});
  assert(content.includes("по e-mail на сайте"));
  assert(flagged.some((f) => f.startsWith("email:")));
});

Deno.test("applyAntiFakeGuard neutralizes fake stat", () => {
  const html = "<p>По данным исследования рынка 87% клиентов довольны.</p>";
  const { content, flagged } = applyAntiFakeGuard(html, {});
  assert(content.toLowerCase().includes("практика показывает"));
  assert(flagged.some((f) => f.startsWith("fake_stat:")));
});

Deno.test("applyAntiFakeGuard neutralizes fake expert citation", () => {
  const html = "<p>Иван Петров, директор агентства, отмечает рост.</p>";
  const { content, flagged } = applyAntiFakeGuard(html, {});
  assert(content.includes("эксперты отрасли отмечают"));
  assert(flagged.some((f) => f.startsWith("fake_expert:")));
});

Deno.test("applyAntiFakeGuard neutralizes fake year of research", () => {
  const html = "<p>Исследование 2019 года показало изменения.</p>";
  const { content, flagged } = applyAntiFakeGuard(html, {});
  assert(content.includes("по наблюдениям из практики"));
  assert(flagged.some((f) => f.startsWith("fake_year:")));
});

Deno.test("applyAntiFakeGuard leaves clean HTML untouched", () => {
  const html = "<p>Конкретная польза для бизнеса без выдуманных фактов.</p>";
  const { content, flagged } = applyAntiFakeGuard(html, {});
  assertEquals(content, html);
  assertEquals(flagged.length, 0);
});