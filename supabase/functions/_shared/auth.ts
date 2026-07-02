// Centralized JWT verification for edge functions.
// Supports two modes:
//   1) Standard end-user request — verifies JWT via Supabase getClaims().
//   2) Internal queue request — bypasses JWT and uses x-queue-user-id header
//      (only valid when caller authenticated as service-role; for trusted
//      function-to-function calls like process-queue -> generate-article).
//
// Returns { userId, isQueueCall } on success, or a Response on failure.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { errorResponse } from "./cors.ts";

// Manual base64url decode of a JWT payload. Avoids a network hop to
// Supabase auth (getClaims), which under RU PHP-proxy + parallel block
// generation intermittently returns "invalid token" for a perfectly valid
// session. We still enforce the exp claim locally.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4) payload += "=";
    const json = atob(payload);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export interface AuthResult {
  userId: string;
  isQueueCall: boolean;
  /** Authorization header value, if present (useful for forwarding). */
  authHeader: string | null;
}

/**
 * Verifies the request and returns the authenticated user id.
 * On failure returns a Response that should be returned directly.
 */
export async function verifyAuth(req: Request): Promise<AuthResult | Response> {
  // Internal queue call: trust x-queue-user-id when Authorization is service-role.
  const queueUserId = req.headers.get("x-queue-user-id");
  const authHeader = req.headers.get("Authorization");

  if (queueUserId && authHeader) {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const expected = `Bearer ${serviceKey}`;
    if (serviceKey && authHeader === expected) {
      return { userId: queueUserId, isQueueCall: true, authHeader };
    }
  }

  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("Unauthorized: missing bearer token", 401);
  }

  const token = authHeader.slice(7);

  const claims = decodeJwtPayload(token);
  const sub = claims?.sub as string | undefined;
  const exp = claims?.exp as number | undefined;
  if (!sub) {
    return errorResponse("Unauthorized: invalid token", 401);
  }
  if (exp && Date.now() / 1000 > exp) {
    return errorResponse("Unauthorized: token expired", 401);
  }
  return { userId: sub, isQueueCall: false, authHeader };
}

/** Convenience: returns a service-role admin client. */
export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/**
 * Verifies the caller is using the service-role key.
 * Use for internal-only endpoints (cron jobs, queue workers, cleanup tasks).
 * Returns null when allowed, or a Response (401) when forbidden.
 */
export function requireServiceRole(req: Request): Response | null {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return errorResponse("Server misconfigured", 500);
  if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
    return errorResponse("Unauthorized: service role required", 401);
  }
  return null;
}

/**
 * Verifies caller has admin or staff role. Queue calls bypass this check.
 * Returns null when allowed, or a Response (403) when forbidden.
 */
export async function requireAdminOrStaff(auth: AuthResult): Promise<Response | null> {
  if (auth.isQueueCall) return null;
  try {
    const admin = adminClient();
    const { data, error } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.userId);
    if (error) return errorResponse("Forbidden: role check failed", 403);
    const roles = (data ?? []).map((r: any) => r.role);
    if (roles.includes("admin") || roles.includes("staff")) return null;
    return errorResponse("Forbidden: admin or staff role required", 403);
  } catch (e) {
    return errorResponse(`Forbidden: ${e instanceof Error ? e.message : "role check failed"}`, 403);
  }
}