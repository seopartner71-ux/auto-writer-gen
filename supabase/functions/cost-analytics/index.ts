// Cost analytics endpoint for admin dashboard (Расходы tab).
// GET /cost-analytics?action=<action>&...filters
// Actions: summary | by_type | timeseries | by_project | by_user | forecast
//          articles_breakdown | full_article_cost | openrouter_period_stats | export_csv
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

const USD_TO_RUB = Number(Deno.env.get("USD_TO_RUB") || 95);

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function requireAdmin(req: Request): Promise<string | Response> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return errorResponse("Unauthorized", 401);
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data, error } = await userClient.auth.getClaims(auth.slice(7));
  if (error || !data?.claims?.sub) return errorResponse("Unauthorized", 401);
  const userId = data.claims.sub as string;
  const admin = adminClient();
  const { data: role } = await admin
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!role) return errorResponse("Forbidden: admin only", 403);
  return userId;
}

interface Filters {
  project_id: string | null;
  operation_type: string | null;
  date_from: string | null;
  date_to: string | null;
}

function parseFilters(url: URL): Filters {
  return {
    project_id: url.searchParams.get("project_id"),
    operation_type: url.searchParams.get("operation_type"),
    date_from: url.searchParams.get("date_from"),
    date_to: url.searchParams.get("date_to"),
  };
}

function applyFilters(q: any, f: Filters) {
  if (f.project_id) q = q.eq("project_id", f.project_id);
  if (f.operation_type) q = q.eq("operation_type", f.operation_type);
  if (f.date_from) q = q.gte("created_at", f.date_from);
  if (f.date_to) q = q.lte("created_at", f.date_to);
  return q;
}

