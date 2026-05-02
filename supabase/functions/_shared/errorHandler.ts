// Common error handling wrapper for edge function entrypoints.
// Catches all errors, logs them with context, and returns a uniform
// JSON error response with CORS headers.
//
// Usage:
//   import { withErrorHandler } from "../_shared/errorHandler.ts";
//   serve(withErrorHandler("my-function", async (req) => {
//     // ... your handler ...
//     return jsonResponse({ ok: true });
//   }));
//
// Handles automatically:
//   - OPTIONS preflight (returns CORS response)
//   - Uncaught exceptions (logs + 500)
//   - TimeoutError (returns 504)
//   - Known error shapes (HttpError class)

import { corsHeaders, errorResponse, handlePreflight } from "./cors.ts";
import { TimeoutError } from "./withTimeout.ts";

export class HttpError extends Error {
  constructor(message: string, public readonly status: number, public readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "HttpError";
  }
}

export type EdgeHandler = (req: Request) => Promise<Response> | Response;

export function withErrorHandler(functionName: string, handler: EdgeHandler): EdgeHandler {
  return async (req: Request): Promise<Response> => {
    const pre = handlePreflight(req);
    if (pre) return pre;

    const startedAt = Date.now();
    try {
      const res = await handler(req);
      // Ensure CORS is present even if the inner handler forgot.
      if (!res.headers.get("Access-Control-Allow-Origin")) {
        const merged = new Headers(res.headers);
        for (const [k, v] of Object.entries(corsHeaders)) merged.set(k, v);
        return new Response(res.body, { status: res.status, headers: merged });
      }
      return res;
    } catch (e: unknown) {
      const elapsed = Date.now() - startedAt;

      if (e instanceof HttpError) {
        console.error(`[${functionName}] HttpError ${e.status} after ${elapsed}ms:`, e.message, e.extra);
        return errorResponse(e.message, e.status, e.extra);
      }

      if (e instanceof TimeoutError) {
        console.error(`[${functionName}] Timeout after ${elapsed}ms (limit ${e.timeoutMs}ms):`, e.message);
        return errorResponse(`Operation timed out: ${e.message}`, 504, { timeout_ms: e.timeoutMs });
      }

      const msg = e instanceof Error ? e.message : "Unknown error";
      const stack = e instanceof Error ? e.stack : undefined;
      console.error(`[${functionName}] Unhandled error after ${elapsed}ms:`, msg, stack);
      return errorResponse(msg, 500);
    }
  };
}