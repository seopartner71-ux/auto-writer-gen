// Integration test for runDoubleHumanizePass with the "пункт 4" structure hint.
//
// Hits live OpenRouter (Sonnet + Opus). Skipped automatically when
// OPENROUTER_API_KEY is not set in env.
//
// Verifies:
//   1. Двойной проход возвращает изменённый контент.
//   2. HTML-теги (<h2>, <ul>, <li>, <a>) сохраняются.
//   3. Цепочки "в то время как / поскольку / что" в одном предложении падают.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runDoubleHumanizePass } from "../_shared/humanizePass.ts";

const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY");

const SAMPLE_RU = `<h2>Контракт против собственного производства</h2>

<p>Контракт снимает капекс, дает гибкие MOQ, в то время как собственный цех требует серьезных вложений, поскольку оборудование дорожает каждый квартал, что создает дополнительные операционные риски для бизнеса.</p>

<p>Команда выбирает контракт, в то время как конкуренты строят цех, поскольку рынок нестабилен, что заставляет пересматривать стратегию каждые полгода и сокращать горизонт планирования до квартала.</p>

<ul>
  <li>Снижение капекса на 60%, в то время как операционные расходы растут на 12% в год, поскольку поставщики поднимают цены, что давит на маржу.</li>
  <li>Гибкие MOQ от 500 единиц, поскольку контрактный завод обслуживает несколько брендов одновременно, что снижает порог входа для тестовых партий.</li>
  <li>Скорость релиза - 6 недель, в то время как собственный цех дает 14 недель цикла, поскольку нужны наладка и обучение, что критично для сезонных запусков.</li>
</ul>

<p>Практика показывает, что контрактная модель работает в нишах с быстрым жизненным циклом, в то время как собственное производство выигрывает на больших тиражах, поскольку удельная себестоимость падает за счет масштаба, что окупает капитальные вложения за 24-36 месяцев.</p>

<p>Подробнее в обзоре <a href="https://example.com/report">отраслевой отчет</a>.</p>`;

function countChain(text: string): number {
  const sentences = text.split(/(?<=[.!?])\s+/);
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

function countTags(text: string, tag: string): number {
  const re = new RegExp(`<${tag}(\\s[^>]*)?>`, "gi");
  return (text.match(re) || []).length;
}

Deno.test({
  name: "humanize-article: пункт 4 снижает цепочки и не ломает HTML",
  ignore: !OPENROUTER_KEY,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const before = SAMPLE_RU;
    const beforeChains = countChain(before);
    assert(beforeChains >= 4, `sample must contain chained violations, got ${beforeChains}`);

    const tagsBefore = {
      h2: countTags(before, "h2"),
      ul: countTags(before, "ul"),
      li: countTags(before, "li"),
      a: countTags(before, "a"),
    };

    const result = await runDoubleHumanizePass(before, "ru", OPENROUTER_KEY);

    console.log("[test] passes:", result.passesApplied, "models:", result.modelsUsed);
    assert(result.passesApplied >= 1, "at least one humanize pass must succeed");

    const after = result.content;

    const tagsAfter = {
      h2: countTags(after, "h2"),
      ul: countTags(after, "ul"),
      li: countTags(after, "li"),
      a: countTags(after, "a"),
    };
    console.log("[test] tags before:", tagsBefore, "after:", tagsAfter);
    assertEquals(tagsAfter.h2, tagsBefore.h2, "h2 must be preserved");
    assertEquals(tagsAfter.ul, tagsBefore.ul, "ul must be preserved");
    assertEquals(tagsAfter.li, tagsBefore.li, "li must be preserved");
    assertEquals(tagsAfter.a, tagsBefore.a, "anchors must be preserved");
    assert(after.includes("https://example.com/report"), "link URL must survive");

    const afterChains = countChain(after);
    console.log("[test] chains before:", beforeChains, "after:", afterChains);
    assert(
      afterChains < beforeChains,
      `chained violations must drop (was ${beforeChains}, now ${afterChains})`,
    );
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