// Fetch ALL rows from cost_log respecting filters, paginated past the 1000 default cap.
async function fetchAllCostRows(admin: any, f: Filters, columns = "created_at, operation_type, model, cost_usd, project_id, user_id, metadata") {
  const rows: any[] = [];
  const pageSize = 1000;
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = admin.from("cost_log").select(columns).order("created_at", { ascending: true }).range(from, from + pageSize - 1);
    q = applyFilters(q, f);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;
  try {
    const guard = await requireAdmin(req);
    if (guard instanceof Response) return guard;

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "summary";
    const admin = adminClient();
    const filters = parseFilters(url);

    if (action === "summary") {
      const rows = await fetchAllCostRows(admin, { project_id: null, operation_type: null, date_from: null, date_to: null }, "cost_usd, created_at, project_id");
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
      const total = rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
      const monthTotal = rows.filter(r => r.created_at >= monthStart).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
      const todayTotal = rows.filter(r => r.created_at >= dayStart).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
      const projects = new Set(rows.map(r => r.project_id).filter(Boolean));
      const avgPerProject = projects.size > 0 ? total / projects.size : 0;
      return jsonResponse({
        total_usd: total,
        month_usd: monthTotal,
        today_usd: todayTotal,
        avg_per_project_usd: avgPerProject,
        usd_to_rub: USD_TO_RUB,
      });
    }

    if (action === "by_type") {
      const rows = await fetchAllCostRows(admin, filters, "operation_type, cost_usd");
      const map = new Map<string, { count: number; total: number }>();
      for (const r of rows) {
        const cur = map.get(r.operation_type) || { count: 0, total: 0 };
        cur.count += 1;
        cur.total += Number(r.cost_usd || 0);
        map.set(r.operation_type, cur);
      }
      const items = Array.from(map.entries()).map(([operation_type, v]) => ({
        operation_type,
        count: v.count,
        total_usd: v.total,
        avg_usd: v.count ? v.total / v.count : 0,
      })).sort((a, b) => b.total_usd - a.total_usd);
      return jsonResponse({ items });
    }

    if (action === "timeseries") {
      const granularity = (url.searchParams.get("granularity") || "day") as "day" | "week" | "month";
      const rows = await fetchAllCostRows(admin, filters, "created_at, cost_usd");
      const bucketKey = (iso: string) => {
        const d = new Date(iso);
        if (granularity === "month") {
          return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        }
        if (granularity === "week") {
          // ISO week start (Monday)
          const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
          const day = tmp.getUTCDay() || 7;
          tmp.setUTCDate(tmp.getUTCDate() - (day - 1));
          return tmp.toISOString().slice(0, 10);
        }
        return d.toISOString().slice(0, 10);
      };
      const map = new Map<string, number>();
      for (const r of rows) {
        const k = bucketKey(r.created_at);
        map.set(k, (map.get(k) || 0) + Number(r.cost_usd || 0));
      }
      const series = Array.from(map.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, total]) => ({ date, total }));
      return jsonResponse({ series });
    }

    if (action === "by_project") {
      const rows = await fetchAllCostRows(admin, filters, "project_id, operation_type, cost_usd");
      const map = new Map<string, any>();
      for (const r of rows) {
        const pid = r.project_id || "_none";
        const cur = map.get(pid) || { project_id: pid, article_generation: 0, photos: 0, deploys: 0, auto_post: 0, total_usd: 0 };
        cur.total_usd += Number(r.cost_usd || 0);
        if (r.operation_type === "article_generation") cur.article_generation += 1;
        else if (r.operation_type?.startsWith("fal_ai_")) cur.photos += 1;
        else if (r.operation_type === "cloudflare_deploy") cur.deploys += 1;
        else if (r.operation_type === "auto_post_cron") cur.auto_post += 1;
        map.set(pid, cur);
      }
      // Resolve project names
      const realIds = Array.from(map.keys()).filter(k => k !== "_none");
      let projects: any[] = [];
      if (realIds.length) {
        const { data } = await admin.from("projects").select("id, name, domain").in("id", realIds);
        projects = data || [];
      }
      const items = Array.from(map.values()).map(it => {
        if (it.project_id === "_none") return { ...it, name: "(без проекта)", domain: null };
        const p = projects.find(p => p.id === it.project_id);
        return { ...it, name: p?.name || "(без названия)", domain: p?.domain || null };
      }).sort((a, b) => b.total_usd - a.total_usd);
      return jsonResponse({ items });
    }

    if (action === "by_user") {
      const rows = await fetchAllCostRows(admin, filters, "user_id, operation_type, cost_usd");
      const map = new Map<string, any>();
      for (const r of rows) {
        if (!r.user_id) continue;
        const cur = map.get(r.user_id) || { user_id: r.user_id, articles: 0, sites: 0, photos: 0, deploys: 0, auto_post: 0, total_usd: 0 };
        cur.total_usd += Number(r.cost_usd || 0);
        if (r.operation_type === "article_generation") cur.articles += 1;
        else if (r.operation_type === "site_generation") cur.sites += 1;
        else if (r.operation_type?.startsWith("fal_ai_")) cur.photos += 1;
        else if (r.operation_type === "cloudflare_deploy") cur.deploys += 1;
        else if (r.operation_type === "auto_post_cron") cur.auto_post += 1;
        map.set(r.user_id, cur);
      }
      const ids = Array.from(map.keys());
      let profiles: any[] = [];
      if (ids.length) {
        const { data } = await admin.from("profiles").select("id, full_name, email").in("id", ids);
        profiles = data || [];
      }
      const items = Array.from(map.values()).map(it => {
        const p = profiles.find(p => p.id === it.user_id);
        return { ...it, full_name: p?.full_name || null, email: p?.email || null };
      }).sort((a, b) => b.total_usd - a.total_usd);
      return jsonResponse({ items });
    }

    if (action === "forecast") {
      // Use last 30 days as the pace baseline.
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const rows = await fetchAllCostRows(admin, { project_id: null, operation_type: null, date_from: since, date_to: null }, "operation_type, cost_usd");
      const articles = rows.filter(r => r.operation_type === "article_generation").length;
      const photos = rows.filter(r => r.operation_type?.startsWith("fal_ai_")).length;
      const spent = rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
      // Avg per article in last 30d for scaling estimate
      const articleSpent = rows.filter(r => r.operation_type === "article_generation").reduce((s, r) => s + Number(r.cost_usd || 0), 0);
      const avgArticle = articles ? articleSpent / articles : 0;
      const sitesNow = new Set(rows.map((r: any) => r.project_id).filter(Boolean)).size || 1;
      const articlesPerSitePerMonth = articles / sitesNow;
      return jsonResponse({
        current_pace: {
          articles_per_month: articles,
          photos_per_month: photos,
          expected_cost_usd: spent,
        },
        scaling_50_sites: {
          one_time_cost_usd: avgArticle * 50 * 10, // 10 seed articles / site as rough one-time
          monthly_cost_usd: avgArticle * 50 * Math.max(1, articlesPerSitePerMonth),
        },
      });
    }

    if (action === "articles_breakdown") {
      const rows = await fetchAllCostRows(admin, { project_id: null, operation_type: "article_generation", date_from: null, date_to: null }, "project_id, model, cost_usd, metadata");
      const isRefine = (m: any) => {
        const kind = m?.kind;
        return kind === "quality_check" || kind === "inline_edit" || kind === "outline";
      };
      const isMain = (m: any) => !isRefine(m); // null kind or 'section'
      const manual = rows.filter(r => !r.project_id && isMain(r.metadata));
      const factory = rows.filter(r => r.project_id && isMain(r.metadata));
      const sumAvg = (list: any[]) => {
        const total = list.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
        return { count: list.length, total_usd: total, avg_usd: list.length ? total / list.length : 0 };
      };
      // By model
      const byModel = new Map<string, any>();
      for (const r of rows) {
        const model = r.model || "(unknown)";
        const cur = byModel.get(model) || { model, main_count: 0, main_total: 0, refine_count: 0, refine_total: 0, total_usd: 0 };
        cur.total_usd += Number(r.cost_usd || 0);
        if (isRefine(r.metadata)) { cur.refine_count += 1; cur.refine_total += Number(r.cost_usd || 0); }
        else { cur.main_count += 1; cur.main_total += Number(r.cost_usd || 0); }
        byModel.set(model, cur);
      }
      const by_model = Array.from(byModel.values()).map(m => ({
        model: m.model,
        main_count: m.main_count,
        avg_main_usd: m.main_count ? m.main_total / m.main_count : 0,
        refine_count: m.refine_count,
        avg_refine_usd: m.refine_count ? m.refine_total / m.refine_count : 0,
        avg_total_per_article_usd: m.main_count ? (m.main_total + m.refine_total) / m.main_count : 0,
        total_usd: m.total_usd,
      })).sort((a, b) => b.total_usd - a.total_usd);
      return jsonResponse({
        manual: sumAvg(manual),
        factory: sumAvg(factory),
        by_model,
      });
    }

    if (action === "full_article_cost") {
      const rows = await fetchAllCostRows(admin, { project_id: null, operation_type: null, date_from: null, date_to: null }, "operation_type, cost_usd, metadata");
      const articleRows = rows.filter(r => r.operation_type === "article_generation");
      const isRefine = (m: any) => {
        const kind = m?.kind;
        return kind === "quality_check" || kind === "inline_edit" || kind === "outline";
      };
      const mainRows = articleRows.filter(r => !isRefine(r.metadata));
      const refineRows = articleRows.filter(r => isRefine(r.metadata));
      const photoRows = rows.filter(r => r.operation_type?.startsWith("fal_ai_"));
      const sumTotal = (list: any[]) => list.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
      const mainTotal = sumTotal(mainRows);
      const refineTotal = sumTotal(refineRows);
      const photoTotal = sumTotal(photoRows);
      const fullTotal = mainTotal + refineTotal + photoTotal;
      const { count: articlesCount } = await admin.from("articles").select("id", { count: "exact", head: true });
      const articles_count = articlesCount || 0;
      return jsonResponse({
        main: { count: mainRows.length, total_usd: mainTotal },
        refinements: { count: refineRows.length, total_usd: refineTotal },
        photos: { count: photoRows.length, total_usd: photoTotal },
        full: { total_usd: fullTotal, avg_per_article_usd: articles_count ? fullTotal / articles_count : 0 },
        articles_count,
      });
    }

    if (action === "openrouter_period_stats") {
      const dateFrom = url.searchParams.get("date_from");
      if (!dateFrom) return errorResponse("date_from required", 400);
      const { data: articles } = await admin.from("articles").select("id, created_at").gte("created_at", dateFrom);
      const costRows = await fetchAllCostRows(admin, { project_id: null, operation_type: null, date_from: dateFrom, date_to: null }, "created_at, cost_usd");
      return jsonResponse({ articles: articles || [], costs: costRows });
    }

    if (action === "export_csv") {
      const rows = await fetchAllCostRows(admin, filters, "created_at, operation_type, model, cost_usd, project_id, user_id, tokens_input, tokens_output");
      const header = "created_at,operation_type,model,cost_usd,project_id,user_id,tokens_input,tokens_output\n";
      const body = rows.map((r: any) => [
        r.created_at, r.operation_type, r.model || "", Number(r.cost_usd || 0).toFixed(6),
        r.project_id || "", r.user_id || "", r.tokens_input ?? "", r.tokens_output ?? "",
      ].map(v => String(v).replace(/,/g, " ")).join(",")).join("\n");
      return new Response(header + body, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/csv; charset=utf-8" },
      });
    }

    return errorResponse(`Unknown action: ${action}`, 400);
  } catch (e: any) {
    console.error("[cost-analytics] error:", e?.message, e?.stack);
    return errorResponse(e?.message || "Internal error", 500);
  }
});