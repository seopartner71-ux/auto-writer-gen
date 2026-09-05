import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applySafeNarrationFixes, countNarrationViolations } from "./narrationVoice.ts";

Deno.test("ru: possessives switched to 'мы' voice, tags untouched", () => {
  const src = `<p class="my">В моей практике мне помогает мой чек-лист.</p>`;
  const out = applySafeNarrationFixes(src, "my", "ru");
  assertEquals(out, `<p class="my">В нашей практике нам помогает наш чек-лист.</p>`);
});

Deno.test("ru: subject pronoun remains a violation for the LLM pass", () => {
  const out = applySafeNarrationFixes("<p>Я считаю иначе.</p>", "my", "ru");
  assertEquals(countNarrationViolations(out, "my", "ru"), 1);
});

Deno.test("en: I -> we with verb agreement", () => {
  const out = applySafeNarrationFixes("<p>I am sure my team helps me.</p>", "my", "en");
  assertEquals(out, "<p>We are sure our team helps us.</p>");
  assertEquals(countNarrationViolations(out, "my", "en"), 0);
});

Deno.test("no violations for the matching voice", () => {
  assertEquals(countNarrationViolations("<p>Мы рекомендуем наш подход.</p>", "my", "ru"), 0);
});
