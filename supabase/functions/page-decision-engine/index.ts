// Page Decision Engine runner.
//
// SEMANTICS -> PDE -> PAGE REGISTRY -> CONTENT -> LINKS -> BUILD
//
// Reads the existing SILO structure (site_silos / site_clusters /
// site_products / site_keywords / articles) and writes the decision layer:
//   public.page_registry     - one row per SEO page candidate
//   public.page_decision_log - append-only decision history
//
// Nothing else is mutated. `dry_run: true` computes and returns everything
// without touching the database.
//
// Input: { project_id: string, dry_run?: boolean }

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import {
  decidePage, demandScore, intentWeight, resolveIntent, semanticScore,
  type EntityFacts, type PdeIntent,
} from "../_shared/pageDecision.ts";
import {
  getSiloUrl, getClusterUrl, shouldCollapseCluster, slugifyPath,
} from "../_shared/siloUrl.ts";
import { SYSTEM_PAGES, systemEntityId, type SystemPageKey } from "../_shared/systemPages.ts";

interface RegistryRow {
  project_id: string;
  entity_type: string;
  entity_id: string;
  page_type: string;
  url_path: string;
  intent: string;
  demand_score: number;
  semantic_score: number;
  product_count: number;
  keyword_count: number;
  duplicate_score: number;
  cannibalization_score: number;
  decision: string;
  reason: string;
  has_offer: boolean;
  status: string;
  title: string;
  decided_at: string;
  indexable: boolean;
  canonical: string;
  is_system: boolean;
}

