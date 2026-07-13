// Plan-aware default AI model for the writer.
// PRO/FACTORY get Claude Opus 4 by default (topline model they pay for).
// FREE/NANO gets Opus for the very first article (subsidised aha-moment),
// then Gemini Flash for the remaining free credits.
export function getDefaultModel(
  plan: string | null | undefined,
  articlesCount: number,
): string {
  const p = (plan || "free").toLowerCase();
  if (p === "free" || p === "nano") {
    return articlesCount === 0
      ? "anthropic/claude-opus-4"
      : "google/gemini-2.5-flash";
  }
  // basic = PRO, pro = FACTORY in this codebase
  if (p === "basic" || p === "pro" || p === "factory" || p === "business" || p === "enterprise") {
    return "anthropic/claude-opus-4";
  }
  return "google/gemini-2.5-flash";
}

export const WRITER_MODEL_RESET_FLAG = "writer_model_reset_v3_opus_default";