// Returns OpenRouter key usage/balance. Admin-only.
// GET https://openrouter.ai/api/v1/key -> { data: { limit, usage, limit_remaining, is_free_tier } }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const admin = adminClient();
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return errorResponse("Forbidden", 403);

    const { data: keyRow } = await admin
      .from("api_keys")
      .select("api_key")
      .eq("provider", "openrouter")
      .eq("is_valid", true)
      .maybeSingle();
    const key = keyRow?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!key) return jsonResponse({ ok: false, reason: "no_key" });

    const r = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return jsonResponse({ ok: false, status: r.status, error: text.slice(0, 200) });
    }
    const j = await r.json();
    const d = j?.data || {};
    const limit = d.limit == null ? null : Number(d.limit);
    const usage = Number(d.usage || 0);
    const remaining = limit == null ? null : Math.max(0, limit - usage);
    return jsonResponse({
      ok: true,
      usage,
      limit,
      remaining,
      is_free_tier: !!d.is_free_tier,
      low: remaining != null && remaining < 1,
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    return errorResponse((e as Error)?.message || "error", 500);
  }
});