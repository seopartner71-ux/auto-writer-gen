// ============================================================================
// P24 - FACETED NAVIGATION & FILTER ENGINE runner.
//
//   Catalog -> [FILTER ENGINE] -> catalog_filters + catalog_filter_pages -> PDE
//
// Produces DATA only. Никакого HTML, деплоя и записи в page_registry:
// реестр наполняет PDE, который дополнительно читает catalog_filter_pages.
//
// Body: { project_id, action, ... }
//   action = "analyze" | "build" | "content" | "toggle" | "list" | "qa"
// ============================================================================

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatJson, AiError } from "../_shared/aiClient.ts";
import {
  analyzeAttributes, buildLandings, auditFilters, attrKey, attributePriority,
  FILTER_DEFAULTS, type AttributeStat, type ProductLike,
} from "../_shared/filterEngine.ts";
import { getSiloUrl, getClusterUrl, shouldCollapseCluster } from "../_shared/siloUrl.ts";

const CONTENT_MODEL = "google/gemini-2.5-flash";

interface ClusterRow {
  id: string; silo_id: string; parent_id: string | null; name: string; slug: string;
  status: string | null;
}

function clusterPaths(silos: any[], clusters: ClusterRow[]): Map<string, string> {
  const siloById = new Map(silos.map((s) => [s.id, s]));
  const byId = new Map(clusters.map((c) => [c.id, c]));
  const rootsBySilo = new Map<string, ClusterRow[]>();
  for (const c of clusters) {
    if (c.parent_id) continue;
    rootsBySilo.set(c.silo_id, [...(rootsBySilo.get(c.silo_id) || []), c]);
  }
  const out = new Map<string, string>();
  for (const c of clusters) {
    const silo = siloById.get(c.silo_id);
    if (!silo) continue;
    const roots = rootsBySilo.get(c.silo_id) || [];
    const collapse = shouldCollapseCluster(c, silo, roots.length);
    const parents: string[] = [];
    let cur = c.parent_id ? byId.get(c.parent_id) : undefined;
    let guard = 0;
    while (cur && guard++ < 6) {
      parents.unshift(cur.slug);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    out.set(c.id, getClusterUrl({ slug: c.slug, siloSlug: silo.slug, parentSlugs: parents, collapse }));
  }
  return out;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.project_id || "");
    const action = String(body?.action || "list");
    if (!projectId) return errorResponse("project_id is required", 400);

    const admin = adminClient();
    const { data: project } = await admin.from("projects")
      .select("id, user_id, language, url_scheme").eq("id", projectId).maybeSingle();
    if (!project) return errorResponse("project not found", 404);
    if (project.user_id !== auth.userId) {
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: auth.userId, _role: "admin" });
      if (!isAdmin) return errorResponse("forbidden", 403);
    }
    const lang = String((project as any).language || "ru");
    const ru = lang !== "en";

    // ---------------- toggle: manual index / noindex ------------------------
    if (action === "toggle") {
      const filterId = String(body?.filter_id || "");
      const indexable = body?.indexable === true;
      if (!filterId) return errorResponse("filter_id is required", 400);
      const { data: row, error } = await admin.from("catalog_filters")
        .update({ indexable, manual_override: true, reason: indexable ? "MANUAL_INDEX" : "MANUAL_NOINDEX" })
        .eq("id", filterId).eq("project_id", projectId).select("id, attribute_key, indexable").maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) return errorResponse("filter not found", 404);
      // Существующие посадочные атрибута сразу следуют новому правилу.
      const { data: pages } = await admin.from("catalog_filter_pages")
        .select("id, facets, url_path, cluster_path").eq("project_id", projectId);
      const affected = (pages || []).filter((p: any) =>
        Array.isArray(p.facets) && p.facets.some((f: any) => attrKey(String(f.attribute || "")) === row.attribute_key));
      for (const p of affected) {
        await admin.from("catalog_filter_pages").update({
          indexable,
          canonical: indexable ? p.url_path : (p.cluster_path || null),
          reason: indexable ? "MANUAL_INDEX" : "MANUAL_NOINDEX",
        }).eq("id", p.id);
      }
      return jsonResponse({ ok: true, updated_pages: affected.length });
    }

    // ---------------- shared load ------------------------------------------
    const [silosRes, clustersRes, productsRes, keywordsRes] = await Promise.all([
      admin.from("site_silos").select("id, name, slug, status")
        .eq("project_id", projectId).neq("status", "archived"),
      admin.from("site_clusters").select("id, silo_id, parent_id, name, slug, status")
        .eq("project_id", projectId).neq("status", "archived"),
      admin.from("site_products")
        .select("id, site_cluster_id, silo_id, name, slug, url_path, brand, price, currency, images, characteristics, status, kind")
        .eq("project_id", projectId).neq("status", "archived").limit(20000),
      admin.from("site_keywords").select("keyword").eq("project_id", projectId).limit(5000),
    ]);
    const silos = (silosRes.data || []) as any[];
    const clusters = (clustersRes.data || []) as ClusterRow[];
    const products = (productsRes.data || []) as any[];
    const keywords = (keywordsRes.data || []).map((k: any) => String(k.keyword || ""));
    const paths = clusterPaths(silos, clusters);

    const productsByCluster = new Map<string, any[]>();
    for (const p of products) {
      if (String(p.kind || "") === "service") continue;
      const cid = p.site_cluster_id ? String(p.site_cluster_id) : "";
      if (!cid) continue;
      productsByCluster.set(cid, [...(productsByCluster.get(cid) || []), p]);
    }

    // ---------------- list --------------------------------------------------
    if (action === "list") {
      const [{ data: filters }, { data: pages }] = await Promise.all([
        admin.from("catalog_filters").select("*").eq("project_id", projectId).order("priority", { ascending: false }),
        admin.from("catalog_filter_pages").select("id, cluster_id, url_path, title, product_count, demand_score, indexable, reason, content_status, facets")
          .eq("project_id", projectId).eq("status", "active").order("demand_score", { ascending: false }).limit(2000),
      ]);
      const f = (filters || []) as any[];
      const p = (pages || []) as any[];
      return jsonResponse({
        ok: true,
        summary: {
          attributes: f.length,
          filters: f.reduce((n, x) => n + (Number(x.value_count) || 0), 0),
          landings: p.filter((x) => x.indexable).length,
          noindex: p.filter((x) => !x.indexable).length,
          products: products.length,
          categories: clusters.length,
        },
        filters: f,
        pages: p,
        cluster_names: clusters.map((c) => ({ id: c.id, name: c.name, path: paths.get(c.id) || "" })),
      });
    }

    // ---------------- qa ----------------------------------------------------
    if (action === "qa") {
      const { data: pages } = await admin.from("catalog_filter_pages")
        .select("url_path, canonical, indexable, product_count, cluster_path, seo_content")
        .eq("project_id", projectId).eq("status", "active").limit(5000);
      const known = new Set<string>([...paths.values(), ...silos.map((s) => getSiloUrl({ slug: s.slug })), "/catalog/"]);
      const issues = auditFilters((pages || []) as any[], known);
      const blockers = issues.filter((i) => i.level === "blocker");
      return jsonResponse({
        ok: true,
        pass: blockers.length === 0,
        blockers: blockers.length,
        warnings: issues.length - blockers.length,
        issues: issues.slice(0, 300),
      });
    }

    // ---------------- analyze ----------------------------------------------
    if (action === "analyze") {
      if (!products.length) return errorResponse("no products in catalog", 400);
      const { data: existing } = await admin.from("catalog_filters")
        .select("attribute_key, cluster_id, indexable, manual_override").eq("project_id", projectId);
      const manual = new Map<string, boolean>();
      for (const e of (existing || []) as any[]) {
        if (e.manual_override) manual.set(`${e.cluster_id || ""}::${e.attribute_key}`, e.indexable);
      }

      const rows: any[] = [];
      const pushStats = (clusterId: string | null, stats: AttributeStat[]) => {
        for (const s of stats) {
          const key = attrKey(s.attribute);
          const ov = manual.get(`${clusterId || ""}::${key}`);
          rows.push({
            project_id: projectId,
            cluster_id: clusterId,
            attribute: s.attribute,
            attribute_key: key,
            slug: s.slug,
            filter_type: s.filterType,
            values: s.values,
            value_count: s.values.length,
            product_count: s.productCount,
            indexable: ov !== undefined ? ov : !s.denied,
            manual_override: ov !== undefined,
            reason: s.reason,
            priority: attributePriority(s.attribute),
          });
        }
      };

      // Глобальный срез (cluster_id = null) - дерево атрибутов всего каталога.
      pushStats(null, analyzeAttributes(products as ProductLike[]));
      for (const c of clusters) {
        const items = productsByCluster.get(c.id) || [];
        if (items.length < FILTER_DEFAULTS.minAttributeProducts) continue;
        pushStats(c.id, analyzeAttributes(items as ProductLike[]));
      }

      await admin.from("catalog_filters").delete().eq("project_id", projectId);
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from("catalog_filters").insert(rows.slice(i, i + 500));
        if (error) throw new Error(`filters insert failed: ${error.message}`);
      }
      const global = rows.filter((r) => !r.cluster_id);
      return jsonResponse({
        ok: true,
        attributes: global.length,
        indexable: global.filter((r) => r.indexable).length,
        rows: rows.length,
        preview: global.slice(0, 40).map((r) => ({
          attribute: r.attribute, type: r.filter_type, values: r.value_count,
          products: r.product_count, indexable: r.indexable, reason: r.reason,
        })),
      });
    }

    // ---------------- build landings ---------------------------------------
    if (action === "build") {
      const { data: filterRows } = await admin.from("catalog_filters")
        .select("cluster_id, attribute_key, indexable, manual_override").eq("project_id", projectId);
      if (!filterRows?.length) return errorResponse("run analyze first", 400);

      const overridesFor = (clusterId: string): Map<string, boolean> => {
        const m = new Map<string, boolean>();
        for (const r of (filterRows || []) as any[]) {
          if (r.cluster_id && r.cluster_id !== clusterId) continue;
          if (!r.cluster_id && m.has(r.attribute_key)) continue;
          m.set(r.attribute_key, r.indexable === true);
        }
        return m;
      };

      const candidates: any[] = [];
      for (const c of clusters) {
        const items = (productsByCluster.get(c.id) || []) as ProductLike[];
        if (items.length < FILTER_DEFAULTS.minProducts) continue;
        const clusterPath = paths.get(c.id);
        if (!clusterPath) continue;
        const stats = analyzeAttributes(items);
        const landings = buildLandings({
          clusterId: c.id,
          clusterPath,
          clusterName: c.name,
          products: items,
          stats,
          keywords,
          overrides: overridesFor(c.id),
          lang,
        });
        for (const l of landings) {
          candidates.push({
            project_id: projectId,
            cluster_id: c.id,
            cluster_path: clusterPath,
            slug: l.slug,
            url_path: l.urlPath,
            title: l.title.slice(0, 180),
            h1: l.title.slice(0, 180),
            facets: l.facets,
            product_ids: l.productIds.slice(0, 500),
            product_count: l.productCount,
            keyword_hits: l.keywordHits,
            demand_score: l.demandScore,
            indexable: l.indexable,
            canonical: l.indexable ? l.urlPath : clusterPath,
            reason: l.reason,
            status: "active",
          });
        }
      }

      // Дедупликация URL внутри проекта: побеждает более востребованная.
      const byUrl = new Map<string, any>();
      for (const c of candidates.sort((a, b) => b.demand_score - a.demand_score)) {
        if (!byUrl.has(c.url_path)) byUrl.set(c.url_path, c);
      }
      const rows = [...byUrl.values()];

      // URL не должен конфликтовать со страницами реестра (категории, товары).
      const { data: reg } = await admin.from("page_registry")
        .select("url_path").eq("project_id", projectId).neq("decision", "rejected").limit(10000);
      const taken = new Set((reg || []).map((r: any) => String(r.url_path)));
      const clean = rows.filter((r) => !taken.has(r.url_path));

      if (body?.dry_run === true) {
        return jsonResponse({
          ok: true, dry_run: true, total: clean.length,
          indexable: clean.filter((r) => r.indexable).length,
          sample: clean.slice(0, 50),
        });
      }

      // Сохраняем уже сгенерированный контент для сохранившихся URL.
      const { data: prev } = await admin.from("catalog_filter_pages")
        .select("url_path, seo_content, content_status").eq("project_id", projectId);
      const prevByUrl = new Map((prev || []).map((p: any) => [p.url_path, p]));
      const payload = clean.map((r) => {
        const p = prevByUrl.get(r.url_path);
        return p?.seo_content ? { ...r, seo_content: p.seo_content, content_status: p.content_status } : r;
      });

      await admin.from("catalog_filter_pages").delete().eq("project_id", projectId);
      for (let i = 0; i < payload.length; i += 500) {
        const { error } = await admin.from("catalog_filter_pages").insert(payload.slice(i, i + 500));
        if (error) throw new Error(`landings insert failed: ${error.message}`);
      }

      return jsonResponse({
        ok: true,
        total: payload.length,
        indexable: payload.filter((r) => r.indexable).length,
        noindex: payload.filter((r) => !r.indexable).length,
        skipped_conflicts: rows.length - clean.length,
      });
    }

    // ---------------- content (intro + FAQ) --------------------------------
    if (action === "content") {
      const limit = Math.min(50, Math.max(1, Number(body?.limit) || 10));
      const { data: pages } = await admin.from("catalog_filter_pages")
        .select("id, title, url_path, facets, product_count, cluster_id, seo_content")
        .eq("project_id", projectId).eq("status", "active").eq("indexable", true)
        .order("demand_score", { ascending: false }).limit(400);
      const todo = ((pages || []) as any[])
        .filter((p) => !p.seo_content || !String((p.seo_content as any)?.intro || "").trim())
        .slice(0, limit);
      if (!todo.length) return jsonResponse({ ok: true, generated: 0, message: "nothing to generate" });

      const clusterName = new Map(clusters.map((c) => [c.id, c.name]));
      let generated = 0;
      const errors: string[] = [];
      for (const p of todo) {
        const facets = (p.facets || []) as any[];
        const sample = (productsByCluster.get(String(p.cluster_id)) || []).slice(0, 8)
          .map((x: any) => x.name).join("; ");
        try {
          const res = await chatJson<{ intro: string; faq: { q: string; a: string }[]; advantages: string[] }>({
            model: CONTENT_MODEL,
            functionName: "filter-engine",
            projectId,
            userId: auth.userId,
            system: ru
              ? "Ты SEO-копирайтер коммерческого каталога. Пишешь текст посадочной страницы фильтра. Только факты из входных данных, без выдуманных цен, сроков, сертификатов. Только короткий дефис, без длинного тире, без буквы е с точками, без markdown и жирного текста."
              : "You are an SEO copywriter for a commercial catalog filter landing. Use only the given facts. No invented prices or certificates. No markdown.",
            user: [
              `Категория: ${clusterName.get(String(p.cluster_id)) || ""}`,
              `Фильтр: ${facets.map((f) => `${f.attribute} = ${f.value}`).join(", ")}`,
              `Товаров в подборке: ${p.product_count}`,
              sample ? `Примеры позиций: ${sample}` : "",
              "",
              ru
                ? "Верни JSON: intro (2-3 предложения, что за подборка и кому подходит), advantages (3 коротких пункта), faq (3 вопроса с ответами не короче 25 слов)."
                : "Return JSON: intro (2-3 sentences), advantages (3 short items), faq (3 Q&A, answers 25+ words).",
            ].filter(Boolean).join("\n"),
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["intro", "advantages", "faq"],
              properties: {
                intro: { type: "string" },
                advantages: { type: "array", items: { type: "string" } },
                faq: {
                  type: "array",
                  items: {
                    type: "object", additionalProperties: false, required: ["q", "a"],
                    properties: { q: { type: "string" }, a: { type: "string" } },
                  },
                },
              },
            },
          });
          const clean = (s: string) => String(s || "").replace(/[—–]/g, "-").replace(/ё/g, "е").replace(/\*\*/g, "");
          await admin.from("catalog_filter_pages").update({
            seo_content: {
              intro: clean(res.data.intro),
              advantages: (res.data.advantages || []).map(clean).slice(0, 5),
              faq: (res.data.faq || []).slice(0, 4).map((f) => ({ q: clean(f.q), a: clean(f.a) })),
            },
            content_status: "ready",
          }).eq("id", p.id);
          generated++;
        } catch (e) {
          errors.push(`${p.url_path}: ${(e as Error).message.slice(0, 120)}`);
          if (e instanceof AiError && (e.kind === "budget" || e.kind === "auth")) break;
        }
      }
      return jsonResponse({ ok: true, generated, remaining: todo.length - generated, errors: errors.slice(0, 5) });
    }

    return errorResponse(`unknown action: ${action}`, 400);
  } catch (e) {
    return errorResponse((e as Error).message || "filter engine failed", 500);
  }
});
