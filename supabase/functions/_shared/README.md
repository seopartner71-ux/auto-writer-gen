# Edge Function Shared Infrastructure

Use these modules in **all new edge functions** and gradually adopt in
existing ones during normal maintenance. Goal: a single, consistent
pattern instead of 70 hand-rolled snippets.

## Modules

| File | Purpose |
|---|---|
| `cors.ts` | `corsHeaders`, `handlePreflight()`, `jsonResponse()`, `errorResponse()` |
| `auth.ts` | `verifyAuth(req)` — handles end-user JWT and internal queue calls |
| `withTimeout.ts` | `withTimeout()`, `fetchWithTimeout()`, `TIMEOUTS` presets |
| `errorHandler.ts` | `withErrorHandler()` wrapper, `HttpError` class |
| `aiModel.ts` | OpenRouter model resolution (existing) |
| `costLogger.ts` | Cost tracking (existing) |
| `siteLanguages.ts` | Language utilities (existing) |

## Standard pattern for a new edge function

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { withErrorHandler, HttpError } from "../_shared/errorHandler.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { fetchWithTimeout, TIMEOUTS } from "../_shared/withTimeout.ts";

serve(withErrorHandler("my-function", async (req) => {
  const auth = await verifyAuth(req);
  if (auth instanceof Response) return auth; // 401

  const { userId } = auth;
  const admin = adminClient();

  const body = await req.json();
  if (!body?.something) throw new HttpError("Missing 'something'", 400);

  // External call with hard timeout
  const res = await fetchWithTimeout("https://api.example.com/x", {
    timeoutMs: TIMEOUTS.standard,
    headers: { "Content-Type": "application/json" },
    method: "POST",
    body: JSON.stringify({ /* ... */ }),
  });

  if (!res.ok) throw new HttpError(`Upstream ${res.status}`, 502);

  return jsonResponse({ ok: true, userId });
}));
```

## What you get for free

- CORS preflight handled
- CORS headers added to every response (including errors)
- Uncaught exceptions logged with function name + elapsed ms
- `TimeoutError` -> HTTP 504 with `timeout_ms`
- `HttpError(msg, status)` -> structured error response
- Centralized auth: standard JWT *and* internal queue calls (`x-queue-user-id`)

## Migration policy

- **Do NOT** mass-rewrite existing 70 functions. High regression risk.
- **DO** use this pattern for every new function from now on.
- **DO** migrate an existing function to this pattern only when you're
  already touching it for another reason (bug fix, feature). Test the
  full flow afterwards.
- Default timeouts to use:
  - DB / cache lookup: `TIMEOUTS.fast` (5s)
  - Serper / GSC / WordPress / external APIs: `TIMEOUTS.standard` (30s)
  - LLM (Gemini Flash, GPT-5 mini): `TIMEOUTS.ai` (90s)
  - Slow LLM (Claude Opus, deep parsing): `TIMEOUTS.aiSlow` (150s)