function nameKey(v: string): string {
  return String(v || "").toLowerCase().replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ").trim();
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.project_id || "");
    const dryRun = body?.dry_run === true;
    if (!projectId) return errorResponse("project_id is required", 400);

    const admin = adminClient();

    const { data: project } = await admin.from("projects")
      .select("id, user_id, url_scheme").eq("id", projectId).maybeSingle();
    if (!project) return errorResponse("project not found", 404);
    if (project.user_id !== auth.userId) {
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: auth.userId, _role: "admin" });
      if (!isAdmin) return errorResponse("forbidden", 403);
    }

    const [silosRes, clustersRes, productsRes, keywordsRes, articlesRes] = await Promise.all([
      admin.from("site_silos").select("id, name, slug, description, status, seo_content")
        .eq("project_id", projectId).neq("status", "archived"),
      admin.from("site_clusters").select("id, silo_id, parent_id, name, slug, description, status, page_type, seo_content")
        .eq("project_id", projectId).neq("status", "archived"),
      admin.from("site_products").select("id, silo_id, site_cluster_id, name, slug, url_path, kind, status, region, seo_content")
        .eq("project_id", projectId).neq("status", "archived").limit(5000),
      admin.from("site_keywords").select("id, keyword, frequency, intent, priority, silo_id, site_cluster_id, target_type, target_id, semantic_terms")
        .eq("project_id", projectId).limit(5000),
      admin.from("articles").select("id, title, slug, url_path, silo_id, site_cluster_id, status")
        .eq("project_id", projectId).limit(2000),
    ]);

    const silos = (silosRes.data || []) as any[];
    const clusters = (clustersRes.data || []) as any[];
    const products = (productsRes.data || []) as any[];
    const keywords = (keywordsRes.data || []) as any[];
    const articles = (articlesRes.data || []) as any[];

    const siloById = new Map(silos.map((s) => [s.id, s]));
    const clusterById = new Map(clusters.map((c) => [c.id, c]));

    // ---- aggregate semantics per entity -----------------------------------
    interface Agg { volume: number; count: number; intents: string[]; priority: number; terms: Set<string> }
    const emptyAgg = (): Agg => ({ volume: 0, count: 0, intents: [], priority: 0, terms: new Set<string>() });
    const bySilo = new Map<string, Agg>();
    const byCluster = new Map<string, Agg>();
    const byProduct = new Map<string, Agg>();

    const push = (map: Map<string, Agg>, id: string, k: any) => {
      if (!id) return;
      const agg = map.get(id) || emptyAgg();
      agg.volume += Number(k.frequency) || 0;
      agg.count += 1;
      if (k.intent) agg.intents.push(String(k.intent));
      agg.priority = Math.max(agg.priority, Number(k.priority) || 0);
      for (const t of (k.semantic_terms || [])) agg.terms.add(String(t).toLowerCase());
      map.set(id, agg);
    };

    for (const k of keywords) {
      if (k.target_type === "product" && k.target_id) push(byProduct, k.target_id, k);
      if (k.site_cluster_id) push(byCluster, k.site_cluster_id, k);
      if (k.silo_id) push(bySilo, k.silo_id, k);
    }

    const productsByCluster = new Map<string, any[]>();
    const productsBySilo = new Map<string, any[]>();
    for (const p of products) {
      if (p.site_cluster_id) {
        productsByCluster.set(p.site_cluster_id, [...(productsByCluster.get(p.site_cluster_id) || []), p]);
      }
      if (p.silo_id) {
        productsBySilo.set(p.silo_id, [...(productsBySilo.get(p.silo_id) || []), p]);
      }
    }
    const childrenBySilo = new Map<string, any[]>();
    const childrenByCluster = new Map<string, any[]>();
    for (const c of clusters) {
      childrenBySilo.set(c.silo_id, [...(childrenBySilo.get(c.silo_id) || []), c]);
      if (c.parent_id) childrenByCluster.set(c.parent_id, [...(childrenByCluster.get(c.parent_id) || []), c]);
    }

    // ---- duplicate / cannibalization scoring ------------------------------
    // Same normalised name across entities = duplicate; overlapping head
    // keyword across two entities = cannibalization.
    const nameCount = new Map<string, number>();
    for (const c of clusters) nameCount.set(nameKey(c.name), (nameCount.get(nameKey(c.name)) || 0) + 1);
    for (const s of silos) nameCount.set(nameKey(s.name), (nameCount.get(nameKey(s.name)) || 0) + 1);

    const headKwOwner = new Map<string, string[]>();
    for (const k of keywords) {
      const key = nameKey(k.keyword);
      const owner = k.site_cluster_id || k.silo_id;
      if (!key || !owner) continue;
      const arr = headKwOwner.get(key) || [];
      if (!arr.includes(owner)) arr.push(owner);
      headKwOwner.set(key, arr);
    }
    const cannibalById = new Map<string, number>();
    for (const owners of headKwOwner.values()) {
      if (owners.length < 2) continue;
      for (const o of owners) cannibalById.set(o, Math.min(100, (cannibalById.get(o) || 0) + 45));
    }

    const rows: RegistryRow[] = [];
    const now = new Date().toISOString();

    const makeRow = (
      entityType: EntityFacts["entityType"], id: string, title: string, urlPath: string,
      facts: EntityFacts,
    ) => {
      const res = decidePage(facts);
      rows.push({
        project_id: projectId,
        entity_type: entityType,
        entity_id: id,
        page_type: res.pageType,
        url_path: urlPath,
        intent: facts.intent,
        demand_score: facts.demandScore,
        semantic_score: facts.semanticScore,
        product_count: facts.productCount,
        keyword_count: facts.keywordCount,
        duplicate_score: facts.duplicateScore,
        cannibalization_score: facts.cannibalizationScore,
        decision: res.decision,
        reason: res.reason,
        has_offer: res.hasOffer,
        status: res.decision,
        title,
        decided_at: now,
        indexable: res.decision !== "rejected",
        canonical: urlPath,
        is_system: false,
      });
    };

    // ---- silo hubs ---------------------------------------------------------
    for (const s of silos) {
      const agg = bySilo.get(s.id) || emptyAgg();
      const intent = resolveIntent(agg.intents) as PdeIntent;
      const kids = childrenBySilo.get(s.id) || [];
      const facts: EntityFacts = {
        entityType: "hub",
        intent,
        keywordCount: agg.count,
        demandScore: demandScore({
          volume: agg.volume, keywordCount: agg.count,
          intentWeight: intentWeight(intent), priority: agg.priority,
        }),
        semanticScore: semanticScore({
          keywordCount: agg.count, uniqueTerms: agg.terms.size,
          hasContent: !!s.seo_content, hasDescription: !!s.description,
        }),
        productCount: (productsBySilo.get(s.id) || []).filter((p: any) => p.kind !== "service").length,
        serviceCount: (productsBySilo.get(s.id) || []).filter((p: any) => p.kind === "service").length,
        hasContent: !!s.seo_content,
        childCount: kids.length,
        duplicateScore: 0,
        cannibalizationScore: cannibalById.get(s.id) || 0,
      };
      makeRow("hub", s.id, s.name, getSiloUrl({ slug: s.slug }), facts);
    }

    // ---- categories / services --------------------------------------------
    for (const c of clusters) {
      const silo = siloById.get(c.silo_id);
      if (!silo) continue;
      const rootCount = (childrenBySilo.get(c.silo_id) || []).filter((x) => !x.parent_id).length;
      const collapse = shouldCollapseCluster(c, silo, rootCount);
      const parentSlugs: string[] = [];
      let cur = c.parent_id ? clusterById.get(c.parent_id) : null;
      const guard = new Set<string>();
      while (cur && !guard.has(cur.id)) {
        guard.add(cur.id);
        parentSlugs.unshift(cur.slug);
        cur = cur.parent_id ? clusterById.get(cur.parent_id) : null;
      }
      const url = getClusterUrl({ slug: c.slug, siloSlug: silo.slug, parentSlugs, collapse });

      const agg = byCluster.get(c.id) || emptyAgg();
      const intent = resolveIntent(agg.intents) as PdeIntent;
      const attached = productsByCluster.get(c.id) || [];
      const prods = attached.filter((p) => p.kind !== "service");
      const servs = attached.filter((p) => p.kind === "service");
      const isService = c.page_type === "service"
        || (attached.length > 0 && prods.length === 0 && servs.length > 0);
      const dupName = (nameCount.get(nameKey(c.name)) || 0) > 1 && !collapse;
      const facts: EntityFacts = {
        entityType: c.page_type === "service" ? "service" : "category",
        intent,
        keywordCount: agg.count,
        demandScore: demandScore({
          volume: agg.volume, keywordCount: agg.count,
          intentWeight: intentWeight(intent), priority: agg.priority,
        }),
        semanticScore: semanticScore({
          keywordCount: agg.count, uniqueTerms: agg.terms.size,
          hasContent: !!c.seo_content, hasDescription: !!c.description,
        }),
        productCount: prods.length,
        serviceCount: servs.length,
        hasContent: !!c.seo_content,
        childCount: (childrenByCluster.get(c.id) || []).length,
        duplicateScore: collapse ? 100 : dupName ? 90 : 0,
        cannibalizationScore: cannibalById.get(c.id) || 0,
        isService,
      };
      makeRow(facts.entityType, c.id, c.name, url, facts);
    }

    // ---- products / services ----------------------------------------------
    for (const p of products) {
      const agg = byProduct.get(p.id) || emptyAgg();
      const intent = (agg.intents.length ? resolveIntent(agg.intents) : "transactional") as PdeIntent;
      const cluster = p.site_cluster_id ? clusterById.get(p.site_cluster_id) : null;
      const silo = p.silo_id ? siloById.get(p.silo_id) : (cluster ? siloById.get(cluster.silo_id) : null);
      let url = p.url_path as string | null;
      if (!url) {
        const slug = slugifyPath(p.slug || p.name);
        if (cluster && silo) {
          const rootCount = (childrenBySilo.get(cluster.silo_id) || []).filter((x: any) => !x.parent_id).length;
          const collapse = shouldCollapseCluster(cluster, silo, rootCount);
          url = `${getClusterUrl({ slug: cluster.slug, siloSlug: silo.slug, collapse })}${slug}.html`;
        } else if (silo) {
          url = `${getSiloUrl({ slug: silo.slug })}${slug}.html`;
        } else {
          url = `/catalog/${slug}.html`;
        }
      }
      const facts: EntityFacts = {
        entityType: p.kind === "service" ? "service" : "product",
        intent,
        keywordCount: agg.count,
        demandScore: demandScore({
          volume: agg.volume, keywordCount: agg.count,
          intentWeight: intentWeight(intent), priority: agg.priority,
        }),
        semanticScore: semanticScore({
          keywordCount: agg.count, uniqueTerms: agg.terms.size,
          hasContent: !!p.seo_content, hasDescription: !!p.description,
        }),
        productCount: p.kind === "service" ? 0 : 1,
        serviceCount: p.kind === "service" ? 1 : 0,
        hasContent: !!p.seo_content,
        childCount: 0,
        duplicateScore: 0,
        cannibalizationScore: 0,
        isService: p.kind === "service",
        isCatalogItem: true,
        hasRegion: !!p.region,
      };
      makeRow(facts.entityType, p.id, p.name, url, facts);
    }

    // ---- articles ----------------------------------------------------------
    for (const a of articles) {
      if (String(a.status || "") === "archived") continue;
      const url = a.url_path || `/posts/${slugifyPath(a.slug || a.title || "")}.html`;
      makeRow("article", a.id, a.title || "", url, {
        entityType: "article",
        intent: "informational",
        keywordCount: 1,
        demandScore: 0,
        semanticScore: 60,
        hasContent: true,
        productCount: 0,
        childCount: 0,
        duplicateScore: 0,
        cannibalizationScore: 0,
      });
    }

    // ---- second pass: a hub whose every child was rejected is an empty hub ---
    {
      const byId = new Map(rows.map((r) => [r.entity_id, r]));
      for (const s2 of silos) {
        const row = byId.get(s2.id);
        if (!row || row.decision !== "approved" || row.page_type !== "hub") continue;
        if (row.keyword_count > 0 || row.product_count > 0) continue;
        const kids = (childrenBySilo.get(s2.id) || []);
        if (!kids.length) continue;
        const anyAlive = kids.some((k: any) => {
          const d = byId.get(k.id)?.decision;
          return d === "approved" || d === "review";
        });
        if (!anyAlive) {
          row.decision = "rejected";
          row.status = "rejected";
          row.reason = "LOW_VALUE";
        }
      }
    }

    // ---- URL uniqueness guard --------------------------------------------
    // One url_path per project may be owned by at most one non-rejected page.
    // Ties are resolved deterministically: higher demand wins, then the
    // structurally more specific page type.
    const TYPE_RANK: Record<string, number> = {
      hub: 6, category: 5, product: 4, service: 3, local: 2, informational: 1, article: 0,
    };
    const byUrl = new Map<string, RegistryRow[]>();
    for (const r of rows) {
      if (r.decision === "rejected") continue;
      byUrl.set(r.url_path, [...(byUrl.get(r.url_path) || []), r]);
    }
    for (const [, group] of byUrl) {
      if (group.length < 2) continue;
      const DEC_RANK: Record<string, number> = { approved: 3, candidate: 2, review: 1 };
      group.sort((a, b) =>
        ((DEC_RANK[b.decision] || 0) - (DEC_RANK[a.decision] || 0))
        || (b.demand_score - a.demand_score)
        || ((TYPE_RANK[b.page_type] || 0) - (TYPE_RANK[a.page_type] || 0))
        || a.entity_id.localeCompare(b.entity_id));
      for (const loser of group.slice(1)) {
        loser.decision = "rejected";
        loser.status = "rejected";
        loser.reason = "URL_CONFLICT";
        loser.duplicate_score = Math.max(loser.duplicate_score, 100);
      }
    }

    const summary = {
      total: rows.length,
      candidate: rows.filter((r) => r.decision === "candidate").length,
      approved: rows.filter((r) => r.decision === "approved").length,
      review: rows.filter((r) => r.decision === "review").length,
      rejected: rows.filter((r) => r.decision === "rejected").length,
      by_type: ["hub", "category", "product", "service", "informational", "local", "article"].reduce((acc, t) => {
        acc[t] = rows.filter((r) => r.page_type === t).length;
        return acc;
      }, {} as Record<string, number>),
      with_offer: rows.filter((r) => r.has_offer).length,
      by_reason: rows.reduce((acc, r) => {
        acc[r.reason] = (acc[r.reason] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };

    if (dryRun) {
      return jsonResponse({ ok: true, dry_run: true, summary, rows });
    }

    // Preserve 'published' status for pages already live and still approved.
    const { data: existing } = await admin.from("page_registry")
      .select("entity_type, entity_id, status, published_at")
      .eq("project_id", projectId);
    const prev = new Map((existing || []).map((e: any) => [`${e.entity_type}:${e.entity_id}`, e]));

    const payload = rows.map((r) => {
      const p = prev.get(`${r.entity_type}:${r.entity_id}`);
      const keepPublished = p?.status === "published" && r.decision === "approved";
      return { ...r, status: keepPublished ? "published" : r.status };
    });

    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.slice(i, i + 500);
      const { error } = await admin.from("page_registry")
        .upsert(chunk, { onConflict: "project_id,entity_type,entity_id" });
      if (error) throw new Error(`registry upsert failed: ${error.message}`);
    }

    const logRows = rows.map((r) => ({
      project_id: projectId,
      entity_id: r.entity_id,
      entity_type: r.entity_type,
      cluster_id: r.entity_type === "category" || r.entity_type === "service" ? r.entity_id : null,
      page_type: r.page_type,
      intent: r.intent,
      demand_score: r.demand_score,
      semantic_score: r.semantic_score,
      product_count: r.product_count,
      duplicate_score: r.duplicate_score,
      decision: r.decision,
      reason: r.reason,
    }));
    for (let i = 0; i < logRows.length; i += 500) {
      await admin.from("page_decision_log").insert(logRows.slice(i, i + 500));
    }

    return jsonResponse({ ok: true, dry_run: false, summary, rows });
  } catch (e) {
    return errorResponse((e as Error).message || "PDE failed", 500);
  }
});
