// Cron: every 15 minutes. Finds articles that should have quality metrics
// but somehow ended up with NULL turgenev_score / ai_score (e.g. created
// via legacy flows that bypass auto quality-check). Re-queues them.
//
// Conditions:
//   - status in ('completed','published')
//   - turgenev_score IS NULL
//   - content length >= 400
//   - created >= 1 hour ago (give the normal flow a chance)
//   - created <= 24 hours ago (don't keep retrying ancient articles forever)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, key);

    const { data: stale } = await admin
      .from("articles")
      .select("id, content")
      .in("status", ["completed", "published"])
      .is("turgenev_score", null)
      .lt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .gt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20);

    if (!stale || stale.length === 0) {
      return new Response(JSON.stringify({ ok: true, picked: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let queued = 0;
    for (const a of stale) {
      const content = (a.content || "").toString();
      if (content.length < 400) continue;
      try {
        // fire-and-forget so cron stays under wall-clock budget
        void fetch(`${url}/functions/v1/quality-check`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${key}`,
          },
          body: JSON.stringify({ article_id: a.id, content, mode: "auto" }),
        }).catch(() => {});
        queued++;
      } catch (_) { /* ignore */ }
    }

    return new Response(JSON.stringify({ ok: true, picked: stale.length, queued }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});