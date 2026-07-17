import { describe, it, expect } from "vitest";
import { runLayer1Rules } from "./factRules";

describe("runLayer1Rules", () => {
  it("finds anonymous expert near a quote", () => {
    const text = `«Хорошая обвязка решает 80% проблем» — отмечают практикующие специалисты в отрасли.`;
    // Правило-паттерн: "специалисты рекомендуют" — здесь другая формулировка.
    // Проверяем базовый кейс из ТЗ: "эксперты отмечают" рядом с цитатой.
    const text2 = `«Хорошая обвязка решает 80% проблем» — эксперты отмечают, что это критично.`;
    const f = runLayer1Rules(text2);
    expect(f.some((x) => x.ruleId === "anon_expert")).toBe(true);
    // и вариант с "практика показывает"
    const text3 = `Практика показывает, что подход работает. «Хорошая обвязка решает 80% проблем».`;
    const f3 = runLayer1Rules(text3);
    expect(f3.some((x) => x.ruleId === "anon_expert")).toBe(true);
    // sanity: пустой текст
    expect(runLayer1Rules("")).toEqual([]);
    // sanity: чужеродный текст без цитат — не срабатывает
    expect(runLayer1Rules("Просто эксперты отмечают что-то без кавычек.").filter(x=>x.ruleId==='anon_expert')).toEqual([]);
    void text;
  });

  it("finds FAQ heading without question mark", () => {
    const text = `## Как выбрать газовый котел по мощности\n\nТело абзаца.`;
    const f = runLayer1Rules(text);
    expect(f.some((x) => x.ruleId === "faq_no_question")).toBe(true);
  });

  it("finds broken short sentence without verb", () => {
    const text = `Отопление в доме работает стабильно. По опыту объектов с 1998 года.`;
    const f = runLayer1Rules(text);
    expect(f.some((x) => x.ruleId === "broken_sentence")).toBe(true);
  });

  it("detects keyword stuffing", () => {
    const p = "монтаж газового котла делают быстро. " +
      "монтаж газового котла требует опыта. " +
      "монтаж газового котла нельзя откладывать. " +
      "об этом важно помнить всегда точно.";
    const f = runLayer1Rules(p);
    expect(f.some((x) => x.ruleId === "keyword_stuffing")).toBe(true);
  });
});