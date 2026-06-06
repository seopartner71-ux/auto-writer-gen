// Pipeline observability — fire-and-forget логирование стадий.
// Пишет в public.pipeline_events через service_role. Никогда не бросает —
// падение логирования НЕ должно валить продовый pipeline.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type PipelineStage =
  | "generate"
  | "humanize"
  | "anti_turgenev"
  | "fact_check_llm"
  | "fact_check_web"
  | "fact_check_regex"
  | "sentence_structure"
  | "cancellary_guard"
  | "dangling_thought"
  | "keyword_frequency"
  | "compliance_check"
  | "improve"
  | "commercial_block"
  | "quality_retry";

export type PipelineVerdict = "pass" | "warning" | "fail";

export interface PipelineEvent {
  stage: PipelineStage;
  user_id?: string | null;
  article_id?: string | null;
  verdict?: PipelineVerdict | null;
  score?: number | null;
  duration_ms?: number | null;
  model?: string | null;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  error_kind?: string | null;
  error_message?: string | null;
  meta?: Record<string, unknown>;
}

let cachedClient: ReturnType<typeof createClient> | null = null;
function getClient() {
  if (cachedClient) return cachedClient;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  cachedClient = createClient(url, key);
  return cachedClient;
}

/** Fire-and-forget. Никогда не падает, никогда не блокирует основной поток. */
export function logPipelineEvent(event: PipelineEvent): void {
  try {
    const sb = getClient();
    if (!sb) return;
    // Не await — пусть отправляется в фоне.
    void sb.from("pipeline_events").insert({
      stage: event.stage,
      user_id: event.user_id ?? null,
      article_id: event.article_id ?? null,
      verdict: event.verdict ?? null,
      score: event.score ?? null,
      duration_ms: event.duration_ms ?? null,
      model: event.model ?? null,
      tokens_in: event.tokens_in ?? 0,
      tokens_out: event.tokens_out ?? 0,
      cost_usd: event.cost_usd ?? 0,
      error_kind: event.error_kind ?? null,
      error_message: event.error_message ? String(event.error_message).slice(0, 500) : null,
      meta: event.meta ?? {},
    }).then((res) => {
      if (res.error) console.warn("[pipelineLogger] insert failed:", res.error.message);
    }).catch((e) => console.warn("[pipelineLogger] threw:", (e as Error).message));
  } catch (e) {
    console.warn("[pipelineLogger] sync error:", (e as Error).message);
  }
}

/** Удобный таймер: logPipelineStart() → fn → logPipelineEnd(). */
export function startTimer(): () => number {
  const t0 = Date.now();
  return () => Date.now() - t0;
}