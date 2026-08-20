// P10 - Commercial / Page Quality Engine runner.
//
//   PDE -> PAGE REGISTRY -> [QUALITY PROFILE] -> CONTENT -> QA -> BUILD
//
// Reads the existing page_registry plus the entity rows it points at and
// writes the quality state back onto the SAME registry rows. No new entity
// system, no LLM, no content generation, no deploy.
//
// Body: { project_id, dry_run?, include_rejected?, registry_rows? }
// `registry_rows` lets a PDE dry-run be piped straight into the quality layer
// without persisting anything (used for read-only E2E checks).

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import {
  checkPageQuality, contentRequirements, qualityToAuditIssues,
  QUALITY_THRESHOLDS, type QualityInput, type QualityReport,
} from "../_shared/pageQuality.ts";
import type { PdeIntent, PdePageType } from "../_shared/pageDecision.ts";

const asArr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.project_id || "");
    const dryRun = body?.dry_run === true;
    const includeRejected = body?.include_rejected === true;
    if (!projectId) return errorResponse("project_id is required", 400);

    const admin = adminClient();

    const { data: project } = await admin.from("projects")
      .select("id, user_id, company_name, company_phone, company_email, company_address, work_hours, region, site_contacts, author_name, business_pages")
      .eq("id", projectId).maybeSingle();
    if (!project) return errorResponse("project not found", 404);
    if (project.user_id !== auth.userId) {
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: auth.userId, _role: "admin" });
      if (!isAdmin) return errorResponse("forbidden", 403);
    }

    const pages = asArr<string>(project.business_pages).map((p) => String(p).toLowerCase());
    const contactsBlob = `${project.site_contacts || ""} ${pages.join(" ")}`.toLowerCase();
    const qProject = {
      companyName: s(project.company_name),
      phone: s(project.company_phone),
      email: s(project.company_email),
      address: s(project.company_address),
      workHours: s(project.work_hours),
      region: s(project.region),
      contacts: s(project.site_contacts),
      deliveryInfo: /достав|shipping|delivery/.test(contactsBlob),
      paymentInfo: /оплат|payment/.test(contactsBlob),
      warrantyInfo: /гарант|возврат|warranty|return/.test(contactsBlob),
      authorName: s(project.author_name),
      businessPages: pages,
    };

    const [regRes, silosRes, clustersRes, productsRes, articlesRes, keywordsRes, linksRes] = await Promise.all([
      admin.from("page_registry")
        .select("id, entity_type, entity_id, page_type, url_path, intent, demand_score, semantic_score, product_count, keyword_count, decision, status, has_offer, title")
        .eq("project_id", projectId),
      admin.from("site_silos").select("id, name, description, seo_content").eq("project_id", projectId),
      admin.from("site_clusters").select("id, silo_id, parent_id, name, description, seo_content").eq("project_id", projectId),
      admin.from("site_products").select("id, site_cluster_id, silo_id, name, sku, brand, price, currency, availability, description, characteristics, images, benefits, region, kind, seo_content").eq("project_id", projectId).limit(5000),
      admin.from("articles").select("id, title, content, meta_description, main_keyword, created_at, updated_at, author_profile_id").eq("project_id", projectId).limit(2000),
      admin.from("site_keywords").select("id, silo_id, site_cluster_id, target_id").eq("project_id", projectId).limit(5000),
      admin.from("internal_links").select("from_path, to_path, to_kind").eq("project_id", projectId).limit(20000),
    ]);

    const injected = Array.isArray(body?.registry_rows) ? (body.registry_rows as any[]) : null;
    const registry = injected && injected.length ? injected : ((regRes.data || []) as any[]);
    if (!registry.length) return errorResponse("page_registry_empty: run the Page Decision Engine first", 409);

    const silos = (silosRes.data || []) as any[];
    const clusters = (clustersRes.data || []) as any[];
    const products = (productsRes.data || []) as any[];
    const articles = (articlesRes.data || []) as any[];
    const keywords = (keywordsRes.data || []) as any[];
    const links = (linksRes.data || []) as any[];

    const siloById = new Map(silos.map((x) => [x.id, x]));
    const clusterById = new Map(clusters.map((x) => [x.id, x]));
    const productById = new Map(products.map((x) => [x.id, x]));
    const articleById = new Map(articles.map((x) => [x.id, x]));

    const childrenOfSilo = new Map<string, number>();
    const childrenOfCluster = new Map<string, number>();
    for (const c of clusters) {
      childrenOfSilo.set(c.silo_id, (childrenOfSilo.get(c.silo_id) || 0) + 1);
      if (c.parent_id) childrenOfCluster.set(c.parent_id, (childrenOfCluster.get(c.parent_id) || 0) + 1);
    }
    const prodOfCluster = new Map<string, any[]>();
    const prodOfSilo = new Map<string, any[]>();
    for (const p of products) {
      if (p.site_cluster_id) prodOfCluster.set(p.site_cluster_id, [...(prodOfCluster.get(p.site_cluster_id) || []), p]);
      if (p.silo_id) prodOfSilo.set(p.silo_id, [...(prodOfSilo.get(p.silo_id) || []), p]);
    }
    const kwOfCluster = new Map<string, number>();
    const kwOfSilo = new Map<string, number>();
    const kwOfTarget = new Map<string, number>();
    for (const k of keywords) {
      if (k.site_cluster_id) kwOfCluster.set(k.site_cluster_id, (kwOfCluster.get(k.site_cluster_id) || 0) + 1);
      if (k.silo_id) kwOfSilo.set(k.silo_id, (kwOfSilo.get(k.silo_id) || 0) + 1);
      if (k.target_id) kwOfTarget.set(k.target_id, (kwOfTarget.get(k.target_id) || 0) + 1);
    }
    const outPages = new Map<string, number>();
    const outArticles = new Map<string, number>();
    for (const l of links) {
      const from = String(l.from_path || "");
      if (!from) continue;
      if (String(l.to_kind || "") === "article" || String(l.to_path || "").startsWith("/posts/")) {
        outArticles.set(from, (outArticles.get(from) || 0) + 1);
      } else {
        outPages.set(from, (outPages.get(from) || 0) + 1);
      }
    }

    const scope = registry.filter((r) =>
      includeRejected || ["approved", "review", "candidate", "published"].includes(String(r.status)));

    const results: any[] = [];
    const auditIssues: any[] = [];

    for (const r of scope) {
      const pageType = String(r.page_type) as PdePageType;
      let content: any = null;
      const entity: QualityInput["entity"] = {};
      let children = 0;
      let prods = 0;
      let servs = 0;
      let kw = Number(r.keyword_count) || 0;

      if (r.entity_type === "hub") {
        const e = siloById.get(r.entity_id);
        content = e?.seo_content || null;
        children = childrenOfSilo.get(r.entity_id) || 0;
        const list = prodOfSilo.get(r.entity_id) || [];
        prods = list.filter((p: any) => p.kind !== "service").length;
        servs = list.filter((p: any) => p.kind === "service").length;
        kw = kw || (kwOfSilo.get(r.entity_id) || 0);
      } else if (r.entity_type === "category" || r.entity_type === "service" || r.entity_type === "local") {
        const e = clusterById.get(r.entity_id) || productById.get(r.entity_id);
        content = e?.seo_content || null;
        if (clusterById.has(r.entity_id)) {
          children = childrenOfCluster.get(r.entity_id) || 0;
          const list = prodOfCluster.get(r.entity_id) || [];
          prods = list.filter((p: any) => p.kind !== "service").length;
          servs = list.filter((p: any) => p.kind === "service").length;
          kw = kw || (kwOfCluster.get(r.entity_id) || 0);
        } else if (e) {
          Object.assign(entity, {
            price: e.price, currency: e.currency, availability: e.availability, sku: e.sku,
            brand: e.brand, characteristics: e.characteristics, images: e.images,
            benefits: e.benefits, description: e.description, region: e.region,
          });
          servs = 1;
        }
      } else if (r.entity_type === "product") {
        const e = productById.get(r.entity_id);
        content = e?.seo_content || null;
        if (e) {
          Object.assign(entity, {
            price: e.price, currency: e.currency, availability: e.availability, sku: e.sku,
            brand: e.brand, characteristics: e.characteristics, images: e.images,
            benefits: e.benefits, description: e.description, region: e.region,
          });
          prods = 1;
          kw = kw || (kwOfTarget.get(r.entity_id) || 0);
        }
      } else if (r.entity_type === "article") {
        const a = articleById.get(r.entity_id);
        if (a) {
          content = {
            h1: a.title, seo_title: a.title, seo_description: a.meta_description,
            intro: String(a.content || "").replace(/<[^>]+>/g, " ").slice(0, 400),
            body: String(a.content || "").split(/<h2[^>]*>/i).slice(1).map((chunk: string) => ({
              heading: chunk.split(/<\/h2>/i)[0]?.replace(/<[^>]+>/g, "").trim() || "",
              text: chunk.split(/<\/h2>/i)[1]?.replace(/<[^>]+>/g, " ").trim() || "",
            })),
            faq: [], entities: [], semantic_terms: [], schema_data: { "@type": "Article" },
          };
          entity.author = a.author_profile_id ? "author" : null;
          entity.publishedAt = a.created_at || null;
          entity.updatedAt = a.updated_at || null;
        }
      }

      const input: QualityInput = {
        pageType,
        intent: String(r.intent || "unknown") as PdeIntent,
        title: String(r.title || ""),
        urlPath: String(r.url_path || ""),
        hasOffer: !!r.has_offer,
        demandScore: Number(r.demand_score) || 0,
        semanticScore: Number(r.semantic_score) || 0,
        hasBreadcrumbs: String(r.url_path || "").split("/").filter(Boolean).length > 1,
        content,
        entity,
        project: qProject,
        counts: {
          products: prods,
          services: servs,
          children,
          keywords: kw,
          relatedPages: outPages.get(String(r.url_path)) || 0,
          relatedArticles: outArticles.get(String(r.url_path)) || 0,
          siblings: 0,
        },
      };

      const report: QualityReport = checkPageQuality(input);
      auditIssues.push(...qualityToAuditIssues(String(r.url_path), report));
      results.push({
        id: r.id,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        title: r.title,
        url_path: r.url_path,
        page_type: pageType,
        intent: r.intent,
        decision: r.decision,
        status: r.status,
        demand_score: r.demand_score,
        quality_status: report.quality_status,
        commercial_score: report.commercial_score,
        seo_quality_score: report.seo_score,
        quality_errors: report.missing_required,
        quality_warnings: report.warnings,
        quality_factors: report.factors,
        missing_recommended: report.missing_recommended,
      });
    }

    const count = (fn: (x: any) => boolean) => results.filter(fn).length;
    const types = ["product", "category", "service", "informational", "local", "hub", "article"];
    const summary = {
      total: results.length,
      pass: count((x) => x.quality_status === "PASS"),
      review: count((x) => x.quality_status === "REVIEW"),
      fail: count((x) => x.quality_status === "FAIL"),
      avg_commercial_score: results.length
        ? Math.round(results.reduce((s2, x) => s2 + x.commercial_score, 0) / results.length) : 0,
      thresholds: QUALITY_THRESHOLDS,
      by_type: types.reduce((acc, t) => {
        const rows = results.filter((x) => x.page_type === t);
        acc[t] = {
          total: rows.length,
          pass: rows.filter((x) => x.quality_status === "PASS").length,
          review: rows.filter((x) => x.quality_status === "REVIEW").length,
          fail: rows.filter((x) => x.quality_status === "FAIL").length,
          avg_score: rows.length ? Math.round(rows.reduce((s2, x) => s2 + x.commercial_score, 0) / rows.length) : 0,
        };
        return acc;
      }, {} as Record<string, unknown>),
      score_distribution: [0, 20, 40, 60, 80].map((lo) => ({
        bucket: `${lo}-${lo + 19}`,
        count: results.filter((x) => x.commercial_score >= lo && x.commercial_score < lo + 20).length,
      })).concat([{ bucket: "100", count: results.filter((x) => x.commercial_score === 100).length }]),
      top_missing_required: Object.entries(
        results.flatMap((x) => x.quality_errors as string[])
          .reduce((acc: Record<string, number>, k) => { acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
      ).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 15),
      qa_issues: {
        critical: auditIssues.filter((i) => i.level === "critical").length,
        warning: auditIssues.filter((i) => i.level === "warning").length,
        info: auditIssues.filter((i) => i.level === "info").length,
      },
    };

    const worst = [...results]
      .sort((a, b) => a.commercial_score - b.commercial_score || b.quality_errors.length - a.quality_errors.length)
      .slice(0, 10)
      .map((x) => ({
        title: x.title, url_path: x.url_path, page_type: x.page_type,
        commercial_score: x.commercial_score, quality_status: x.quality_status,
        missing_required: x.quality_errors,
      }));

    const contract = types.reduce((acc, t) => {
      acc[t] = contentRequirements(t as PdePageType);
      return acc;
    }, {} as Record<string, unknown>);

    if (dryRun || injected) {
      return jsonResponse({
        ok: true, dry_run: true, summary, worst, content_contract: contract,
        rows: results.map(({ quality_factors, ...rest }) => rest),
      });
    }

    const now = new Date().toISOString();
    for (let i = 0; i < results.length; i += 300) {
      const chunk = results.slice(i, i + 300);
      await Promise.all(chunk.map((x) =>
        admin.from("page_registry").update({
          quality_status: x.quality_status,
          commercial_score: x.commercial_score,
          seo_quality_score: x.seo_quality_score,
          quality_checked_at: now,
          quality_errors: x.quality_errors,
          quality_warnings: x.quality_warnings,
          quality_factors: x.quality_factors,
        }).eq("id", x.id)));
    }

    return jsonResponse({ ok: true, dry_run: false, summary, worst, content_contract: contract });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "quality engine failed", 500);
  }
});
