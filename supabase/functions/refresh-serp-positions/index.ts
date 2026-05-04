import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cron-triggered: rechecks SERP positions for all published articles weekly.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: serperKey } = await admin.from("api_keys").select("api_key").eq("provider", "serper").single();
    if (!serperKey?.api_key) {
      return new Response(JSON.stringify({ error: "Serper not configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pick up to 80 articles that are published and have a tracked URL
    const { data: articles } = await admin
      .from("articles")
      .select("id, user_id, title, published_url, blogger_post_url, telegraph_url, geo, language, keyword_id, keywords")
      .or("published_url.not.is.null,blogger_post_url.not.is.null,telegraph_url.not.is.null")
      .limit(80);

    if (!articles || articles.length === 0) {
      return new Response(JSON.stringify({ checked: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let checked = 0;
    let skipped = 0;

    for (const a of articles as any[]) {
      const url: string | null = a.published_url || a.blogger_post_url || a.telegraph_url;
      if (!url) { skipped++; continue; }

      // Resolve seed keyword
      let keyword: string | null = null;
      if (a.keyword_id) {
        const { data: kw } = await admin.from("keywords").select("seed_keyword").eq("id", a.keyword_id).maybeSingle();
        keyword = (kw as any)?.seed_keyword || null;
      }
      if (!keyword && Array.isArray(a.keywords) && a.keywords.length) keyword = a.keywords[0];
      if (!keyword) { skipped++; continue; }

      // Skip if already checked in last 6 days for this keyword
      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await admin
        .from("serp_positions")
        .select("id")
        .eq("article_id", a.id)
        .eq("keyword", keyword)
        .gt("checked_at", sixDaysAgo)
        .limit(1);
      if (recent && recent.length) { skipped++; continue; }

      try {
        const r = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": serperKey.api_key, "Content-Type": "application/json" },
          body: JSON.stringify({ q: keyword, gl: a.geo || "ru", hl: a.language || "ru", num: 100 }),
        });
        if (!r.ok) { skipped++; continue; }
        const data = await r.json();

        const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").toLowerCase();
        const target = norm(url);
        let position: number | null = null;
        let foundUrl: string | null = null;
        for (const item of data.organic || []) {
          const li = norm(item.link || "");
          if (li.includes(target) || target.includes(li)) {
            position = item.position;
            foundUrl = item.link;
            break;
          }
        }

        await admin.from("serp_positions").insert({
          user_id: a.user_id,
          article_id: a.id,
          keyword,
          position,
          url: foundUrl,
          search_engine: "google",
          region: a.geo || "ru",
        });
        checked++;

        // small delay to be polite
        await new Promise((res) => setTimeout(res, 250));
      } catch (e) {
        console.error("serp refresh failed", a.id, e);
        skipped++;
      }
    }

    return new Response(JSON.stringify({ checked, skipped }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});