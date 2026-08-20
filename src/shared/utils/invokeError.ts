/**
 * supabase-js reports every failed edge-function call as
 * "Edge Function returned a non-2xx status code" and hides the response.
 * This helper reads the underlying Response (FunctionsHttpError.context)
 * and returns "HTTP <status>: <error body>" instead.
 */
export async function invokeErrorMessage(err: unknown, fallback = "Request failed"): Promise<string> {
  if (!err) return fallback;
  const anyErr = err as { message?: string; context?: Response };
  const ctx = anyErr.context;
  if (ctx && typeof ctx.text === "function") {
    try {
      const raw = await ctx.clone().text();
      let detail = raw;
      try {
        const parsed = JSON.parse(raw);
        detail = String(parsed?.message || parsed?.error || raw);
      } catch { /* raw text */ }
      if (detail) return `HTTP ${ctx.status}: ${detail}`;
      return `HTTP ${ctx.status}`;
    } catch { /* fall through */ }
  }
  return anyErr.message || fallback;
}
