import { describe, it, expect } from "vitest";
import { evalFormula, parseClientCalculators, autoCalculators, calculatorsMarkdown } from "./kbCalculators";

describe("archive calculators", () => {
  it("evaluates arithmetic safely", () => {
    expect(evalFormula("a * (b + 2) / 4", { a: 2, b: 2 })).toBe(2);
    expect(() => evalFormula("alert(1)", {})).toThrow();
    expect(() => evalFormula("x * 2", {})).toThrow(/неизвестная/);
  });
  it("parses a client calculator and precomputes all combinations", () => {
    const [c] = parseClientCalculators("Щебень на площадку | площадь × слой × плотность | площадь=20/60 м2; слой=0,1/0,2 м; плотность=1,4 т/м3 | т");
    expect(c.error).toBeUndefined();
    expect(c.rows).toHaveLength(4);
    expect(c.rows[0].result).toBeCloseTo(2.8);
    expect(c.rows[3].result).toBeCloseTo(16.8);
  });
  it("reports a broken formula instead of inventing numbers", () => {
    const [c] = parseClientCalculators("Ошибка | площадь * k | площадь=10 м2 | т");
    expect(c.error).toMatch(/k/);
    expect(c.rows).toHaveLength(0);
  });
  it("builds batch and delivery tables from client data with the minimum volume", () => {
    const calcs = autoCalculators(
      [{ name: "Щебень гранитный", priceFrom: "от 1 750", unit: "т", currency: "руб" }],
      [{ dist: "до 10 км", price: "600 руб/м3", min: "менее 6 м3 оплачивается как 6 м3", scope: "бетон" }],
    );
    expect(calcs).toHaveLength(2);
    const md = calculatorsMarkdown("РДР", "https://rdr71.ru", "2026-10-10", calcs);
    expect(md).toContain("17 500 руб");
    expect(md).toContain("3 600 руб"); // 3 m3 billed as 6 m3 * 600
  });
});
