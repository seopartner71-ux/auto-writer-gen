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

    const targetUserId = "1d6c5598-fcb5-43b1-9ba9-4a55d4d8cadb"; // sinitsin3@yandex.ru
    const oldAdminId = "cd7a20b6-fb98-4b78-948d-b4e118714f76"; // admin@seoengine.test

    // 1. Give admin role to sinitsin3@yandex.ru
    const { error: insertErr } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: targetUserId, role: "admin" }, { onConflict: "user_id,role" });
    
    // 2. Update profile to pro + active
    const { error: profileErr } = await supabaseAdmin
      .from("profiles")
      .update({ plan: "pro", is_active: true })
      .eq("id", targetUserId);

    // 3. Remove admin role from old admin
    const { error: deleteErr } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", oldAdminId)
      .eq("role", "admin");

    // 4. Add user role to old admin if needed
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: oldAdminId, role: "user" }, { onConflict: "user_id,role" });

    return new Response(JSON.stringify({ 
      success: true, 
      insertErr: insertErr?.message,
      profileErr: profileErr?.message,
      deleteErr: deleteErr?.message,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
