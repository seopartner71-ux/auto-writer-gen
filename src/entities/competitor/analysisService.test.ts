import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { buildAnalysisContext, type DeepParseResult } from "./analysisService";

const base = {
  benchmark: { target_word_count: 1500, median_word_count: 1300, target_img_count: 3, median_img_count: 2, target_h2_count: 6, median_h2_count: 5, median_keyword_density: 1, video_percentage: 10 },
  entities: [], tfidf_phrases: [], per_competitor: [], best_competitor_headings: {},
  must_use_phrases: [{ phrase: "насыпная плотность", reason: "" }, { phrase: "доставка за 2 часа", reason: "" }],
  lsi_success_phrases: ["политика конфиденциальности"],
  term_actions: [
    { phrase: "насыпная плотность", action: "add", reason: "", source: "" },
    { phrase: "доставка за 2 часа", action: "check", reason: "сроки", source: "" },
    { phrase: "политика конфиденциальности", action: "skip", reason: "шаблон", source: "" },
  ],
} as unknown as DeepParseResult;

describe("buildAnalysisContext term actions", () => {
  it("keeps only add phrases as LSI and lists check/skip separately", () => {
    const ctx = buildAnalysisContext(base);
    const lsi = ctx.split("LSI PHRASES (critical for ranking):\n")[1].split("\n")[0];
    expect(lsi).toBe("насыпная плотность");
    expect(ctx).toContain("CHECK AGAINST CLIENT FACTS");
    expect(ctx).toContain("- доставка за 2 часа (сроки)");
    expect(ctx).toContain("DO NOT USE");
    expect(ctx).toContain("- политика конфиденциальности");
  });
  it("works with old results without term_actions", () => {
    const ctx = buildAnalysisContext({ ...base, term_actions: undefined });
    expect(ctx).not.toContain("CHECK AGAINST");
    expect(ctx).toContain("доставка за 2 часа");
  });
});
