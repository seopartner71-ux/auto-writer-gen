// P22 - AI Visibility & Performance Center.
//
// READ-ONLY analytics layer over P1-P21. It never mutates registry, content,
// SEO, media, visual or build data. The only writes it performs are into its
// own analytics table project_score_history (score snapshots).
//
// Actions:
//   overview  - dashboard scores, GEO breakdown, index status, SILO map,
//               opportunities, published urls
//   snapshot  - store the current scores in project_score_history
//   timeline  - score history rows (per release)
//   compare   - two snapshots side by side

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";

type Sb = ReturnType<typeof adminClient>;

const isFilled = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
};
const txt = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const pct = (passed: number, total: number) =>
  total <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((passed / total) * 100)));
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

interface Opportunity {
  group: "seo" | "geo" | "commercial" | "media";
  key: string;
  count: number;
  impact: "high" | "medium" | "low";
  /** Engine the "fix automatically" button must call. */
  engine: "seo-engine" | "commercial-engine" | "media-engine" | "commerce-content" | "blog-engine";
  /** Wizard step to open when there is no automatic fix. */
  step: number;
  affected: string[];
  label_ru: string;
  label_en: string;
}

interface SiloNode {
  id: string;
  url_path: string;
  page_type: string;
  title: string;
  parent: string | null;
  status: "PASS" | "REVIEW" | "FAIL";
  seo_score: number;
  visual_score: number;
  indexed: boolean;
}

async function collect(sb: Sb, projectId: string, userId: string) {
  const [
    { data: registryRows },
    { data: seoRows },
    { data: visualRows },
    { data: mediaRows },
    { data: productRows },
    { data: blockRows },
    { data: indexRows },
    { data: releaseRows },
    { data: visibilityRows },
    { data: clusterRows },
  ] = await Promise.all([
    sb.from("page_registry")
      .select("id, url_path, page_type, decision, status, is_system, indexable, entity_id, entity_type, title, commercial_score, seo_quality_score, quality_status")
      .eq("project_id", projectId).limit(10000),
    sb.from("page_seo")
      .select("registry_id, url_path, page_type, title, meta_description, h1, canonical, schema_json, faq, robots, generated_at")
      .eq("project_id", projectId).limit(10000),
    sb.from("page_visual_config").select("registry_id, visual_score, visual_status")
      .eq("project_id", projectId).limit(10000),
    sb.from("image_assets").select("entity_type, entity_id, registry_id, image_type, image_url, alt, status")
      .eq("project_id", projectId).limit(30000),
    sb.from("site_products").select("id, name, kind, status, images, description, seo_content, url_path")
      .eq("project_id", projectId).limit(10000),
    sb.from("page_commercial_blocks").select("registry_id, block_type, content, status")
      .eq("project_id", projectId).limit(20000),
    sb.from("indexing_logs").select("url, provider, status, created_at")
      .eq("project_id", projectId).limit(20000),
    sb.from("site_releases").select("id, version, pages, published_url, status, is_current, created_at")
      .eq("project_id", projectId).order("created_at", { ascending: false }).limit(50),
    sb.from("ai_visibility").select("query, entity, model, mentioned, position, cited, confidence, checked_at")
      .eq("project_id", projectId).order("checked_at", { ascending: false }).limit(500),
    sb.from("topic_clusters").select("id, name, authority_score, keywords_count, commercial_pages_count")
      .eq("project_id", projectId).limit(500),
  ]);

  return {
    registry: (registryRows || []) as Record<string, unknown>[],
    seo: (seoRows || []) as Record<string, unknown>[],
    visual: (visualRows || []) as Record<string, unknown>[],
    media: (mediaRows || []) as Record<string, unknown>[],
    products: (productRows || []) as Record<string, unknown>[],
    blocks: (blockRows || []) as Record<string, unknown>[],
    indexing: (indexRows || []) as Record<string, unknown>[],
    releases: (releaseRows || []) as Record<string, unknown>[],
    visibility: (visibilityRows || []) as Record<string, unknown>[],
    clusters: (clusterRows || []) as Record<string, unknown>[],
    userId,
  };
}

