import { describe, it, expect } from "vitest";
import { runLayer1Rules } from "./factRules";

describe("runLayer1Rules", () => {
  it("finds anonymous expert near a quote", () => {
    const t1 = `«Хорошая обвязка решает 80% проблем» — эксперты отмечают, что это критично.`;
    expect(runLayer1Rules(t1).some((x) => x.type === "anon_expert")).toBe(true);

    const t2 = `Практика показывает, что подход работает. «Хорошая обвязка решает 80% проблем».`;
    expect(runLayer1Rules(t2).some((x) => x.type === "anon_expert")).toBe(true);

    expect(runLayer1Rules("")).toEqual([]);
    expect(
      runLayer1Rules("Просто эксперты отмечают что-то без кавычек.").filter((x) => x.type === "anon_expert"),
    ).toEqual([]);
  });

  it("finds FAQ heading without question mark", () => {
    const text = `## Как выбрать газовый котел по мощности\n\nТело абзаца.`;
    const f = runLayer1Rules(text);
    const hit = f.find((x) => x.type === "seam" && x.quote.startsWith("Как выбрать"));
    expect(hit).toBeTruthy();
    expect(hit?.severity).toBe("minor");
    expect(hit?.suggested_fix?.endsWith("?")).toBe(true);
  });

  it("finds broken short sentence without verb", () => {
    const text = `Отопление в доме работает стабильно. По опыту объектов с 1998 года.`;
    const f = runLayer1Rules(text);
    expect(f.some((x) => x.type === "logic_break" && /1998/.test(x.quote))).toBe(true);
  });

  it("does NOT flag sentences with predicatives / short participles", () => {
    const ok = `Для работы необходимо разрешение на работу.`;
    expect(runLayer1Rules(ok).filter((x) => x.type === "logic_break")).toEqual([]);

    const bad = `Прежде всего, это Федеральный закон от 25.`;
    expect(runLayer1Rules(bad).some((x) => x.type === "logic_break" && /Федеральный/.test(x.quote))).toBe(true);
  });

  it("detects keyword stuffing", () => {
    const p = "монтаж газового котла делают быстро. " +
      "монтаж газового котла требует опыта. " +
      "монтаж газового котла нельзя откладывать. " +
      "монтаж газового котла всегда согласуют. " +
      "об этом важно помнить всегда точно.";
    const f = runLayer1Rules(p);
    const hit = f.find((x) => x.type === "keyword_stuffing");
    expect(hit).toBeTruthy();
    // Quote must be the exact fragment from the original text, not normalized.
    expect(hit?.quote).toBe("монтаж газового котла");
    // 4 повторов в одном абзаце — minor (major только при 5+).
    expect(hit?.severity).toBe("minor");
  });

  it("does NOT flag phrase with only 3 repeats in paragraph", () => {
    const p = "монтаж котла один раз. монтаж котла два раза. монтаж котла три раза.";
    const f = runLayer1Rules(p);
    expect(f.some((x) => x.type === "keyword_stuffing")).toBe(false);
  });
});