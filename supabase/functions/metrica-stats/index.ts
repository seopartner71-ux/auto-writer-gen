import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function getDateRange(period: string): { date1: string; date2: string } {
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  switch (period) {
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const yd = y.toISOString().split("T")[0];
      return { date1: yd, date2: yd };
    }
    case "week": {
      const w = new Date(now);
      w.setDate(w.getDate() - 6);
      return { date1: w.toISOString().split("T")[0], date2: today };
    }
    case "month": {
      const m = new Date(now);
      m.setDate(m.getDate() - 29);
      return { date1: m.toISOString().split("T")[0], date2: today };
    }
    default:
      return { date1: today, date2: today };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleData) throw new Error("Admin only");

    const token = Deno.env.get("YANDEX_METRICA_TOKEN");
    if (!token) throw new Error("YANDEX_METRICA_TOKEN not configured");

    const { data: settings } = await supabase
      .from("site_settings")
      .select("metrica_id")
      .limit(1)
      .maybeSingle();
    const counterId = settings?.metrica_id;
    if (!counterId) throw new Error("Metrica counter ID not set in site_settings");

    // Parse period from request body
    let period = "today";
    try {
      const body = await req.json();
      if (body?.period) period = body.period;
    } catch { /* default to today */ }

    const { date1, date2 } = getDateRange(period);
    const isMultiDay = date1 !== date2;

    const baseUrl = "https://api-metrika.yandex.net/stat/v1/data";
    const apiHeaders = { Authorization: `OAuth ${token}` };

    // Build requests
    const requests: Promise<Response>[] = [
      // 0: Main metrics
      fetch(`${baseUrl}?ids=${counterId}&metrics=ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,ym:s:avgVisitDurationSeconds,ym:s:pageDepth&date1=${date1}&date2=${date2}`, { headers: apiHeaders }),
      // 1: Sources
      fetch(`${baseUrl}?ids=${counterId}&metrics=ym:s:visits&dimensions=ym:s:trafficSource&date1=${date1}&date2=${date2}&limit=10`, { headers: apiHeaders }),
      // 2: Goals list (management API)
      fetch(`https://api-metrika.yandex.net/management/v1/counter/${counterId}/goals`, { headers: apiHeaders }),
    ];

    // 3: Daily breakdown (only for multi-day periods)
    if (isMultiDay) {
      requests.push(
        fetch(`${baseUrl}?ids=${counterId}&metrics=ym:s:visits,ym:s:users&dimensions=ym:s:date&date1=${date1}&date2=${date2}&sort=ym:s:date&limit=31`, { headers: apiHeaders })
      );
    }

    const responses = await Promise.all(requests);
    const [mainData, sourcesData, goalsListData] = await Promise.all([
      responses[0].json(),
      responses[1].json(),
      responses[2].json(),
    ]);

    const dailyData = isMultiDay ? await responses[3].json() : null;

    // Extract main totals
    const t = mainData?.totals || [];
    const summary = {
      visits: Math.round(t[0] || 0),
      users: Math.round(t[1] || 0),
      pageviews: Math.round(t[2] || 0),
      bounceRate: t[3] ? Math.round(t[3] * 10) / 10 : 0,
      avgDuration: Math.round(t[4] || 0),
      pageDepth: t[5] ? Math.round(t[5] * 100) / 100 : 0,
    };

    // Sources
    const sources = (sourcesData?.data || []).map((row: any) => ({
      source: row.dimensions?.[0]?.name || "Unknown",
      visits: Math.round(row.metrics?.[0] || 0),
    }));

    // Daily chart
    const daily = dailyData
      ? (dailyData?.data || []).map((row: any) => {
          const dateStr = row.dimensions?.[0]?.name || "";
          const parts = dateStr.split("-");
          return {
            date: parts.length === 3 ? `${parts[2]}.${parts[1]}` : dateStr,
            visits: Math.round(row.metrics?.[0] || 0),
            users: Math.round(row.metrics?.[1] || 0),
          };
        })
      : [];

    // Goals
    const goalsList = (goalsListData?.goals || []).map((g: any) => ({
      id: g.id,
      name: g.name,
      type: g.type,
    }));

    // Fetch goal conversions if goals exist
    let goalStats: any[] = [];
    if (goalsList.length > 0) {
      const goalMetrics = goalsList
        .slice(0, 5)
        .map((g: any) => `ym:s:goal${g.id}reaches,ym:s:goal${g.id}conversionRate`)
        .join(",");
      const goalsRes = await fetch(
        `${baseUrl}?ids=${counterId}&metrics=${goalMetrics}&date1=${date1}&date2=${date2}`,
        { headers: apiHeaders }
      );
      const goalsData = await goalsRes.json();
      const gt = goalsData?.totals || [];
      goalStats = goalsList.slice(0, 5).map((g: any, i: number) => ({
        id: g.id,
        name: g.name,
        reaches: Math.round(gt[i * 2] || 0),
        conversionRate: gt[i * 2 + 1] ? Math.round(gt[i * 2 + 1] * 100) / 100 : 0,
      }));
    }

    return new Response(
      JSON.stringify({
        period,
        date1,
        date2,
        summary,
        sources,
        daily,
        goals: goalStats,
        goalsList,
        counterId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
