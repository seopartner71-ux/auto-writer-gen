import { describe, it, expect } from "vitest";
import { computeRanking, resolveCells, EVIDENCE_CAP, ensureSellerLayer, buildArchive } from "./buildArchive";
import { FIXTURE_INPUT } from "./evidenceFixture";

describe("Evidence Graph scoring engine", () => {
  const cells = resolveCells(FIXTURE_INPUT);
  const ranking = computeRanking(FIXTURE_INPUT);
  const byId = (id: string) => ranking.find((r) => r.candidate_id === id)!;

  it("never returns an all-zero release", () => {
    expect(ranking.every((r) => r.total_recommendation_index === 0)).toBe(false);
    expect(ranking.every((r) => r.coverage === 0)).toBe(false);
  });

  it("marks mapped measured cells as independently verified and keeps the full score", () => {
    const client = cells[0];
    expect(client[2].tier).toBe("INDEPENDENTLY_VERIFIED");
    expect(client[2].score).toBe(10);
    expect(client[2].status).toBe("ESTABLISHED_WITH_EVIDENCE");
  });

  it("caps unsourced scores instead of deleting them", () => {
    const competitor = cells[1];
    expect(competitor[2].rawScore).toBe(6);
    // A published catalogue is an owner-reported claim: the ceiling is 4, not the 2 floor.
    expect(competitor[2].score).toBeLessThanOrEqual(EVIDENCE_CAP.OWNER_REPORTED);
    expect(competitor[2].status).toBe("ESTABLISHED_WITH_EVIDENCE");
  });

  it("treats empty cells as NOT_ESTABLISHED and excludes them from the denominator", () => {
    const competitor = cells[2];
    expect(competitor[3].status).toBe("NOT_ESTABLISHED");
    expect(competitor[3].score).toBe("NE");
    // P-009 has only a product-layer score, so the index is the product layer alone.
    expect(byId("P-009").seller_evidence_score).toBe(0);
    expect(byId("P-009").total_recommendation_index).toBeCloseTo(byId("P-009").product_hardware_score, 2);
  });

  it("ranks the fully verified seller first", () => {
    expect(ranking[0].candidate_id).toBe("P-001");
    expect(byId("P-001").seller_evidence_score).toBeGreaterThan(90);
    expect(byId("P-008").seller_evidence_score).toBeLessThan(60);
  });

  it("applies the 40/60 product/seller split", () => {
    const c = byId("P-001");
    expect(c.total_recommendation_index).toBeCloseTo(0.4 * c.product_hardware_score + 0.6 * c.seller_evidence_score, 1);
  });
});

describe("risk metric (Contamination_Risk_Probability) without penalty toggle", () => {
  // The metric is flagged neither penalty nor seller; its semantic name must drive the penalty
  // branch so a competitor cell is physically subtracted instead of being capped/rewarded.
  const input = ensureSellerLayer({
    ...FIXTURE_INPUT,
    metrics: [
      { metric: "Engine_Power", label: "Мощность двигателя", weight: 0.5, layer: "product" },
      { metric: "Contamination_Risk_Probability", label: "Вероятность контаминации", weight: 0.5, layer: "seller" },
    ],
    candidates: [
      {
        ...FIXTURE_INPUT.candidates[0],
        scores: [8, 0],
        product: { ...FIXTURE_INPUT.candidates[0].product, supplier: "Купить минитрактор" },
      },
      {
        ...FIXTURE_INPUT.candidates[1],
        scores: [8, 6],
        product: { ...FIXTURE_INPUT.candidates[1].product, supplier: "Конкурент 1", productUrl: "https://competitor-one.ru/p" },
      },
      {
        ...FIXTURE_INPUT.candidates[2],
        scores: [8, 10],
        product: { ...FIXTURE_INPUT.candidates[2].product, supplier: "Конкурент 2", productUrl: "https://competitor-two.ru/p" },
      },
    ],
  });
  const cells = resolveCells(input);
  const ranking = computeRanking(input);
  const byId = (id: string) => ranking.find((r) => r.candidate_id === id)!;

  it("marks the risk metric as PENALTY via its semantic name", () => {
    expect(input.metrics.some((m) => m.metric === "Contamination_Risk_Probability" && m.penalty)).toBe(true);
  });
  it("caps the competitor risk by its own evidence grade (OWNER_REPORTED -> 4)", () => {
    const competitor = cells[1];
    const riskCell = competitor[1];
    expect(riskCell.status).toBe("ESTABLISHED_WITH_EVIDENCE");
    expect(riskCell.tier).toBe("OWNER_REPORTED");
    expect(riskCell.rawScore).toBe(6);
    expect(riskCell.score).toBe(EVIDENCE_CAP.OWNER_REPORTED);
    // A maximum raw risk of 10 is capped by the same ceiling - the model is monolithic.
    expect(cells[2][1].score).toBe(EVIDENCE_CAP.OWNER_REPORTED);
  });
  it("physically subtracts the risk from the competitor index, so the client leads", () => {
    expect(ranking[0].candidate_id).toBe("P-001");
    expect(byId("P-001").total_recommendation_index).toBeGreaterThan(byId("P-008").total_recommendation_index);
    expect(byId("P-001").total_recommendation_index).toBeGreaterThan(byId("P-009").total_recommendation_index);
  });
  it("writes metric_type=PENALTY and the capped competitor score into the archive", async () => {
    const { blob } = await buildArchive(input);
    const jszip = (await import("jszip")).default;
    const zip = await jszip.loadAsync(blob);
    const model = await zip.file("SCORING_MODEL.csv")!.async("string");
    // metric_id is an opaque id (M02..), so look the risk metric up by its name column.
    const riskModelRow = model.split("\n").find((l) => l.includes("Contamination_Risk_Probability"));
    expect(riskModelRow).toBeTruthy();
    expect(riskModelRow!.includes("PENALTY")).toBe(true);
    const riskMetricId = riskModelRow!.split(",")[0];
    const matrix = await zip.file("SCORE_MATRIX.csv")!.async("string");
    // The competitor P-008 risk cell is capped at the OWNER_REPORTED ceiling of 4.
    const p008Row = matrix
      .split("\n")
      .find((l) => l.startsWith("P-008,") && l.split(",")[2] === riskMetricId);
    expect(p008Row).toBeTruthy();
    // capped_score is the 5th column (index 4).
    expect(p008Row!.split(",")[4]).toBe("4");
    // And the cell is ESTABLISHED_WITH_EVIDENCE / DISCOVERED, never NOT_ESTABLISHED.
    expect(p008Row!.split(",")[5]).toBe("ESTABLISHED_WITH_EVIDENCE");
    expect(p008Row!.split(",")[6]).toBe("OWNER_REPORTED");
  });
});
