import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find admin user by old email
    const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
    if (listErr) throw listErr;

    const adminUser = users.find(u => u.email === "admin@seoengine.test");
    if (!adminUser) throw new Error("Admin user not found");

    // Update email in auth
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(adminUser.id, {
      email: "sinitsin3@yandex.ru",
      email_confirm: true,
    });
    if (updateErr) throw updateErr;

    // Update email in profiles
    await supabaseAdmin.from("profiles").update({ email: "sinitsin3@yandex.ru" }).eq("id", adminUser.id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
