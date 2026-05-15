// Cron: every hour. Checks last 50 RU articles. If > 10% have NULL turgenev_score
// or NULL uniqueness_percent — sends Telegram alert via telegram-notify.
// Also sends alert if average ai_score for last 50 < 45 (too many AI-detected).

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

    const { data: arts } = await admin
      .from("articles")
      .select("id,language,turgenev_score,uniqueness_percent,ai_score,created_at")
      .eq("language", "ru")
      .in("status", ["completed", "published"])
      .order("created_at", { ascending: false })
      .limit(50);

    if (!arts || arts.length < 10) {
      return new Response(JSON.stringify({ ok: true, skipped: "too_few_articles" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const total = arts.length;
    const noTurg = arts.filter(a => a.turgenev_score == null).length;
    const noUniq = arts.filter(a => a.uniqueness_percent == null).length;
    const aiScores = arts.map(a => a.ai_score).filter((v): v is number => typeof v === "number");
    const avgAi = aiScores.length ? Math.round(aiScores.reduce((a, b) => a + b, 0) / aiScores.length) : null;

    const issues: string[] = [];
    if (noTurg / total > 0.10) issues.push(`Турgenev NULL: ${noTurg}/${total} (${Math.round(noTurg/total*100)}%)`);
    if (noUniq / total > 0.10) issues.push(`Уникальность NULL: ${noUniq}/${total} (${Math.round(noUniq/total*100)}%)`);
    if (avgAi !== null && avgAi < 45) issues.push(`Средний AI-score: ${avgAi} (палится как AI)`);

    if (!issues.length) {
      return new Response(JSON.stringify({ ok: true, healthy: true, total, avgAi }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Throttle: do not re-alert if same alert sent in last 6 hours.
    const sigKey = "quality_metrics_alert";
    const { data: recent } = await admin
      .from("error_logs")
      .select("id,created_at,message")
      .eq("context", sigKey)
      .gte("created_at", new Date(Date.now() - 6 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if (recent && recent.length) {
      return new Response(JSON.stringify({ ok: true, throttled: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = `Алерт качества (последние ${total} статей RU):\n- ${issues.join("\n- ")}`;
    try {
      await fetch(`${url}/functions/v1/telegram-notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ type: "quality_alert", data: { text } }),
      });
    } catch (_) { /* ignore */ }

    await admin.from("error_logs").insert({
      context: sigKey,
      message: issues.join(" | ").slice(0, 500),
      metadata: { total, noTurg, noUniq, avgAi },
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