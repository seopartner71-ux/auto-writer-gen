import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify admin
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

    // Get counter ID from site_settings
    const { data: settings } = await supabase
      .from("site_settings")
      .select("metrica_id")
      .limit(1)
      .maybeSingle();
    const counterId = settings?.metrica_id;
    if (!counterId) throw new Error("Metrica counter ID not set in site_settings");

    const baseUrl = "https://api-metrika.yandex.net/stat/v1/data";
    const headers = { Authorization: `OAuth ${token}` };

    const today = new Date().toISOString().split("T")[0];
    const monthStart = today.slice(0, 8) + "01";
    const yearStart = today.slice(0, 5) + "01-01";

    // Fetch visits for today, month, year + traffic sources in parallel
    const [todayRes, monthRes, yearRes, sourcesRes] = await Promise.all([
      fetch(`${baseUrl}?ids=${counterId}&metrics=ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate&date1=${today}&date2=${today}`, { headers }),
      fetch(`${baseUrl}?ids=${counterId}&metrics=ym:s:visits,ym:s:users,ym:s:pageviews&date1=${monthStart}&date2=${today}`, { headers }),
      fetch(`${baseUrl}?ids=${counterId}&metrics=ym:s:visits,ym:s:users,ym:s:pageviews&date1=${yearStart}&date2=${today}`, { headers }),
      fetch(`${baseUrl}?ids=${counterId}&metrics=ym:s:visits&dimensions=ym:s:trafficSource&date1=${monthStart}&date2=${today}&limit=10`, { headers }),
    ]);

    const [todayData, monthData, yearData, sourcesData] = await Promise.all([
      todayRes.json(),
      monthRes.json(),
      yearRes.json(),
      sourcesRes.json(),
    ]);

    const extractTotals = (d: any) => {
      const t = d?.totals || [];
      return { visits: Math.round(t[0] || 0), users: Math.round(t[1] || 0), pageviews: Math.round(t[2] || 0) };
    };

    const todayTotals = {
      ...extractTotals(todayData),
      bounceRate: todayData?.totals?.[3] ? Math.round(todayData.totals[3] * 10) / 10 : 0,
    };

    const sources = (sourcesData?.data || []).map((row: any) => ({
      source: row.dimensions?.[0]?.name || "Unknown",
      visits: Math.round(row.metrics?.[0] || 0),
    }));

    return new Response(
      JSON.stringify({
        today: todayTotals,
        month: extractTotals(monthData),
        year: extractTotals(yearData),
        sources,
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
