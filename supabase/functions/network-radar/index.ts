// P25 - Multi-Site Network & AI Radar.
// Portfolio-level layer over existing engines: registry, releases, performance,
// queue engine, AI visibility, deployment. Does not modify project pipelines.
//
// Actions:
//   portfolio        -> aggregated metrics + per-project table rows
//   geo_timeline     -> monthly network GEO visibility
//   queries_list / queries_save / queries_delete
//   radar_run        -> run AI visibility for selected projects x queries
//   bulk             -> bulk actions through queue engine / deploy
//   alerts_list / alerts_read / alerts_scan
//   settings_get / settings_save  (white label)
//   clients_list / client_grant / client_revoke
//   client_overview  -> read-only data for the client cabinet

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

type Row = Record<string, any>;

async function callFn(fn: string, payload: unknown, userId: string): Promise<Row> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "x-queue-user-id": userId,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(json?.error || `HTTP ${res.status}`) };
    return { ok: true, ...(json as Row) };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

const avg = (nums: number[]) =>
  nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;

/** GEO visibility 0-100 out of ai_visibility rows. */
function geoFromVisibility(rows: Row[]): number {
  if (!rows.length) return 0;
  let sum = 0;
  for (const r of rows) {
    if (!r.mentioned) continue;
    const pos = Number(r.position || 8);
    let v = Math.max(20, 100 - (pos - 1) * 10);
    if (r.cited) v = Math.min(100, v + 10);
    sum += v;
  }
  return Math.round(sum / rows.length);
}

