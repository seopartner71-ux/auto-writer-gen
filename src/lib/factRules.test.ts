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

  it("finds FAQ h3 without '?' only inside FAQ section", () => {
    const text = [
      "## Вопросы и ответы",
      "",
      "### Как выбрать газовый котел по мощности",
      "",
      "Тело абзаца.",
    ].join("\n");
    const f = runLayer1Rules(text);
    const hit = f.find((x) => x.type === "seam" && x.quote.startsWith("Как выбрать"));
    expect(hit).toBeTruthy();
    expect(hit?.severity).toBe("minor");
    expect(hit?.suggested_fix?.endsWith("?")).toBe(true);
  });

  it("does NOT flag h2 headings and h3 outside FAQ section", () => {
    const text = [
      "## Что говорит отрасль - короткая цитата",
      "",
      "### Как выбрать котел",
      "",
      "Тело.",
    ].join("\n");
    const f = runLayer1Rules(text);
    expect(f.filter((x) => x.type === "seam" && /Как выбрать|Что говорит/.test(x.quote))).toEqual([]);
  });

  it("(a) flags subordinator without main clause", () => {
    const text = `Если это газовый котел отопления частного дома.`;
    const hit = runLayer1Rules(text).find((x) => x.type === "seam" && /Если/.test(x.quote));
    expect(hit).toBeTruthy();
    expect(hit?.severity).toBe("minor");
  });

  it("(a) does NOT flag subordinator with a main clause", () => {
    const text = `Если холодно, включите отопление.`;
    expect(runLayer1Rules(text).some((x) => x.type === "seam")).toBe(false);
  });

  it("(b) flags sentence ending with a number followed by dot", () => {
    const text = `Прежде всего, это Федеральный закон от 25.`;
    const hit = runLayer1Rules(text).find((x) => x.type === "seam" && /Федеральный/.test(x.quote));
    expect(hit).toBeTruthy();
    expect(hit?.severity).toBe("major");
  });

  it("(c) flags sentence starting with preposition and no predicate", () => {
    const text = `По опыту объектов с 1998 года.`;
    const hit = runLayer1Rules(text).find((x) => x.type === "seam" && /1998/.test(x.quote));
    expect(hit).toBeTruthy();
    expect(hit?.severity).toBe("minor");
  });

  it("does NOT flag nominative / elliptic dash sentences", () => {
    const cases = [
      `Настенные - компактные, легкие.`,
      `Ресурс средний, сервис простой.`,
      `Суть простая.`,
      `AXIS - альтернатива для экономии.`,
    ];
    for (const t of cases) {
      expect(runLayer1Rules(t).some((x) => x.type === "seam")).toBe(false);
    }
  });

  it("does NOT flag imperative sentences", () => {
    const cases = [
      `Понюхайте фильтр перед установкой.`,
      `Нажмите на кнопку запуска.`,
      `Проверьте давление в системе.`,
    ];
    for (const t of cases) {
      expect(runLayer1Rules(t).some((x) => x.type === "seam")).toBe(false);
    }
  });

  it("does NOT flag full sentence with predicative", () => {
    const ok = `Для работы необходимо разрешение на работу.`;
    expect(runLayer1Rules(ok).some((x) => x.type === "seam")).toBe(false);
  });

  it("strips HTML tags before analysis — quote must not contain tags", () => {
    const html = `<p>По опыту объектов с 1998 года.</p>`;
    const hit = runLayer1Rules(html).find((x) => x.type === "seam" && /1998/.test(x.quote));
    expect(hit).toBeTruthy();
    expect(hit?.quote).not.toMatch(/<[^>]+>/);
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