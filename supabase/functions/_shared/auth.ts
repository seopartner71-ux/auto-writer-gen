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

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) {
      return errorResponse("Unauthorized: invalid token", 401);
    }
    return { userId: data.claims.sub as string, isQueueCall: false, authHeader };
  } catch (e) {
    return errorResponse(`Unauthorized: ${e instanceof Error ? e.message : "verify failed"}`, 401);
  }
}

/** Convenience: returns a service-role admin client. */
export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}