import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, requireAdminOrStaff, adminClient } from "../_shared/auth.ts";

serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    // Restrict to admin only (not staff) for destructive account deletion.
    const supabaseAdmin = adminClient();
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleData) return errorResponse("Forbidden: admin role required", 403);

    const { user_id } = await req.json();
    if (!user_id || typeof user_id !== "string") return errorResponse("user_id is required", 400);
    if (user_id === auth.userId) return errorResponse("Cannot delete yourself", 400);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id);
    if (error) throw error;

    return jsonResponse({ success: true });
  } catch (e) {
    console.error("delete-user error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return errorResponse(msg, 500);
  }
});
