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

    const newEmail = "sinitsin3@yandex.ru";

    // List users to find admin
    const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 100 });
    if (listErr) throw listErr;

    const adminUser = users.find(u => u.email === "admin@seoengine.test");
    if (!adminUser) {
      // Maybe already changed?
      const existing = users.find(u => u.email === newEmail);
      if (existing) {
        return new Response(JSON.stringify({ success: true, message: "Email already updated" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ 
        error: "Admin user not found", 
        emails: users.map(u => u.email) 
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if new email already used by another user
    const conflict = users.find(u => u.email === newEmail && u.id !== adminUser.id);
    if (conflict) {
      return new Response(JSON.stringify({ error: "Email already in use by another user" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update email
    const { data: updated, error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(adminUser.id, {
      email: newEmail,
      email_confirm: true,
    });
    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message, details: JSON.stringify(updateErr) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update profiles table
    await supabaseAdmin.from("profiles").update({ email: newEmail }).eq("id", adminUser.id);

    return new Response(JSON.stringify({ success: true, updatedEmail: updated?.user?.email }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
