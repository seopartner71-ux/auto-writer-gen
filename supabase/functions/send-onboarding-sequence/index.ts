import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DAYS = [1, 3, 7] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const summary: Record<string, number> = { sent: 0, skipped: 0, errors: 0 };

  try {
    for (const day of DAYS) {
      // Window: created_at between (day) and (day+1) days ago, send once per user per day-step.
      const windowEnd = new Date(Date.now() - day * 24 * 60 * 60 * 1000).toISOString();
      const windowStart = new Date(Date.now() - (day + 1) * 24 * 60 * 60 * 1000).toISOString();

      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .gte("created_at", windowStart)
        .lte("created_at", windowEnd)
        .not("email", "is", null)
        .eq("is_active", true);

      if (error) { console.error("fetch profiles", day, error); summary.errors++; continue; }
      if (!profiles?.length) continue;

      const ids = profiles.map(p => p.id);
      const { data: sentLogs } = await supabase
        .from("onboarding_email_log")
        .select("user_id")
        .eq("day", day)
        .in("user_id", ids);
      const sentSet = new Set((sentLogs ?? []).map(r => r.user_id));

      const toSend = profiles.filter(p => !sentSet.has(p.id));

      for (const p of toSend) {
        try {
          let hasArticles = false;
          if (day === 7) {
            const { count } = await supabase
              .from("articles")
              .select("id", { count: "exact", head: true })
              .eq("user_id", p.id);
            hasArticles = (count ?? 0) > 0;
          }

          const templateName = `onboarding-day-${day}`;
          const { error: invokeErr } = await supabase.functions.invoke("send-transactional-email", {
            body: {
              templateName,
              recipientEmail: p.email,
              idempotencyKey: `onboarding-${day}-${p.id}`,
              templateData: { fullName: p.full_name || undefined, hasArticles },
            },
          });

          if (invokeErr) {
            console.error("send error", p.email, day, invokeErr);
            summary.errors++;
            continue;
          }

          await supabase.from("onboarding_email_log").insert({ user_id: p.id, day });
          summary.sent++;
        } catch (e) {
          console.error("loop error", p.email, day, e);
          summary.errors++;
        }
      }

      summary.skipped += profiles.length - toSend.length;
    }

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fatal", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});