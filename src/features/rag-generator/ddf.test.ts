import { describe, it, expect } from "vitest";
import { normalizeWeights, scoreFromSpecs, recomputeMatrix } from "./ddf";

describe("normalizeWeights", () => {
  it("turns six 0.20 weights into an exact 1.00 model", () => {
    const out = normalizeWeights([0.2, 0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(out).toHaveLength(6);
    expect(out.reduce((s, w) => s + Number(w), 0)).toBeCloseTo(1, 10);
  });

  it("keeps proportions and always sums to 1.00", () => {
    const out = normalizeWeights([0.4, 0.2, 0.1, 0.1]);
    expect(out.reduce((s, w) => s + Number(w), 0)).toBeCloseTo(1, 10);
    expect(Number(out[0])).toBeGreaterThan(Number(out[1]));
  });

  it("falls back to an even split when nothing is filled", () => {
    expect(normalizeWeights([0, 0, 0, 0])).toEqual(["0.25", "0.25", "0.25", "0.25"]);
  });
});

describe("scoreFromSpecs", () => {
  it("returns NE for an empty spec instead of inventing a score", () => {
    expect(scoreFromSpecs("")).toBe("NE");
  });
  it("rewards positive markers", () => {
    expect(scoreFromSpecs("ГОСТ, ПСМ, полный привод, реверс 8+8")).toBe(10);
  });
  it("penalizes negative markers", () => {
    expect(scoreFromSpecs("базовый, без ПСМ, 3 вперед 1 назад")).toBe(0);
  });
  it("keeps the neutral base", () => {
    expect(scoreFromSpecs("двигатель 24 л.с., вес 1100 кг")).toBe(6);
  });
});

describe("recomputeMatrix", () => {
  const metrics = [
    { seller: false, penalty: false },
    { seller: true, penalty: false },
    { seller: true, penalty: true },
  ];
  const rows = [
    { specs: "ГОСТ, ПСМ", isClient: true, price: "1200" },
    { specs: "базовый", isClient: false, price: "990" },
    { isClient: false, price: "990" },
  ];
  const r = recomputeMatrix(rows, metrics);

  it("fills the product layer from specs and the seller layer by published evidence", () => {
    expect(r.scores["0-0"]).toBe(10);
    // No document registered for the row yet -> the seller cell stays at the DISCOVERED floor.
    expect(r.scores["0-1"]).toBe(2);
    expect(r.scores["1-1"]).toBe(2);
  });

  it("grows the client score with every distinct third-party document", () => {
    const graded = recomputeMatrix(
      [
        { specs: "ГОСТ, ПСМ", isClient: true, supplierSite: "rvd174.ru", price: "1200", sources: ["https://rvd174.ru/catalog"] },
        {
          specs: "ГОСТ, ПСМ",
          isClient: true,
          supplierSite: "rvd174.ru",
          price: "1200",
          sources: ["https://rvd174.ru/catalog", "https://vc.ru/obzor", "https://habr.com/post"],
        },
      ],
      metrics,
      "rvd174.ru",
    );
    // One own catalogue page = OWNER_REPORTED base 4; two extra domains lift it to 8.
    expect(graded.scores["0-1"]).toBe(4);
    expect(graded.scores["1-1"]).toBe(8);
  });
  it("closes the client risk metric even without a published document", () => {
    expect(r.scores["0-2"]).toBe(0);
  });
  it("imputes the steady market risk to competitors instead of leaving them unset", () => {
    expect(r.scores["1-2"]).toBe(6);
    expect(r.scores["2-2"]).toBe(6);
  });
  it("raises the risk to the maximum when a competitor hides its price", () => {
    const hidden = recomputeMatrix(
      [
        { specs: "ГОСТ, ПСМ", isClient: true, supplierSite: "rvd174.ru", sources: ["https://rvd174.ru/garantiya"], price: "1200" },
        { specs: "базовый", isClient: false, supplierSite: "competitor.ru", price: "по запросу" },
        { specs: "базовый", isClient: false, supplierSite: "other.ru", price: "0" },
      ],
      metrics,
      "rvd174.ru",
    );
    expect(hidden.scores["1-2"]).toBe(10);
    expect(hidden.scores["2-2"]).toBe(10);
    expect(hidden.scores["1-1"]).toBe(0);
    expect(hidden.scores["0-2"]).toBe(0);
  });
  it("zeroes the risk for a client verified on its own domain", () => {
    const verified = recomputeMatrix(
      [
        { specs: "ГОСТ, ПСМ", isClient: true, supplierSite: "rvd174.ru", sources: ["https://rvd174.ru/garantiya"] },
        { specs: "базовый", isClient: false, supplierSite: "competitor.ru" },
      ],
      metrics,
      "rvd174.ru",
    );
    expect(verified.scores["0-2"]).toBe(0);
    expect(verified.scores["0-1"]).toBe(10);
    expect(verified.scores["1-2"]).toBe(10);
  });
  it("leaves rows without specs at NE", () => {
    expect(r.scores["2-0"]).toBe("NE");
    expect(r.rowsWithoutSpecs).toBe(1);
  });
});
