// Shared cost logger for the Site Factory cost analytics dashboard.
// All edge functions that consume LLM tokens, FAL AI images, deploys or
// scheduled posts should call logCost() best-effort (never throw).
//
// Pricing constants (USD):
//   - Claude Sonnet 4: input $3/1M, output $15/1M
//   - GPT-5: input $1.25/1M, output $10/1M
//   - Gemini 2.5 Flash: input $0.075/1M, output $0.30/1M (proxy estimate)
//   - FAL AI (flux/schnell, portraits, logos): $0.003 per image
//   - Cloudflare Pages deploy: $0

export type OperationType =
  | "site_generation"
  | "article_generation"
  | "fal_ai_photo"
  | "fal_ai_portrait"
  | "fal_ai_logo"
  | "cloudflare_deploy"
  | "auto_post_cron";

export interface CostLogParams {
  project_id?: string | null;
  user_id?: string | null;
  operation_type: OperationType;
  model?: string | null;
  tokens_input?: number;
  tokens_output?: number;
  cost_usd?: number;
  metadata?: Record<string, unknown>;
}

const PRICE_TABLE: Record<string, { in: number; out: number }> = {
  // Per-token (USD). Numbers are $/1M tokens divided by 1_000_000.
  "claude-sonnet-4":            { in: 3 / 1_000_000,    out: 15 / 1_000_000 },
  "anthropic/claude-sonnet-4":  { in: 3 / 1_000_000,    out: 15 / 1_000_000 },
  "claude-opus-4":              { in: 15 / 1_000_000,   out: 75 / 1_000_000 },
  "openai/gpt-5":               { in: 1.25 / 1_000_000, out: 10 / 1_000_000 },
  "openai/gpt-5-mini":          { in: 0.25 / 1_000_000, out: 2 / 1_000_000 },
  "google/gemini-2.5-pro":      { in: 1.25 / 1_000_000, out: 5 / 1_000_000 },
  "google/gemini-2.5-flash":    { in: 0.075 / 1_000_000, out: 0.30 / 1_000_000 },
  "google/gemini-2.5-flash-lite": { in: 0.04 / 1_000_000, out: 0.15 / 1_000_000 },
};

export const FAL_IMAGE_COST_USD = 0.003;

/** Compute USD cost from token usage and model name. Falls back to 0 if unknown. */
export function tokensToUsd(model: string | null | undefined, tokensIn: number, tokensOut: number): number {
  if (!model) return 0;
  const key = String(model).toLowerCase();
  const price = PRICE_TABLE[key] || PRICE_TABLE[key.replace(/^.*\//, "")];
  if (!price) return 0;
  return Math.max(0, tokensIn) * price.in + Math.max(0, tokensOut) * price.out;
}

/**
 * Best-effort write to public.cost_log via service-role client.
 * Never throws — failures are swallowed and logged to console.
 */
export async function logCost(adminClient: any, params: CostLogParams): Promise<void> {
  try {
    const tokensIn = Math.max(0, Math.floor(params.tokens_input || 0));
    const tokensOut = Math.max(0, Math.floor(params.tokens_output || 0));
    let cost = typeof params.cost_usd === "number" ? params.cost_usd : 0;
    if (!cost && (tokensIn > 0 || tokensOut > 0)) {
      cost = tokensToUsd(params.model, tokensIn, tokensOut);
    }
    const row = {
      project_id: params.project_id || null,
      user_id: params.user_id || null,
      operation_type: params.operation_type,
      model: params.model || null,
      tokens_input: tokensIn,
      tokens_output: tokensOut,
      cost_usd: Number(cost.toFixed(6)),
      metadata: params.metadata || {},
    };
    const { error } = await adminClient.from("cost_log").insert(row);
    if (error) console.warn("[costLogger] insert failed:", error.message);
  } catch (e: any) {
    console.warn("[costLogger] error:", e?.message);
  }
}