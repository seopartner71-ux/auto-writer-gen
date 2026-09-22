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
    { specs: "ГОСТ, ПСМ", isClient: true },
    { specs: "базовый", isClient: false },
    { isClient: false },
  ];
  const r = recomputeMatrix(rows, metrics);

  it("fills the product layer from specs and the seller layer by transparency", () => {
    expect(r.scores["0-0"]).toBe(10);
    expect(r.scores["0-1"]).toBe(10);
    expect(r.scores["1-1"]).toBe(2);
  });
  it("never auto-fills penalty metrics", () => {
    expect(r.scores["0-2"]).toBeUndefined();
  });
  it("leaves rows without specs at NE", () => {
    expect(r.scores["2-0"]).toBe("NE");
    expect(r.rowsWithoutSpecs).toBe(1);
  });
});
