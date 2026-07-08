// Shared cost logger for the Site Factory cost analytics dashboard.
// All edge functions that consume LLM tokens, FAL AI images, deploys or
// scheduled posts should call logCost() best-effort (never throw).
//
// Pricing constants (USD, per 1M tokens, OpenRouter list prices, актуальность 2026-07):
//   - anthropic/claude-sonnet-4:      $3.00 in / $15.00 out
//   - anthropic/claude-opus-4:        $15.00 in / $75.00 out
//   - openai/gpt-5:                   $1.25 in / $10.00 out
//   - openai/gpt-5-mini:              $0.25 in / $2.00 out
//   - google/gemini-2.5-pro:          $1.25 in / $10.00 out (до 200k контекста)
//   - google/gemini-2.5-flash:        $0.30 in / $2.50 out
//   - google/gemini-2.5-flash-lite:   $0.10 in / $0.40 out
//   - mistralai/mistral-large-2411:   $2.00 in / $6.00 out
//   - mistralai/mistral-large-2512:   $2.00 in / $6.00 out
//   - perplexity/sonar:               $1.00 in / $1.00 out (без учёта $5/1000 запросов на поиск)
//   - perplexity/sonar-pro:           $3.00 in / $15.00 out
//   - deepseek/deepseek-chat-v3:      $0.27 in / $1.10 out
//   - FAL AI (flux/schnell, portraits, logos): $0.003 per image
//   - Cloudflare Pages deploy: $0

export type OperationType =
  | "site_generation"
  | "article_generation"
  | "llm_call"
  | "fal_ai_photo"
  | "fal_ai_portrait"
  | "fal_ai_logo"
  | "cloudflare_deploy"
  | "auto_post_cron";

export interface CostLogParams {
  project_id?: string | null;
  user_id?: string | null;
  article_id?: string | null;
  operation_type: OperationType;
  model?: string | null;
  tokens_input?: number;
  tokens_output?: number;
  cost_usd?: number;
  metadata?: Record<string, unknown>;
}

const PRICE_TABLE: Record<string, { in: number; out: number }> = {
  // Per-token (USD). Numbers are $/1M tokens divided by 1_000_000.
  "claude-sonnet-4":              { in: 3 / 1_000_000,    out: 15 / 1_000_000 },
  "anthropic/claude-sonnet-4":    { in: 3 / 1_000_000,    out: 15 / 1_000_000 },
  "claude-opus-4":                { in: 15 / 1_000_000,   out: 75 / 1_000_000 },
  "anthropic/claude-opus-4":      { in: 15 / 1_000_000,   out: 75 / 1_000_000 },
  "anthropic/claude-3.5-haiku":   { in: 0.80 / 1_000_000, out: 4 / 1_000_000 },
  "openai/gpt-5":                 { in: 1.25 / 1_000_000, out: 10 / 1_000_000 },
  "openai/gpt-5-mini":            { in: 0.25 / 1_000_000, out: 2 / 1_000_000 },
  "google/gemini-2.5-pro":        { in: 1.25 / 1_000_000, out: 10 / 1_000_000 },
  "google/gemini-2.5-flash":      { in: 0.30 / 1_000_000, out: 2.50 / 1_000_000 },
  "google/gemini-2.5-flash-lite": { in: 0.10 / 1_000_000, out: 0.40 / 1_000_000 },
  "mistralai/mistral-large-2411": { in: 2 / 1_000_000,    out: 6 / 1_000_000 },
  "mistralai/mistral-large-2512": { in: 2 / 1_000_000,    out: 6 / 1_000_000 },
  "mistralai/mistral-large-latest": { in: 2 / 1_000_000,  out: 6 / 1_000_000 },
  "perplexity/sonar":             { in: 1 / 1_000_000,    out: 1 / 1_000_000 },
  "perplexity/sonar-pro":         { in: 3 / 1_000_000,    out: 15 / 1_000_000 },
  "deepseek/deepseek-chat-v3":    { in: 0.27 / 1_000_000, out: 1.10 / 1_000_000 },
  "deepseek/deepseek-chat":       { in: 0.27 / 1_000_000, out: 1.10 / 1_000_000 },
};

export const FAL_IMAGE_COST_USD = 0.003;

/** Compute USD cost from token usage and model name. Falls back to 0 if unknown. */
export function tokensToUsd(model: string | null | undefined, tokensIn: number, tokensOut: number): number {
  if (!model) return 0;
  const raw = String(model).toLowerCase().trim();
  // модель может прийти как "anthropic/claude-sonnet-4,anthropic/claude-opus-4" (fallback-цепочка) — берём первую
  const key = raw.split(",")[0].trim();
  const price = PRICE_TABLE[key] || PRICE_TABLE[key.replace(/^.*\//, "")];
  if (!price) {
    console.warn("[costLogger] unknown model, cost=0:", key);
    return 0;
  }
  return Math.max(0, tokensIn) * price.in + Math.max(0, tokensOut) * price.out;
}

// Lazy service-role client for standalone helpers (aiClient/humanizePass/...).
let cachedAdmin: any = null;
async function getAdmin() {
  if (cachedAdmin) return cachedAdmin;
  const url = (globalThis as any).Deno?.env?.get?.("SUPABASE_URL");
  const key = (globalThis as any).Deno?.env?.get?.("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    cachedAdmin = createClient(url, key);
    return cachedAdmin;
  } catch (e) {
    console.warn("[costLogger] createClient failed:", (e as Error)?.message);
    return null;
  }
}

/**
 * Удобный helper — вызывать после КАЖДОГО удачного LLM-вызова.
 * Автоматически создаёт service-role клиент, считает цену по PRICE_TABLE и
 * пишет строку в public.cost_log. Никогда не бросает, никогда не блокирует.
 *
 * @param functionName имя edge-функции или под-этапа (пример: "humanize-article/pass1")
 */
export function logLLM(params: {
  functionName: string;
  model: string | null | undefined;
  tokensIn?: number;
  tokensOut?: number;
  userId?: string | null;
  articleId?: string | null;
  projectId?: string | null;
  extraMeta?: Record<string, unknown>;
}): void {
  void (async () => {
    try {
      const admin = await getAdmin();
      if (!admin) return;
      const tokensIn = Math.max(0, Math.floor(params.tokensIn || 0));
      const tokensOut = Math.max(0, Math.floor(params.tokensOut || 0));
      const cost = tokensToUsd(params.model, tokensIn, tokensOut);
      const row = {
        project_id: params.projectId || null,
        user_id: params.userId || null,
        article_id: params.articleId || null,
        operation_type: "llm_call" as OperationType,
        model: params.model || null,
        tokens_input: tokensIn,
        tokens_output: tokensOut,
        cost_usd: Number(cost.toFixed(6)),
        metadata: {
          kind: params.functionName,
          article_id: params.articleId || null,
          ...(params.extraMeta || {}),
        },
      };
      const { error } = await admin.from("cost_log").insert(row);
      if (error) console.warn("[logLLM] insert failed:", error.message, "fn=", params.functionName);
    } catch (e: any) {
      console.warn("[logLLM] error:", e?.message);
    }
  })();
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
        article_id: params.article_id || (typeof params.metadata?.article_id === "string" ? params.metadata.article_id : null),
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