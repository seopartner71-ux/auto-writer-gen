import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { type, id } = await req.json();
    if (!type || !id) throw new Error("type and id are required");

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (type === "article") {
      const { data: article } = await admin
        .from("articles")
        .select("id, user_id")
        .eq("id", id)
        .single();

      if (!article || article.user_id !== user.id) throw new Error("Forbidden");

      await admin.from("scheduled_generations").delete().eq("article_id", id).eq("user_id", user.id);
      const { error } = await admin.from("articles").delete().eq("id", id).eq("user_id", user.id);
      if (error) throw error;
    }

    if (type === "keyword") {
      const { data: keyword } = await admin
        .from("keywords")
        .select("id, user_id")
        .eq("id", id)
        .single();

      if (!keyword || keyword.user_id !== user.id) throw new Error("Forbidden");

      const { data: relatedArticles } = await admin
        .from("articles")
        .select("id")
        .eq("keyword_id", id)
        .eq("user_id", user.id);

      const articleIds = (relatedArticles || []).map((a: { id: string }) => a.id);

      if (articleIds.length > 0) {
        await admin.from("scheduled_generations").delete().in("article_id", articleIds).eq("user_id", user.id);
      }

      await admin.from("scheduled_generations").delete().eq("keyword_id", id).eq("user_id", user.id);
      await admin.from("serp_results").delete().eq("keyword_id", id);
      await admin.from("articles").delete().eq("keyword_id", id).eq("user_id", user.id);

      const { error } = await admin.from("keywords").delete().eq("id", id).eq("user_id", user.id);
      if (error) throw error;
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("delete-content error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("Unauthorized") ? 401 : msg.includes("Forbidden") ? 403 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});