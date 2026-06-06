// Integration test for runDoubleHumanizePass with the "пункт 4" structure hint.
//
// Hits live OpenRouter (Sonnet + Opus). Skipped when OPENROUTER_API_KEY is not set.
//
// Verifies:
//   1. Двойной проход возвращает изменённый контент.
//   2. Markdown-структура (## заголовок, список, ссылка) сохраняется.
//   3. Цепочки "в то время как / поскольку / что" в одном предложении падают
//      минимум на 50% после humanize - пункт 4 реально работает.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runDoubleHumanizePass } from "../_shared/humanizePass.ts";

const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY");

// Источник в markdown - так контент реально приходит в humanize-article
// (см. SYSTEM_RU в humanizePass.ts: "Сохрани структуру markdown").
const SAMPLE_RU = `## Контракт против собственного производства

Контракт снимает капекс, дает гибкие MOQ, в то время как собственный цех требует серьезных вложений, поскольку оборудование дорожает каждый квартал, что создает дополнительные операционные риски для бизнеса.

Команда выбирает контракт, в то время как конкуренты строят цех, поскольку рынок нестабилен, что заставляет пересматривать стратегию каждые полгода и сокращать горизонт планирования до квартала.

- Снижение капекса на 60%, в то время как операционные расходы растут на 12% в год, поскольку поставщики поднимают цены, что давит на маржу бизнеса.
- Гибкие MOQ от 500 единиц, поскольку контрактный завод обслуживает несколько брендов одновременно, что снижает порог входа для тестовых партий.
- Скорость релиза - 6 недель, в то время как собственный цех дает 14 недель цикла, поскольку нужны наладка и обучение, что критично для сезонных запусков.

Практика показывает, что контрактная модель работает в нишах с быстрым жизненным циклом, в то время как собственное производство выигрывает на больших тиражах, поскольку удельная себестоимость падает за счет масштаба, что окупает капитальные вложения за 24-36 месяцев работы.

Подробнее в обзоре [отраслевой отчет](https://example.com/report) и в материалах ассоциации производителей.`;

function countChain(text: string): number {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const sentences = plain.split(/(?<=[.!?])\s+/);
  let n = 0;
  for (const s of sentences) {
    const markers = [
      /в то время как/i.test(s),
      /поскольку/i.test(s),
      /,\s*что\s+/i.test(s),
    ].filter(Boolean).length;
    if (markers >= 2) n++;
  }
  return n;
}

function countHeadings(text: string): number {
  return (text.match(/^\s{0,3}#{1,6}\s+/gm) || []).length;
}

function countListItems(text: string): number {
  return (text.match(/^\s{0,3}[-*+]\s+/gm) || []).length;
}

Deno.test({
  name: "humanize-article: пункт 4 снижает цепочки и сохраняет markdown",
  ignore: !OPENROUTER_KEY,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const before = SAMPLE_RU;
    const beforeChains = countChain(before);
    assert(beforeChains >= 4, `sample must contain chained violations, got ${beforeChains}`);

    const headingsBefore = countHeadings(before);
    const listBefore = countListItems(before);

    const result = await runDoubleHumanizePass(before, "ru", OPENROUTER_KEY);
    console.log("[test] passes:", result.passesApplied, "models:", result.modelsUsed);
    assert(result.passesApplied >= 1, "at least one humanize pass must succeed");

    const after = result.content;

    // 1. Markdown-структура жива
    const headingsAfter = countHeadings(after);
    const listAfter = countListItems(after);
    console.log("[test] headings:", headingsBefore, "->", headingsAfter,
      "list items:", listBefore, "->", listAfter);
    assert(headingsAfter >= headingsBefore, "headings must be preserved");
    assert(listAfter >= listBefore, "list items must be preserved");
    assert(after.includes("https://example.com/report"), "link URL must survive");

    // 2. Цепочки маркеров должны заметно уменьшиться
    const afterChains = countChain(after);
    console.log("[test] chains before:", beforeChains, "after:", afterChains);
    assert(
      afterChains <= Math.floor(beforeChains / 2),
      `expected at least 50% drop in chains (was ${beforeChains}, now ${afterChains})`,
    );
  },
});

Deno.test({
  name: "humanize-article: skipped when OPENROUTER_API_KEY missing",
  ignore: !!OPENROUTER_KEY,
  fn: () => {
    console.log("[test] no OPENROUTER_API_KEY in env - integration test skipped");
  },
});
