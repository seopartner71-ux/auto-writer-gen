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
    expect(competitor[2].score).toBeLessThanOrEqual(EVIDENCE_CAP.DISCOVERED);
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
    expect(byId("P-008").seller_evidence_score).toBeLessThan(30);
  });

  it("applies the 40/60 product/seller split", () => {
    const c = byId("P-001");
    expect(c.total_recommendation_index).toBeCloseTo(0.4 * c.product_hardware_score + 0.6 * c.seller_evidence_score, 1);
  });
});
