// Admin-only analytics endpoint for the Site Factory cost dashboard.
// Actions: summary | by_type | by_project | timeseries | forecast | export_csv

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

function isoDateKey(d: Date, granularity: "day" | "week" | "month"): string {
  const dt = new Date(d);
  if (granularity === "month") {
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (granularity === "week") {
    // ISO week start (Monday)
    const tmp = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    const day = (tmp.getUTCDay() + 6) % 7;
    tmp.setUTCDate(tmp.getUTCDate() - day);
    return tmp.toISOString().slice(0, 10);
  }
  return dt.toISOString().slice(0, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(supabaseUrl, service);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: roleRow } = await admin.from("user_roles")
      .select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "summary";
    const projectId = url.searchParams.get("project_id") || null;
    const opType = url.searchParams.get("operation_type") || null;
    const dateFrom = url.searchParams.get("date_from") || null;
    const dateTo = url.searchParams.get("date_to") || null;
    const granularity = (url.searchParams.get("granularity") || "day") as "day" | "week" | "month";

    // Read USD/RUB rate from app_settings
    let usdToRub = 90;
    try {
      const { data: rateRow } = await admin.from("app_settings")
        .select("value").eq("key", "usd_to_rub_rate").maybeSingle();
      const v = Number(rateRow?.value);
      if (Number.isFinite(v) && v > 0) usdToRub = v;
    } catch (_) { /* keep default */ }

    // ---- summary ----
    if (action === "summary") {
      const now = new Date();
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

      const [totalRes, monthRes, dayRes, projectsRes] = await Promise.all([
        admin.from("cost_log").select("cost_usd"),
        admin.from("cost_log").select("cost_usd").gte("created_at", startOfMonth),
        admin.from("cost_log").select("cost_usd").gte("created_at", startOfDay),
        admin.from("projects").select("id", { count: "exact", head: true }),
      ]);

      const sum = (rows: any[] | null) => (rows || []).reduce((acc, r) => acc + Number(r.cost_usd || 0), 0);
      const total = sum(totalRes.data);
      const month = sum(monthRes.data);
      const today = sum(dayRes.data);
      const projectsCount = projectsRes.count || 0;
      const avgPerProject = projectsCount > 0 ? total / projectsCount : 0;

      return json({
        usd_to_rub: usdToRub,
        total_usd: total,
        month_usd: month,
        today_usd: today,
        avg_per_project_usd: avgPerProject,
        projects_count: projectsCount,
      });
    }

    // Helper: build base query with filters
    const buildQuery = () => {
      let q = admin.from("cost_log").select("*").order("created_at", { ascending: false }).limit(20000);
      if (projectId) q = q.eq("project_id", projectId);
      if (opType) q = q.eq("operation_type", opType);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo) q = q.lte("created_at", dateTo);
      return q;
    };

    // ---- by_type ----
    if (action === "by_type") {
      const { data, error } = await buildQuery();
      if (error) return json({ error: error.message }, 500);
      const map = new Map<string, { count: number; total_usd: number }>();
      for (const row of data || []) {
        const key = row.operation_type;
        const e = map.get(key) || { count: 0, total_usd: 0 };
        e.count += 1;
        e.total_usd += Number(row.cost_usd || 0);
        map.set(key, e);
      }
      const out = Array.from(map.entries()).map(([operation_type, v]) => ({
        operation_type,
        count: v.count,
        total_usd: v.total_usd,
        avg_usd: v.count > 0 ? v.total_usd / v.count : 0,
      })).sort((a, b) => b.total_usd - a.total_usd);
      return json({ usd_to_rub: usdToRub, items: out });
    }

    // ---- timeseries ----
    if (action === "timeseries") {
      const { data, error } = await buildQuery();
      if (error) return json({ error: error.message }, 500);
      // Group by date and operation_type
      const buckets = new Map<string, Record<string, number> & { date: string; total: number }>();
      for (const row of data || []) {
        const key = isoDateKey(new Date(row.created_at), granularity);
        const b = buckets.get(key) || { date: key, total: 0 } as any;
        b[row.operation_type] = (b[row.operation_type] || 0) + Number(row.cost_usd || 0);
        b.total = (b.total || 0) + Number(row.cost_usd || 0);
        buckets.set(key, b);
      }
      const series = Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
      return json({ usd_to_rub: usdToRub, granularity, series });
    }

    // ---- by_project ----
    if (action === "by_project") {
      const { data: rows, error } = await buildQuery();
      if (error) return json({ error: error.message }, 500);

      const map = new Map<string, {
        project_id: string;
        site_generation: number;
        article_generation: number;
        photos: number;
        deploys: number;
        auto_post: number;
        total_usd: number;
      }>();
      for (const r of rows || []) {
        if (!r.project_id) continue;
        const e = map.get(r.project_id) || {
          project_id: r.project_id,
          site_generation: 0,
          article_generation: 0,
          photos: 0,
          deploys: 0,
          auto_post: 0,
          total_usd: 0,
        };
        e.total_usd += Number(r.cost_usd || 0);
        if (r.operation_type === "article_generation") e.article_generation += 1;
        else if (r.operation_type === "site_generation") e.site_generation += 1;
        else if (r.operation_type === "fal_ai_photo" || r.operation_type === "fal_ai_portrait" || r.operation_type === "fal_ai_logo") e.photos += 1;
        else if (r.operation_type === "cloudflare_deploy") e.deploys += 1;
        else if (r.operation_type === "auto_post_cron") e.auto_post += 1;
        map.set(r.project_id, e);
      }

      const projectIds = Array.from(map.keys());
      let projectsMeta: Record<string, { name: string | null; domain: string | null; custom_domain: string | null }> = {};
      if (projectIds.length > 0) {
        const { data: projects } = await admin.from("projects")
          .select("id, name, domain, custom_domain")
          .in("id", projectIds);
        for (const p of projects || []) {
          projectsMeta[p.id] = { name: p.name, domain: p.domain, custom_domain: p.custom_domain };
        }
      }

      const items = Array.from(map.values()).map((e) => ({
        ...e,
        name: projectsMeta[e.project_id]?.name || "(unknown)",
        domain: projectsMeta[e.project_id]?.custom_domain || projectsMeta[e.project_id]?.domain || null,
      })).sort((a, b) => b.total_usd - a.total_usd);

      return json({ usd_to_rub: usdToRub, items });
    }

    // ---- forecast ----
    if (action === "forecast") {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const [last7Res, allTimeRes, projectsRes] = await Promise.all([
        admin.from("cost_log").select("operation_type, cost_usd").gte("created_at", since),
        admin.from("cost_log").select("cost_usd, project_id"),
        admin.from("projects").select("id", { count: "exact", head: true }),
      ]);

      const last7 = last7Res.data || [];
      const articles7 = last7.filter((r: any) => r.operation_type === "article_generation").length;
      const photos7 = last7.filter((r: any) => ["fal_ai_photo", "fal_ai_portrait", "fal_ai_logo"].includes(r.operation_type)).length;
      const cost7 = last7.reduce((acc: number, r: any) => acc + Number(r.cost_usd || 0), 0);

      const factor = 30 / 7;
      const forecastArticles = Math.round(articles7 * factor);
      const forecastPhotos = Math.round(photos7 * factor);
      const forecastCostUsd = cost7 * factor;

      // Per-project averages for scaling scenario
      const allTime = allTimeRes.data || [];
      const projectTotals = new Map<string, number>();
      for (const r of allTime as any[]) {
        if (!r.project_id) continue;
        projectTotals.set(r.project_id, (projectTotals.get(r.project_id) || 0) + Number(r.cost_usd || 0));
      }
      const projectsCount = projectsRes.count || projectTotals.size || 0;
      const avgPerProject = projectsCount > 0
        ? Array.from(projectTotals.values()).reduce((a, b) => a + b, 0) / projectsCount
        : 0;

      // Monthly running cost per project (auto-post + occasional photos)
      const autoCost7 = last7.filter((r: any) => r.operation_type === "auto_post_cron")
        .reduce((acc: number, r: any) => acc + Number(r.cost_usd || 0), 0);
      const monthlyAutoCostPerProject = projectsCount > 0 ? (autoCost7 * factor) / projectsCount : 0;

      return json({
        usd_to_rub: usdToRub,
        current_pace: {
          articles_per_month: forecastArticles,
          photos_per_month: forecastPhotos,
          expected_cost_usd: forecastCostUsd,
        },
        scaling_50_sites: {
          one_time_cost_usd: avgPerProject * 50,
          monthly_cost_usd: monthlyAutoCostPerProject * 50,
        },
        projects_count: projectsCount,
        avg_per_project_usd: avgPerProject,
      });
    }

    // ---- export_csv ----
    if (action === "export_csv") {
      const { data, error } = await buildQuery();
      if (error) return json({ error: error.message }, 500);
      const header = ["created_at", "operation_type", "model", "project_id", "user_id", "tokens_input", "tokens_output", "cost_usd"];
      const lines = [header.join(",")];
      const escape = (v: any) => {
        if (v === null || v === undefined) return "";
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      };
      for (const r of data || []) {
        lines.push(header.map((h) => escape((r as any)[h])).join(","));
      }
      return new Response(lines.join("\n"), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="cost-report-${new Date().toISOString().slice(0,10)}.csv"`,
        },
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err: any) {
    console.error("[cost-analytics] ERROR:", err?.message);
    return json({ error: err?.message || String(err) }, 500);
  }
});