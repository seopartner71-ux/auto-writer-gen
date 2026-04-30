// Cron-driven weekly publisher for Site Factory projects.
// Triggered by pg_cron every hour. For each project where:
//   - auto_weekly_post = true
//   - last_post_at is NULL or older than 7 days
//   - has at least one keyword
// Creates a queued bulk-generation job by calling bulk-generate via service role.
// Then re-deploys the site so the new article appears.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logCost } from "../_shared/costLogger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const service    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, service);

  // Random hour gating: only post during 9..21 local UTC+3 (RU business hours).
  const hourMsk = (new Date().getUTCHours() + 3) % 24;
  const isBusinessHour = hourMsk >= 9 && hourMsk <= 21;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const { data: projects, error } = await admin
    .from("projects")
    .select("id, user_id, name, last_post_at, auto_weekly_post")
    .eq("auto_weekly_post", true)
    .or(`last_post_at.is.null,last_post_at.lt.${sevenDaysAgo}`)
    .limit(50);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let scheduled = 0, skipped = 0, failed = 0;
  for (const p of (projects || [])) {
    try {
      // Random skip to avoid posting always at the same UTC hour.
      if (!isBusinessHour && Math.random() > 0.05) { skipped++; continue; }
      if (Math.random() < 0.3) { skipped++; continue; }

      // Pick a keyword for this project.
      const { data: kws } = await admin
        .from("keywords")
        .select("id, keyword")
        .eq("project_id", p.id)
        .limit(50);
      if (!kws || kws.length === 0) {
        await admin.from("site_post_schedule_logs").insert({
          project_id: p.id, user_id: p.user_id, status: "skipped", message: "no keywords",
        });
        skipped++;
        continue;
      }
      const kw = pick(kws);

      // Bump last_post_at NOW so a slow generation doesn't trigger another run.
      await admin.from("projects").update({ last_post_at: new Date().toISOString() }).eq("id", p.id);

      // Fire-and-forget bulk-generate (1 article).
      const res = await fetch(`${supabaseUrl}/functions/v1/bulk-generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${service}`,
          "x-bulk-user-id": p.user_id,
        },
        body: JSON.stringify({
          project_id: p.id,
          keyword_ids: [kw.id],
          source: "auto_weekly",
        }),
      });

      await admin.from("site_post_schedule_logs").insert({
        project_id: p.id, user_id: p.user_id,
        status: res.ok ? "queued" : "failed",
        message: res.ok ? `queued: ${kw.keyword}` : `bulk-generate ${res.status}`,
        keyword: kw.keyword,
      });
      if (res.ok) scheduled++; else failed++;

      // Cost-log marker for cron usage (zero direct cost — actual cost is
      // logged inside generate-article when bulk-generate triggers it).
      void logCost(admin, {
        project_id: p.id,
        user_id: p.user_id,
        operation_type: "auto_post_cron",
        cost_usd: 0,
        metadata: { keyword: kw.keyword, ok: res.ok, status: res.status },
      });
    } catch (e: any) {
      failed++;
      await admin.from("site_post_schedule_logs").insert({
        project_id: p.id, user_id: p.user_id,
        status: "error", message: e?.message?.slice(0, 240) || "unknown",
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, scheduled, skipped, failed, total: projects?.length || 0 }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});