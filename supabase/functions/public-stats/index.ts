import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cache headers - 10 min
const cacheHeaders = { "Cache-Control": "public, max-age=600, s-maxage=600" };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [articlesRes, avgRes, top10Res] = await Promise.all([
      admin.from("articles").select("id", { count: "exact", head: true }).gte("created_at", since),
      admin.from("articles").select("turgenev_score").not("turgenev_score", "is", null).gte("created_at", since).limit(1000),
      admin.from("article_rankings").select("id", { count: "exact", head: true }).lte("position", 10),
    ]);

    const articlesCount = articlesRes.count || 0;
    // turgenev: 0-10 (lower better). Map to 0-100 SEO score for display: (10 - score) * 10.
    const scores = (avgRes.data || []).map((r: any) => Math.max(0, Math.min(100, (10 - Number(r.turgenev_score)) * 10)));
    const avgSeo = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const top10Count = top10Res.count || 0;

    return new Response(
      JSON.stringify({
        articles_30d: articlesCount,
        avg_seo_score: avgSeo,
        top10_count: top10Count,
        updated_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, ...cacheHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});