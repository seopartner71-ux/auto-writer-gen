// Centralized CORS headers for all edge functions.
// Use this instead of redefining corsHeaders in every function.
//
// Usage:
//   import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
//   const pre = handlePreflight(req); if (pre) return pre;
//   return new Response(JSON.stringify(data), {
//     headers: { ...corsHeaders, "Content-Type": "application/json" },
//   });

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-queue-user-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
  "Access-Control-Max-Age": "86400",
};

/** Returns a preflight Response if the request is OPTIONS, else null. */
export function handlePreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}

/** Build a JSON response with CORS headers. */
export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

/** Standard error response with CORS headers. */
export function errorResponse(message: string, status = 500, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ error: message, ...extra }, status);
}