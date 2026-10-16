// Admin operations for AI Traffic Monitor: issue/revoke per-site collector keys.
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, requireAdmin, adminClient } from "../_shared/auth.ts";
import { z } from "npm:zod@3.23.8";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_key"), site_id: z.string().uuid() }),
  z.object({ action: z.literal("revoke_key"), key_id: z.string().uuid() }),
]);

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;
  const auth = await verifyAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.isQueueCall) return errorResponse("Forbidden", 403);
  const deny = await requireAdmin(auth); if (deny) return deny;

  let body;
  try { body = Body.safeParse(await req.json()); } catch { return errorResponse("invalid json", 400); }
  if (!body.success) return errorResponse("invalid request", 400);
  const db = adminClient();

  if (body.data.action === "create_key") {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const key = "mon_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    // One active key per site: revoke previous ones.
    await db.from("monitor_ingest_keys").update({ revoked_at: new Date().toISOString() })
      .eq("site_id", body.data.site_id).is("revoked_at", null);
    const { error } = await db.from("monitor_ingest_keys").insert({
      site_id: body.data.site_id, key_hash: await sha256(key), key_prefix: key.slice(0, 10),
    });
    if (error) return errorResponse("failed to create key", 500);
    await db.from("monitor_sites").update({ status: "awaiting_data" })
      .eq("id", body.data.site_id).eq("status", "not_connected");
    return jsonResponse({ key });
  }

  const { error } = await db.from("monitor_ingest_keys").update({ revoked_at: new Date().toISOString() })
    .eq("id", body.data.key_id);
  if (error) return errorResponse("failed", 500);
  return jsonResponse({ ok: true });
});
