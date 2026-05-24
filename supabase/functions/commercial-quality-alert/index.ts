// Quality monitor for commercial block generation.
// Reads last hour of cost_log entries (kind=commercial_block), computes retry_rate
// and fact_check_rate. If either > 30% with at least 8 samples — sends Telegram alert.
// Throttled to 1 alert per 60 minutes via error_logs.

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

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: rows } = await admin
      .from("cost_log")
      .select("metadata,created_at")
      .gte("created_at", since)
      .limit(500);

    const commercial = (rows || []).filter((r: any) =>
      r?.metadata && r.metadata.kind === "commercial_block"
    );

    if (commercial.length < 8) {
      return new Response(JSON.stringify({ ok: true, skipped: "too_few_samples", count: commercial.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const total = commercial.length;
    const retried = commercial.filter((r: any) => r.metadata.retried === true).length;
    const fc = commercial.filter((r: any) => (r.metadata.fact_check_count || 0) > 0).length;
    const af = commercial.filter((r: any) => (r.metadata.anti_fake_count || 0) > 0).length;
    const retryRate = retried / total;
    const fcRate = fc / total;
    const afRate = af / total;

    const issues: string[] = [];
    if (retryRate > 0.30) issues.push(`Retry rate: ${Math.round(retryRate * 100)}% (${retried}/${total})`);
    if (fcRate > 0.30) issues.push(`Fact-check flags: ${Math.round(fcRate * 100)}% (${fc}/${total})`);
    if (afRate > 0.30) issues.push(`Anti-fake catches: ${Math.round(afRate * 100)}% (${af}/${total})`);

    if (!issues.length) {
      return new Response(JSON.stringify({ ok: true, healthy: true, total, retryRate, fcRate, afRate }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sigKey = "commercial_quality_alert";
    const { data: recent } = await admin
      .from("error_logs")
      .select("id,created_at")
      .eq("context", sigKey)
      .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if (recent && recent.length) {
      return new Response(JSON.stringify({ ok: true, throttled: true, issues }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = `Алерт качества коммерческих блоков (за последний час, ${total} генераций):\n- ${issues.join("\n- ")}`;
    try {
      await fetch(`${url}/functions/v1/telegram-notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ type: "commercial_quality_alert", data: { text } }),
      });
    } catch { /* ignore */ }

    await admin.from("error_logs").insert({
      context: sigKey,
      message: issues.join(" | ").slice(0, 500),
      metadata: { total, retried, fc, af, retryRate, fcRate, afRate },
    });

    return new Response(JSON.stringify({ ok: true, alerted: true, issues }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});