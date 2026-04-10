import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Find inactive accounts older than 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: inactiveProfiles, error: fetchError } = await supabase
      .from("profiles")
      .select("id, email, created_at")
      .eq("is_active", false)
      .lt("created_at", sevenDaysAgo.toISOString());

    if (fetchError) throw fetchError;

    if (!inactiveProfiles || inactiveProfiles.length === 0) {
      return new Response(
        JSON.stringify({ message: "No inactive accounts to clean up", deleted: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const deleted: string[] = [];
    const errors: string[] = [];

    for (const profile of inactiveProfiles) {
      try {
        // Delete user from auth (cascades to profiles via trigger)
        const { error: deleteError } = await supabase.auth.admin.deleteUser(
          profile.id
        );
        if (deleteError) {
          errors.push(`${profile.email}: ${deleteError.message}`);
        } else {
          deleted.push(profile.email || profile.id);
        }
      } catch (e) {
        errors.push(`${profile.email}: ${e.message}`);
      }
    }

    // Notify admins about cleanup
    const { data: admins } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (admins && deleted.length > 0) {
      for (const admin of admins) {
        await supabase.from("notifications").insert({
          user_id: admin.user_id,
          title: "🧹 Очистка неактивных аккаунтов",
          message: `Удалено ${deleted.length} аккаунтов, не активированных более 7 дней: ${deleted.join(", ")}`,
        });
      }
    }

    return new Response(
      JSON.stringify({
        deleted: deleted.length,
        deletedEmails: deleted,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