function buildOverview(project: Record<string, unknown>, d: Awaited<ReturnType<typeof collect>>) {
  const active = d.registry.filter((r) =>
    r.is_system === true || r.decision === "approved" || (r.decision !== "rejected" && r.status === "published"));
  const contentPages = active.filter((r) => r.is_system !== true);

  const seoByReg = new Map<string, Record<string, unknown>>();
  for (const s of d.seo) seoByReg.set(String(s.registry_id), s);
  const visualByReg = new Map<string, Record<string, unknown>>();
  for (const v of d.visual) visualByReg.set(String(v.registry_id), v);
  const blocksByReg = new Map<string, Set<string>>();
  for (const b of d.blocks) {
    if (!isFilled(b.content)) continue;
    const k = String(b.registry_id);
    if (!blocksByReg.has(k)) blocksByReg.set(k, new Set());
    blocksByReg.get(k)!.add(txt(b.block_type));
  }
  const mediaByEntity = new Map<string, Record<string, unknown>[]>();
  const mediaByReg = new Map<string, Record<string, unknown>[]>();
  for (const a of d.media) {
    if (txt(a.status) !== "ready" || !isFilled(a.image_url)) continue;
    const ek = `${txt(a.entity_type)}:${txt(a.entity_id)}`;
    mediaByEntity.set(ek, [...(mediaByEntity.get(ek) || []), a]);
    if (a.registry_id) mediaByReg.set(String(a.registry_id), [...(mediaByReg.get(String(a.registry_id)) || []), a]);
  }

  // ------------------------------------------------------------- SEO score --
  let seoPassed = 0;
  let seoTotal = 0;
  const noTitle: string[] = [], noDesc: string[] = [], weakTitle: string[] = [], noSchema: string[] = [], noFaq: string[] = [];
  for (const r of active) {
    const s = seoByReg.get(String(r.id));
    const title = txt(s?.title);
    const checks = [
      isFilled(title),
      isFilled(s?.meta_description),
      isFilled(s?.h1),
      isFilled(s?.schema_json),
      title.length >= 25 && title.length <= 65,
    ];
    seoTotal += checks.length;
    seoPassed += checks.filter(Boolean).length;
    if (!isFilled(title)) noTitle.push(String(r.id));
    else if (title.length < 25 || title.length > 65) weakTitle.push(String(r.id));
    if (!isFilled(s?.meta_description)) noDesc.push(String(r.id));
    if (!isFilled(s?.schema_json)) noSchema.push(String(r.id));
    if (!isFilled(s?.faq)) noFaq.push(String(r.id));
  }
  const seoScore = pct(seoPassed, seoTotal);

  // ---------------------------------------------------------- Visual score --
  const visualScores = active.map((r) => Number(visualByReg.get(String(r.id))?.visual_score || 0)).filter((n) => n > 0);
  const visualScore = visualScores.length
    ? clamp(visualScores.reduce((a, b) => a + b, 0) / visualScores.length) : 0;
  const visualWeak = active.filter((r) => Number(visualByReg.get(String(r.id))?.visual_score || 0) < 80).map((r) => String(r.id));

  // ----------------------------------------------------------- Media score --
  const liveProducts = d.products.filter((p) => txt(p.status || "active") !== "archived");
  const noPhoto: string[] = [];
  let mediaPassed = 0, mediaTotal = 0;
  for (const p of liveProducts) {
    mediaTotal++;
    const kind = txt(p.kind) === "service" ? "service" : "product";
    const has = isFilled(p.images) || (mediaByEntity.get(`${kind}:${txt(p.id)}`) || []).length > 0;
    if (has) mediaPassed++; else noPhoto.push(String(p.id));
  }
  const noCover: string[] = [];
  for (const r of contentPages) {
    if (!["category", "hub", "silo", "article", "blog"].includes(txt(r.page_type))) continue;
    mediaTotal++;
    const has = (mediaByReg.get(String(r.id)) || []).length > 0
      || (mediaByEntity.get(`${txt(r.entity_type)}:${txt(r.entity_id)}`) || []).length > 0;
    if (has) mediaPassed++; else noCover.push(String(r.id));
  }
  const badAlt = d.media.filter((a) => txt(a.status) === "ready" && txt(a.alt).trim().length < 10);
  const mediaScore = mediaTotal ? pct(mediaPassed, mediaTotal) : 0;

  // ------------------------------------------------------ Commercial score --
  const TRUST = ["trust", "advantages", "delivery", "warranty", "payment", "cta"];
  const commercialTargets = contentPages.filter((r) => ["product", "service", "category", "hub", "silo", "home"].includes(txt(r.page_type)));
  let comPassed = 0, comTotal = 0;
  const noAdvantages: string[] = [], noTrust: string[] = [], noCta: string[] = [];
  for (const r of commercialTargets) {
    const set = blocksByReg.get(String(r.id)) || new Set<string>();
    comTotal += TRUST.length;
    comPassed += TRUST.filter((t) => set.has(t)).length;
    if (!set.has("advantages")) noAdvantages.push(String(r.id));
    if (!set.has("trust")) noTrust.push(String(r.id));
    if (!set.has("cta")) noCta.push(String(r.id));
  }
  const commercialScore = comTotal ? pct(comPassed, comTotal) : 0;

  // --------------------------------------------------------- Content score --
  let contentPassed = 0, contentTotal = 0;
  const weakCoverage: string[] = [];
  for (const p of liveProducts) {
    const seo = (p.seo_content || {}) as Record<string, unknown>;
    const checks = [isFilled(p.description) || isFilled(seo.intro), isFilled(seo.body), isFilled(seo.faq)];
    contentTotal += checks.length;
    contentPassed += checks.filter(Boolean).length;
    if (checks.filter(Boolean).length < 2) weakCoverage.push(String(p.id));
  }
  const contentScore = contentTotal ? pct(contentPassed, contentTotal) : 0;

  // ------------------------------------------------------------ GEO score ---
  // Entity Authority 25 / Citation 20 / Semantic Coverage 20 /
  // Content Quality 15 / Structured Data 10 / Freshness 10
  const profile = (project.commercial_profile || {}) as Record<string, unknown>;
  const entityFields = [
    project.company_name, project.company_phone, project.company_email, project.company_address,
    project.work_hours, project.founding_year, project.juridical_inn, project.site_about,
    profile.usp, profile.geography,
  ];
  const entityFilled = entityFields.filter(isFilled).length;
  const localBusiness = d.seo.some((s) => txt(s.schema_json).includes("LocalBusiness")
    || txt(s.schema_json).includes("Organization"));
  const entityAuthority = clamp(pct(entityFilled, entityFields.length) * 0.85 + (localBusiness ? 15 : 0));

  const vis = d.visibility;
  const visByQuery = new Map<string, Record<string, unknown>[]>();
  for (const v of vis) {
    const k = `${txt(v.query)}|${txt(v.model)}`;
    if (!visByQuery.has(k)) visByQuery.set(k, [v]);
  }
  const latestVis = Array.from(visByQuery.values()).map((a) => a[0]);
  const citation = latestVis.length
    ? clamp((latestVis.filter((v) => v.mentioned === true).length / latestVis.length) * 70
      + (latestVis.filter((v) => v.cited === true).length / latestVis.length) * 30)
    : 0;

  const clusterCovered = d.clusters.filter((c) => Number(c.commercial_pages_count || 0) > 0).length;
  const semanticCoverage = d.clusters.length
    ? clamp(pct(clusterCovered, d.clusters.length) * 0.6 + pct(contentPages.length ? 1 : 0, 1) * 0)
      || pct(clusterCovered, d.clusters.length)
    : clamp(pct(contentPages.filter((r) => isFilled(seoByReg.get(String(r.id))?.h1)).length, Math.max(1, contentPages.length)));
  const faqCoverage = pct(active.length - noFaq.length, Math.max(1, active.length));
  const contentQuality = clamp((contentScore * 0.6) + (faqCoverage * 0.4));
  const structuredData = pct(active.length - noSchema.length, Math.max(1, active.length));

  const now = Date.now();
  const fresh = d.seo.filter((s) => {
    const t = Date.parse(txt(s.generated_at) || "");
    return Number.isFinite(t) && now - t < 90 * 864e5;
  }).length;
  const freshness = pct(fresh, Math.max(1, d.seo.length));

  const geoParts = [
    { key: "entity_authority", weight: 25, value: entityAuthority, label_ru: "Авторитет сущности", label_en: "Entity authority" },
    { key: "citation", weight: 20, value: citation, label_ru: "Цитируемость в AI", label_en: "AI citation" },
    { key: "semantic_coverage", weight: 20, value: semanticCoverage, label_ru: "Семантическое покрытие", label_en: "Semantic coverage" },
    { key: "content_quality", weight: 15, value: contentQuality, label_ru: "Качество контента", label_en: "Content quality" },
    { key: "structured_data", weight: 10, value: structuredData, label_ru: "Структурированные данные", label_en: "Structured data" },
    { key: "freshness", weight: 10, value: freshness, label_ru: "Свежесть", label_en: "Freshness" },
  ].map((p) => ({ ...p, points: Math.round((p.value * p.weight) / 100) }));
  const geoScore = clamp(geoParts.reduce((a, p) => a + p.points, 0));

  // ------------------------------------------------------------- Indexing ---
  const indexableUrls = active.filter((r) => r.indexable !== false).map((r) => txt(r.url_path));
  const submitted = new Set<string>();
  const indexed = new Set<string>();
  for (const row of d.indexing) {
    const url = txt(row.url);
    const path = url.replace(/^https?:\/\/[^/]+/i, "") || "/";
    submitted.add(path);
    const st = txt(row.status).toLowerCase();
    if (["indexed", "success", "ok", "submitted_ok"].includes(st)) indexed.add(path);
  }
  const indexStatus = {
    total: indexableUrls.length,
    submitted: indexableUrls.filter((u) => submitted.has(u)).length,
    indexed: indexableUrls.filter((u) => indexed.has(u)).length,
    pending: indexableUrls.filter((u) => !indexed.has(u)).length,
  };

  // ------------------------------------------------------------ SILO map ----
  const byPath = new Map<string, Record<string, unknown>>();
  for (const r of active) byPath.set(txt(r.url_path), r);
  const parentOf = (path: string): string | null => {
    const parts = path.split("/").filter(Boolean);
    while (parts.length > 1) {
      parts.pop();
      const candidate = `/${parts.join("/")}`;
      if (byPath.has(candidate)) return String(byPath.get(candidate)!.id);
      if (byPath.has(`${candidate}/`)) return String(byPath.get(`${candidate}/`)!.id);
    }
    return null;
  };
  const siloMap: SiloNode[] = active.slice(0, 1200).map((r) => {
    const s = seoByReg.get(String(r.id));
    const okSeo = isFilled(s?.title) && isFilled(s?.meta_description) && isFilled(s?.h1);
    const vScore = Number(visualByReg.get(String(r.id))?.visual_score || 0);
    const path = txt(r.url_path);
    const status: SiloNode["status"] = !okSeo ? "FAIL" : (!isFilled(s?.schema_json) || vScore < 80) ? "REVIEW" : "PASS";
    return {
      id: String(r.id),
      url_path: path,
      page_type: txt(r.page_type),
      title: txt(s?.title || r.title || path),
      parent: parentOf(path),
      status,
      seo_score: okSeo ? 100 : 40,
      visual_score: vScore,
      indexed: indexed.has(path),
    };
  });

  // -------------------------------------------------------- Opportunities ---
  const opportunities: Opportunity[] = [];
  const add = (o: Opportunity) => { if (o.count > 0) opportunities.push({ ...o, affected: o.affected.slice(0, 500) }); };
  add({ group: "seo", key: "no_description", count: noDesc.length, impact: "high", engine: "seo-engine", step: 5,
    affected: noDesc, label_ru: "Страниц без description", label_en: "Pages without a description" });
  add({ group: "seo", key: "weak_title", count: weakTitle.length, impact: "medium", engine: "seo-engine", step: 5,
    affected: weakTitle, label_ru: "Слабый title (короткий или длиннее 65)", label_en: "Weak title (too short or over 65)" });
  add({ group: "seo", key: "no_title", count: noTitle.length, impact: "high", engine: "seo-engine", step: 5,
    affected: noTitle, label_ru: "Страниц без title", label_en: "Pages without a title" });
  add({ group: "geo", key: "no_schema", count: noSchema.length, impact: "high", engine: "seo-engine", step: 5,
    affected: noSchema, label_ru: "Нет структурированных данных", label_en: "No structured data" });
  add({ group: "geo", key: "no_faq", count: noFaq.length, impact: "medium", engine: "seo-engine", step: 5,
    affected: noFaq, label_ru: "Мало FAQ для AI-ответов", label_en: "Not enough FAQ for AI answers" });
  add({ group: "geo", key: "weak_entity", count: entityAuthority < 80 ? 1 : 0, impact: "high", engine: "seo-engine", step: 1,
    affected: [], label_ru: "Слабая сущность бренда - заполните профиль компании", label_en: "Weak brand entity - fill the company profile" });
  add({ group: "geo", key: "no_citation", count: latestVis.length === 0 ? 1 : latestVis.filter((v) => v.mentioned !== true).length,
    impact: "medium", engine: "seo-engine", step: 11, affected: [],
    label_ru: "Нет цитирования в AI-ассистентах", label_en: "No citation in AI assistants" });
  add({ group: "commercial", key: "no_advantages", count: noAdvantages.length, impact: "high", engine: "commercial-engine", step: 6,
    affected: noAdvantages, label_ru: "Страниц без блока преимуществ", label_en: "Pages without an advantages block" });
  add({ group: "commercial", key: "no_trust", count: noTrust.length, impact: "high", engine: "commercial-engine", step: 6,
    affected: noTrust, label_ru: "Страниц без блока доверия", label_en: "Pages without a trust block" });
  add({ group: "commercial", key: "weak_cta", count: noCta.length, impact: "medium", engine: "commercial-engine", step: 6,
    affected: noCta, label_ru: "Страниц без CTA", label_en: "Pages without a CTA" });
  add({ group: "media", key: "no_photo", count: noPhoto.length, impact: "high", engine: "media-engine", step: 6,
    affected: noPhoto, label_ru: "Товаров без фото", label_en: "Products without a photo" });
  add({ group: "media", key: "no_cover", count: noCover.length, impact: "medium", engine: "media-engine", step: 6,
    affected: noCover, label_ru: "Разделов без обложки", label_en: "Sections without a cover" });
  add({ group: "media", key: "weak_alt", count: badAlt.length, impact: "low", engine: "media-engine", step: 6,
    affected: [], label_ru: "Изображений со слабым ALT", label_en: "Images with a weak ALT" });
  add({ group: "seo", key: "weak_coverage", count: weakCoverage.length, impact: "medium", engine: "commerce-content", step: 5,
    affected: weakCoverage, label_ru: "Низкое покрытие контентом", label_en: "Low content coverage" });

  const qualityScore = clamp((seoScore + geoScore + visualScore + mediaScore + commercialScore + contentScore) / 6);
  const organicReady = seoScore >= 90 && visualScore >= 85 && mediaScore >= 80 && !!project.production_url;

  return {
    scores: {
      seo: seoScore, geo: geoScore, visual: visualScore, media: mediaScore,
      commercial: commercialScore, content: contentScore, quality: qualityScore,
    },
    geo_breakdown: geoParts,
    index_status: indexStatus,
    silo_map: siloMap,
    opportunities: opportunities.sort((a, b) =>
      (b.impact === "high" ? 2 : b.impact === "medium" ? 1 : 0) - (a.impact === "high" ? 2 : a.impact === "medium" ? 1 : 0)),
    stats: {
      pages: active.length,
      content_pages: contentPages.length,
      published_urls: indexableUrls.length,
      products: liveProducts.length,
      images: d.media.filter((a) => txt(a.status) === "ready").length,
      clusters: d.clusters.length,
      organic_ready: organicReady,
    },
    site: {
      production_url: (project.production_url as string) || (project.deployment_url as string) || null,
      published_at: (project.published_at as string) || null,
      name: txt(project.name),
      domain: txt(project.custom_domain || project.domain),
    },
    releases: d.releases,
    ai_visibility: latestVis,
  };
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.project_id || "");
    const action = String(body?.action || "overview");
    if (!projectId) return errorResponse("project_id required", 400);

    const sb = adminClient();
    const { data: projectRow } = await sb.from("projects")
      .select("id, user_id, name, domain, custom_domain, language, production_url, deployment_url, published_at, " +
        "company_name, company_phone, company_email, company_address, work_hours, founding_year, juridical_inn, " +
        "site_about, commercial_profile")
      .eq("id", projectId).maybeSingle();
    if (!projectRow) return errorResponse("Project not found", 404);
    const project = projectRow as Record<string, unknown>;
    if (project.user_id !== auth.userId) return errorResponse("Forbidden", 403);

    if (action === "timeline") {
      const { data } = await sb.from("project_score_history")
        .select("*").eq("project_id", projectId).order("created_at", { ascending: true }).limit(100);
      return jsonResponse({ timeline: data || [] });
    }

    if (action === "compare") {
      const ids = (body?.snapshot_ids as string[] | undefined) || [];
      const { data } = await sb.from("project_score_history")
        .select("*").eq("project_id", projectId).in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      return jsonResponse({ snapshots: data || [] });
    }

    const data = await collect(sb, projectId, auth.userId);
    const overview = buildOverview(project, data);

    if (action === "snapshot") {
      const current = data.releases.find((r) => r.is_current === true) || data.releases[0] || null;
      const { data: inserted } = await sb.from("project_score_history").insert({
        project_id: projectId,
        user_id: auth.userId,
        release_id: current ? current.id : null,
        version: current ? txt(current.version) : null,
        seo_score: overview.scores.seo,
        geo_score: overview.scores.geo,
        visual_score: overview.scores.visual,
        media_score: overview.scores.media,
        quality_score: overview.scores.quality,
        content_score: overview.scores.content,
        commercial_score: overview.scores.commercial,
        pages: overview.stats.pages,
        indexed_urls: overview.index_status.indexed,
        snapshot: { geo_breakdown: overview.geo_breakdown, index_status: overview.index_status, stats: overview.stats },
      }).select("*").maybeSingle();
      return jsonResponse({ ...overview, snapshot: inserted || null });
    }

    return jsonResponse(overview);
  } catch (e) {
    console.error("[performance-center] error", e);
    return errorResponse(e instanceof Error ? e.message : "Performance center failed", 500);
  }
});
