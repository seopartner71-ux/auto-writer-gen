// Timeout wrapper for any async operation (fetch calls to AI providers,
// long DB queries, etc). Prevents edge functions from hanging indefinitely
// and consuming the 150s/400s wall-clock budget.
//
// Usage:
//   const data = await withTimeout(
//     fetch("https://api.openai.com/...", { signal }),
//     60_000,
//     "OpenAI request timed out",
//   );
//
// For fetch specifically, prefer fetchWithTimeout which also aborts the
// underlying request via AbortController.

export class TimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = "TimeoutError";
  }
}

/** Wrap a promise with a timeout. Throws TimeoutError on expiry. */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = "Operation timed out",
): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message, timeoutMs)), timeoutMs) as unknown as number;
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * fetch() with hard timeout via AbortController. Aborts the underlying
 * network request, not just the JS promise. Recommended for all upstream
 * API calls (OpenRouter, Serper, WordPress, etc).
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 60_000, signal: externalSignal, ...rest } = init;
  const controller = new AbortController();

  // Forward external aborts to our controller.
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new TimeoutError(`fetch timed out after ${timeoutMs}ms: ${typeof input === "string" ? input : (input as Request).url ?? ""}`, timeoutMs);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Default timeouts (ms) used across the project. Tune centrally. */
export const TIMEOUTS = {
  /** Quick lookup (DB, cache check). */
  fast: 5_000,
  /** Standard external API call (Serper, GSC, WordPress). */
  standard: 30_000,
  /** LLM call (Gemini Flash, GPT-5 mini). */
  ai: 90_000,
  /** Slow LLM (Claude Opus, deep parsing). */
  aiSlow: 150_000,
} as const;