async function ownedProjects(sb: Row, userId: string, ids?: string[]) {
  let q = sb.from("projects")
    .select("id, name, domain, custom_domain, production_url, deployment_status, published_at, last_qa_report, created_at")
    .eq("user_id", userId);
  if (ids?.length) q = q.in("id", ids);
  const { data } = await q.order("created_at", { ascending: false });
  return (data || []) as Row[];
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;
    const sb = adminClient();
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "portfolio");

    // ------------------------------------------------------------ portfolio --
    if (action === "portfolio") {
      const projects = await ownedProjects(sb, userId);
      const ids = projects.map((p) => p.id);
      if (!ids.length) {
        return jsonResponse({ stats: { total: 0, published: 0, in_progress: 0, geo: 0, seo: 0, indexed_urls: 0 }, rows: [] });
      }

      const [{ data: scores }, { data: releases }, { data: pages }, { data: vis }] = await Promise.all([
        sb.from("project_score_history").select("*").in("project_id", ids)
          .order("created_at", { ascending: false }).limit(2000),
        sb.from("site_releases").select("project_id, version, status, is_current, published_url, created_at, pages")
          .in("project_id", ids).order("created_at", { ascending: false }).limit(2000),
        sb.from("page_registry").select("project_id, status, indexable, quality_status")
          .in("project_id", ids).limit(50000),
        sb.from("ai_visibility").select("project_id, mentioned, position, cited, checked_at")
          .in("project_id", ids).order("checked_at", { ascending: false }).limit(5000),
      ]);

      const latestScore = new Map<string, Row>();
      for (const s of (scores || []) as Row[]) if (!latestScore.has(s.project_id)) latestScore.set(s.project_id, s);
      const prevScore = new Map<string, Row>();
      for (const s of (scores || []) as Row[]) {
        if (latestScore.get(s.project_id)?.id !== s.id && !prevScore.has(s.project_id)) prevScore.set(s.project_id, s);
      }
      const latestRelease = new Map<string, Row>();
      for (const r of (releases || []) as Row[]) if (!latestRelease.has(r.project_id)) latestRelease.set(r.project_id, r);

      const pageStat = new Map<string, { total: number; indexable: number; critical: number }>();
      for (const p of (pages || []) as Row[]) {
        const st = pageStat.get(p.project_id) || { total: 0, indexable: 0, critical: 0 };
        st.total++;
        if (p.indexable !== false) st.indexable++;
        if (p.quality_status === "critical" || p.quality_status === "failed") st.critical++;
        pageStat.set(p.project_id, st);
      }

      const visByProject = new Map<string, Row[]>();
      for (const v of (vis || []) as Row[]) {
        const arr = visByProject.get(v.project_id) || [];
        if (arr.length < 120) arr.push(v);
        visByProject.set(v.project_id, arr);
      }

      const rows = projects.map((p) => {
        const sc = latestScore.get(p.id) || {};
        const prev = prevScore.get(p.id) || {};
        const rel = latestRelease.get(p.id);
        const st = pageStat.get(p.id) || { total: 0, indexable: 0, critical: 0 };
        const vrows = visByProject.get(p.id) || [];
        const geoLive = geoFromVisibility(vrows);
        const geo = geoLive || Number(sc.geo_score || 0);
        const geoPrev = Number(prev.geo_score || 0);
        return {
          id: p.id,
          name: p.name,
          url: p.production_url || (p.custom_domain ? `https://${p.custom_domain}` : (p.domain ? `https://${p.domain}` : null)),
          status: p.deployment_status || (p.published_at ? "published" : "draft"),
          seo: Number(sc.seo_score || 0),
          geo,
          geo_delta: geoPrev ? geo - geoPrev : 0,
          pages: st.total || Number(rel?.pages || 0),
          indexed_urls: st.indexable,
          qa_critical: st.critical,
          release: rel?.version || null,
          release_at: rel?.created_at || null,
          checked_at: vrows[0]?.checked_at || sc.created_at || null,
          flags: {
            geo_drop: geoPrev > 0 && geo < geoPrev - 3,
            needs_qa: st.critical > 0,
            new_release: !!rel && Date.now() - new Date(rel.created_at).getTime() < 7 * 864e5,
            index_errors: st.total > 0 && st.indexable === 0,
          },
        };
      });

      return jsonResponse({
        stats: {
          total: rows.length,
          published: rows.filter((r) => r.status === "published" || r.release).length,
          in_progress: rows.filter((r) => !(r.status === "published" || r.release)).length,
          geo: avg(rows.map((r) => r.geo).filter(Boolean)),
          seo: avg(rows.map((r) => r.seo).filter(Boolean)),
          indexed_urls: rows.reduce((a, r) => a + (r.indexed_urls || 0), 0),
        },
        rows,
      });
    }

    // --------------------------------------------------------- geo timeline --
    if (action === "geo_timeline") {
      const projects = await ownedProjects(sb, userId);
      const ids = projects.map((p) => p.id);
      if (!ids.length) return jsonResponse({ points: [] });
      const since = new Date(Date.now() - 180 * 864e5).toISOString();
      const { data } = await sb.from("ai_visibility")
        .select("project_id, mentioned, position, cited, checked_at")
        .in("project_id", ids).gte("checked_at", since)
        .order("checked_at", { ascending: true }).limit(20000);
      const buckets = new Map<string, Row[]>();
      for (const r of (data || []) as Row[]) {
        const key = String(r.checked_at).slice(0, 7);
        const arr = buckets.get(key) || [];
        arr.push(r);
        buckets.set(key, arr);
      }
      const points = Array.from(buckets.entries()).map(([month, rows]) => ({
        month, geo: geoFromVisibility(rows), checks: rows.length,
      }));
      return jsonResponse({ points });
    }

    // ------------------------------------------------------- radar queries ---
    if (action === "queries_list") {
      const { data } = await sb.from("radar_queries").select("*")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
      return jsonResponse({ queries: data || [] });
    }

    if (action === "queries_save") {
      const list = (Array.isArray(body?.queries) ? body.queries : [])
        .map((q: unknown) => String(q || "").trim()).filter(Boolean).slice(0, 100);
      if (!list.length) return errorResponse("queries required", 400);
      const projectId = body?.project_id ? String(body.project_id) : null;
      const rows = list.map((query: string) => ({ user_id: userId, project_id: projectId, query }));
      const { error } = await sb.from("radar_queries").upsert(rows, {
        onConflict: "user_id,project_id,query", ignoreDuplicates: true,
      });
      if (error && !/duplicate|conflict/i.test(error.message)) {
        for (const r of rows) await sb.from("radar_queries").insert(r).then(() => {}, () => {});
      }
      const { data } = await sb.from("radar_queries").select("*")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
      return jsonResponse({ ok: true, queries: data || [] });
    }

    if (action === "queries_delete") {
      const id = String(body?.id || "");
      if (!id) return errorResponse("id required", 400);
      await sb.from("radar_queries").delete().eq("id", id).eq("user_id", userId);
      return jsonResponse({ ok: true });
    }

    // ----------------------------------------------------------- radar run ---
    if (action === "radar_run") {
      const projectIds = (Array.isArray(body?.project_ids) ? body.project_ids : []).map(String).slice(0, 25);
      if (!projectIds.length) return errorResponse("project_ids required", 400);
      const projects = await ownedProjects(sb, userId, projectIds);
      if (!projects.length) return errorResponse("No accessible projects", 403);

      let queries = (Array.isArray(body?.queries) ? body.queries : [])
        .map((q: unknown) => String(q || "").trim()).filter(Boolean).slice(0, 10);
      if (!queries.length) {
        const { data } = await sb.from("radar_queries").select("query")
          .eq("user_id", userId).eq("is_active", true).limit(10);
        queries = ((data || []) as Row[]).map((r) => r.query);
      }
      if (!queries.length) return errorResponse("No radar queries configured", 400);

      const results: Row[] = [];
      for (const p of projects) {
        const res = await callFn("ai-visibility", {
          project_id: p.id, action: "check", queries,
        }, userId);
        results.push({ project_id: p.id, name: p.name, ok: !!res.ok, inserted: res.inserted || 0, error: res.error || null });
      }
      return jsonResponse({ ok: true, results });
    }

    // ---------------------------------------------------------------- bulk ---
    if (action === "bulk") {
      const projectIds = (Array.isArray(body?.project_ids) ? body.project_ids : []).map(String).slice(0, 100);
      const op = String(body?.op || "");
      if (!projectIds.length) return errorResponse("project_ids required", 400);
      const projects = await ownedProjects(sb, userId, projectIds);
      if (!projects.length) return errorResponse("No accessible projects", 403);

      const queueTypes: Record<string, string> = {
        seo: "seo", content: "content", articles: "blog", media: "media",
      };
      const results: Row[] = [];
      for (const p of projects) {
        let res: Row;
        if (queueTypes[op]) {
          res = await callFn("queue-engine", {
            action: "start", project_id: p.id, job_type: queueTypes[op], params: body?.params || {},
          }, userId);
        } else if (op === "qa") {
          res = await callFn("site-qa-check", { project_id: p.id }, userId);
        } else if (op === "deploy") {
          res = await callFn("deploy-cloudflare-direct", { project_id: p.id }, userId);
        } else if (op === "zip") {
          res = await callFn("deploy-cloudflare-direct", { project_id: p.id, export_zip: true }, userId);
        } else {
          return errorResponse(`Unknown op: ${op}`, 400);
        }
        results.push({ project_id: p.id, name: p.name, ok: !!res.ok, error: res.error || null, job: res.job || null });
      }
      return jsonResponse({ ok: true, op, results });
    }

    // -------------------------------------------------------------- alerts ---
    if (action === "alerts_list") {
      const { data } = await sb.from("network_alerts").select("*")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
      return jsonResponse({ alerts: data || [] });
    }

    if (action === "alerts_read") {
      const ids = (Array.isArray(body?.ids) ? body.ids : []).map(String);
      let q = sb.from("network_alerts").update({ is_read: true }).eq("user_id", userId);
      if (ids.length) q = q.in("id", ids);
      await q;
      return jsonResponse({ ok: true });
    }

    if (action === "alerts_scan") {
      const projects = await ownedProjects(sb, userId);
      const ids = projects.map((p) => p.id);
      if (!ids.length) return jsonResponse({ ok: true, created: 0 });

      const { data: settings } = await sb.from("agency_settings").select("*").eq("user_id", userId).maybeSingle();
      const enabled = (settings?.alerts || {}) as Row;
      const threshold = Number(settings?.geo_drop_threshold || 5);

      const [{ data: scores }, { data: pages }] = await Promise.all([
        sb.from("project_score_history").select("project_id, geo_score, created_at")
          .in("project_id", ids).order("created_at", { ascending: false }).limit(2000),
        sb.from("page_registry").select("project_id, quality_status").in("project_id", ids).limit(50000),
      ]);

      const byProject = new Map<string, Row[]>();
      for (const s of (scores || []) as Row[]) {
        const arr = byProject.get(s.project_id) || [];
        arr.push(s);
        byProject.set(s.project_id, arr);
      }
      const critical = new Map<string, number>();
      for (const p of (pages || []) as Row[]) {
        if (p.quality_status === "critical" || p.quality_status === "failed") {
          critical.set(p.project_id, (critical.get(p.project_id) || 0) + 1);
        }
      }

      const fresh: Row[] = [];
      for (const p of projects) {
        const hist = byProject.get(p.id) || [];
        if (enabled.geo_drop !== false && hist.length >= 2) {
          const drop = Number(hist[1].geo_score || 0) - Number(hist[0].geo_score || 0);
          if (drop >= threshold) {
            fresh.push({
              user_id: userId, project_id: p.id, alert_type: "geo_drop", severity: "warning",
              title: `GEO упал: ${p.name}`,
              message: `Видимость в AI снизилась на ${drop} пунктов (${hist[1].geo_score} -> ${hist[0].geo_score}).`,
              payload: { from: hist[1].geo_score, to: hist[0].geo_score },
            });
          }
        }
        const crit = critical.get(p.id) || 0;
        if (enabled.qa_critical !== false && crit > 0) {
          fresh.push({
            user_id: userId, project_id: p.id, alert_type: "qa_critical", severity: "critical",
            title: `QA Critical: ${p.name}`,
            message: `Страниц с критическими ошибками качества: ${crit}.`,
            payload: { count: crit },
          });
        }
      }

      // Skip alerts already raised for the same project+type in the last 24h.
      const since = new Date(Date.now() - 864e5).toISOString();
      const { data: recent } = await sb.from("network_alerts")
        .select("project_id, alert_type").eq("user_id", userId).gte("created_at", since);
      const seen = new Set(((recent || []) as Row[]).map((r) => `${r.project_id}:${r.alert_type}`));
      const toInsert = fresh.filter((a) => !seen.has(`${a.project_id}:${a.alert_type}`));
      if (toInsert.length) {
        await sb.from("network_alerts").insert(toInsert);
        await sb.from("notifications").insert(toInsert.map((a) => ({
          user_id: userId, title: a.title, message: a.message,
        }))).then(() => {}, () => {});
        const chatId = settings?.telegram_chat_id;
        const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
        if (chatId && token) {
          const text = toInsert.map((a) => `${a.title}\n${a.message}`).join("\n\n");
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text }),
          }).catch(() => {});
        }
      }
      return jsonResponse({ ok: true, created: toInsert.length });
    }

    // ------------------------------------------------------------ settings ---
    if (action === "settings_get") {
      const { data } = await sb.from("agency_settings").select("*").eq("user_id", userId).maybeSingle();
      return jsonResponse({ settings: data || null });
    }

    if (action === "settings_save") {
      const patch = {
        user_id: userId,
        agency_name: body?.agency_name ?? null,
        logo_url: body?.logo_url ?? null,
        primary_color: body?.primary_color || "#6E56CF",
        accent_color: body?.accent_color || "#0A0A0A",
        telegram_chat_id: body?.telegram_chat_id ?? null,
        alert_email: body?.alert_email ?? null,
        alerts: body?.alerts || {},
        geo_drop_threshold: Number(body?.geo_drop_threshold || 5),
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await sb.from("agency_settings").upsert(patch, { onConflict: "user_id" })
        .select("*").maybeSingle();
      if (error) return errorResponse(error.message, 500);
      return jsonResponse({ ok: true, settings: data });
    }

    // ------------------------------------------------------------- clients ---
    if (action === "clients_list") {
      const { data } = await sb.from("client_access").select("*").eq("owner_id", userId)
        .order("created_at", { ascending: false });
      const clientIds = Array.from(new Set(((data || []) as Row[]).map((r) => r.client_user_id)));
      const { data: profiles } = clientIds.length
        ? await sb.from("profiles").select("id, email, full_name").in("id", clientIds)
        : { data: [] as Row[] };
      const map = new Map(((profiles || []) as Row[]).map((p) => [p.id, p]));
      return jsonResponse({
        clients: ((data || []) as Row[]).map((r) => ({ ...r, profile: map.get(r.client_user_id) || null })),
      });
    }

    if (action === "client_grant") {
      const email = String(body?.email || "").trim().toLowerCase();
      const projectId = String(body?.project_id || "");
      if (!email || !projectId) return errorResponse("email and project_id required", 400);
      const own = await ownedProjects(sb, userId, [projectId]);
      if (!own.length) return errorResponse("Forbidden", 403);
      const { data: profile } = await sb.from("profiles").select("id").ilike("email", email).maybeSingle();
      if (!profile) return errorResponse("Пользователь с такой почтой не найден", 404);
      await sb.from("client_access").upsert(
        { owner_id: userId, client_user_id: profile.id, project_id: projectId },
        { onConflict: "client_user_id,project_id" },
      );
      await sb.from("user_roles").insert({ user_id: profile.id, role: "client" }).then(() => {}, () => {});
      return jsonResponse({ ok: true });
    }

    if (action === "client_revoke") {
      const id = String(body?.id || "");
      if (!id) return errorResponse("id required", 400);
      await sb.from("client_access").delete().eq("id", id).eq("owner_id", userId);
      return jsonResponse({ ok: true });
    }

    // ------------------------------------------------------ client cabinet ---
    if (action === "client_overview") {
      const { data: access } = await sb.from("client_access").select("project_id, owner_id")
        .eq("client_user_id", userId);
      const ids = ((access || []) as Row[]).map((r) => r.project_id);
      if (!ids.length) return jsonResponse({ projects: [], branding: null });

      const ownerId = ((access || []) as Row[])[0]?.owner_id;
      const [{ data: branding }, { data: projects }, { data: scores }, { data: releases }, { data: articles }] =
        await Promise.all([
          sb.from("agency_settings").select("agency_name, logo_url, primary_color, accent_color")
            .eq("user_id", ownerId).maybeSingle(),
          sb.from("projects").select("id, name, production_url, custom_domain, domain, total_views").in("id", ids),
          sb.from("project_score_history").select("*").in("project_id", ids)
            .order("created_at", { ascending: false }).limit(500),
          sb.from("site_releases").select("project_id, version, status, published_url, created_at")
            .in("project_id", ids).order("created_at", { ascending: false }).limit(100),
          sb.from("articles").select("id, title, project_id, status, created_at").in("project_id", ids)
            .order("created_at", { ascending: false }).limit(100),
        ]);

      const latest = new Map<string, Row>();
      for (const s of (scores || []) as Row[]) if (!latest.has(s.project_id)) latest.set(s.project_id, s);
      return jsonResponse({
        branding: branding || null,
        projects: ((projects || []) as Row[]).map((p) => ({
          ...p,
          scores: latest.get(p.id) || null,
          releases: ((releases || []) as Row[]).filter((r) => r.project_id === p.id).slice(0, 10),
          articles: ((articles || []) as Row[]).filter((a) => a.project_id === p.id).slice(0, 20),
        })),
      });
    }

    return errorResponse(`Unknown action: ${action}`, 400);
  } catch (e) {
    console.error("[network-radar] error", e);
    return errorResponse(e instanceof Error ? e.message : "Network radar failed", 500);
  }
});
