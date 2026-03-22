import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const decodeUserIdFromAuthHeader = (authHeader: string) => {
  if (!authHeader.startsWith("Bearer ")) throw new Error("Unauthorized");

  const token = authHeader.replace("Bearer ", "");
  const payloadB64 = token.split(".")[1];
  if (!payloadB64) throw new Error("Unauthorized");

  const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  const payload = JSON.parse(atob(padded));

  if (!payload?.sub) throw new Error("Unauthorized");
  return payload.sub as string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const userId = decodeUserIdFromAuthHeader(authHeader);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const { type, id } = await req.json();
    if (!type || !id) throw new Error("type and id are required");

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    const isAdmin = roleRow?.role === "admin";

    if (type === "article") {
      const { data: article } = await admin
        .from("articles")
        .select("id, user_id")
        .eq("id", id)
        .single();

      if (!article) throw new Error("Article not found");
      if (!isAdmin && article.user_id !== userId) throw new Error("Forbidden");

      await admin.from("scheduled_generations").delete().eq("article_id", id);
      const { error } = await admin.from("articles").delete().eq("id", id);
      if (error) throw error;
    }

    if (type === "keyword") {
      const { data: keyword } = await admin
        .from("keywords")
        .select("id, user_id")
        .eq("id", id)
        .single();

      if (!keyword) throw new Error("Keyword not found");
      if (!isAdmin && keyword.user_id !== userId) throw new Error("Forbidden");

      const { data: relatedArticles } = await admin
        .from("articles")
        .select("id")
        .eq("keyword_id", id);

      const articleIds = (relatedArticles || []).map((a: { id: string }) => a.id);

      if (articleIds.length > 0) {
        await admin.from("scheduled_generations").delete().in("article_id", articleIds);
      }

      await admin.from("scheduled_generations").delete().eq("keyword_id", id);
      await admin.from("serp_results").delete().eq("keyword_id", id);
      await admin.from("articles").delete().eq("keyword_id", id);

      const { error } = await admin.from("keywords").delete().eq("id", id);
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