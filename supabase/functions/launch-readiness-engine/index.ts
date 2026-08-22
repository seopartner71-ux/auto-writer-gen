// P19 - Launch Readiness Engine.
//
// Read-only verdict layer on top of the existing registry/content/SEO/commercial/
// visual/QA engines. It never generates or mutates content: it reads what those
// engines already produced and answers one question - can this site be launched.
//
// Scores (0-100): seo, content, commercial, visual, technical.
// Verdict: SITE_READY | SITE_NEEDS_FIX | BLOCKED.
//
// Action: { project_id, action?: "readiness" }

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";

const READY_SCORE = 90;
const MIN_VISUAL_SCORE = 90;

type Group = "seo" | "content" | "commercial" | "visual" | "technical" | "blog";

interface Issue {
  group: Group;
  key: string;
  count: number;
  blocking: boolean;
  /** Wizard step index the user should open to fix it. */
  step: number;
  label_ru: string;
  label_en: string;
  samples?: string[];
}

interface ScoreRow {
  group: Group;
  score: number;
  passed: number;
  total: number;
}

const isFilled = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
};

const textOf = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

function pct(passed: number, total: number): number {
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((passed / total) * 100)));
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.project_id || "");
    if (!projectId) return errorResponse("project_id required", 400);

    const sb = adminClient();
    const { data: projectRow } = await sb.from("projects")
      .select("id, user_id, name, domain, custom_domain, custom_domain_status, ssl_status, language, " +
        "company_name, company_phone, company_email, company_address, work_hours, site_contacts, " +
        "commercial_profile, last_qa_report, indexnow_key, production_url, published_at, deployment_status")
      .eq("id", projectId).maybeSingle();
    if (!projectRow) return errorResponse("Project not found", 404);
    const project = projectRow as Record<string, unknown>;
    if (project.user_id !== auth.userId) return errorResponse("Forbidden", 403);

    const [
      { data: registryRows },
      { data: seoRows },
      { data: productRows },
      { data: blockRows },
      { data: visualRows },
      { data: designProfile },
      { data: articleRows },
    ] = await Promise.all([
      sb.from("page_registry")
        .select("id, url_path, page_type, decision, status, is_system, indexable, canonical, entity_id, entity_type")
        .eq("project_id", projectId).limit(10000),
      sb.from("page_seo")
        .select("registry_id, url_path, page_type, title, meta_description, h1, canonical, schema_json, robots, faq")
        .eq("project_id", projectId).limit(10000),
      sb.from("site_products")
        .select("id, name, description, characteristics, price, images, seo_content, kind, status, url_path")
        .eq("project_id", projectId).limit(10000),
      sb.from("page_commercial_blocks")
        .select("registry_id, block_type, content, status").eq("project_id", projectId).limit(10000),
      sb.from("page_visual_config")
        .select("registry_id, visual_score, visual_status").eq("project_id", projectId).limit(10000),
      sb.from("design_profiles").select("id, color_scheme, typography, layout_type").eq("project_id", projectId)
        .limit(1).maybeSingle(),
      sb.from("articles")
        .select("id, title, content, meta_description, status, url_path, created_at, content_updated_at, page_type")
        .eq("project_id", projectId).eq("user_id", auth.userId).limit(5000),
    ]);

    const registry = (registryRows || []) as Record<string, unknown>[];
    const active = registry.filter((r) =>
      r.is_system === true || r.decision === "approved" || (r.decision !== "rejected" && r.status === "published"));
    const contentPages = active.filter((r) => r.is_system !== true);
    const seoByReg = new Map<string, Record<string, unknown>>();
    for (const s of (seoRows || []) as Record<string, unknown>[]) seoByReg.set(String(s.registry_id), s);
    const blocksByReg = new Map<string, Set<string>>();
    for (const b of (blockRows || []) as Record<string, unknown>[]) {
      if (!isFilled(b.content)) continue;
      const key = String(b.registry_id);
      if (!blocksByReg.has(key)) blocksByReg.set(key, new Set());
      blocksByReg.get(key)!.add(String(b.block_type));
    }

    const issues: Issue[] = [];
    const push = (i: Issue) => { if (i.count > 0) issues.push(i); };

    // P18.2 - affected entities per engine, so Auto Fix can target only them.
    const affected = {
      seo: new Set<string>(),        // registry ids
      commercial: new Set<string>(), // registry ids
      content: new Set<string>(),    // entity ids (products / clusters / silos)
      visual: new Set<string>(),     // registry ids
    };

    // ---------------------------------------------------------------- SEO ---
    let seoPassed = 0;
    const seoMissing = { title: 0, description: 0, h1: 0, canonical: 0, schema: 0 };
    const seoSamples: string[] = [];
    for (const r of active) {
      const s = seoByReg.get(String(r.id));
      const okTitle = isFilled(s?.title);
      const okDesc = isFilled(s?.meta_description);
      const okH1 = isFilled(s?.h1);
      const canonical = textOf(s?.canonical || r.canonical);
      const okCanonical = canonical.startsWith("/") || /^https?:\/\//i.test(canonical);
      const okSchema = isFilled(s?.schema_json);
      if (!okTitle) seoMissing.title++;
      if (!okDesc) seoMissing.description++;
      if (!okH1) seoMissing.h1++;
      if (!okCanonical) seoMissing.canonical++;
      if (!okSchema) seoMissing.schema++;
      if (okTitle && okDesc && okH1 && okCanonical && okSchema) seoPassed++;
      else {
        affected.seo.add(String(r.id));
        if (seoSamples.length < 5) seoSamples.push(textOf(r.url_path));
      }
    }
    push({ group: "seo", key: "seo_title", count: seoMissing.title, blocking: true, step: 5,
      label_ru: "Страниц без title", label_en: "Pages without a title", samples: seoSamples });
    push({ group: "seo", key: "seo_description", count: seoMissing.description, blocking: true, step: 5,
      label_ru: "Страниц без description", label_en: "Pages without a description" });
    push({ group: "seo", key: "seo_h1", count: seoMissing.h1, blocking: true, step: 5,
      label_ru: "Страниц без H1", label_en: "Pages without an H1" });
    push({ group: "seo", key: "seo_canonical", count: seoMissing.canonical, blocking: true, step: 5,
      label_ru: "Страниц без корректного canonical", label_en: "Pages without a valid canonical" });
    push({ group: "seo", key: "seo_schema", count: seoMissing.schema, blocking: false, step: 5,
      label_ru: "Страниц без Schema.org", label_en: "Pages without Schema.org" });


    // ------------------------------------------------------------ Content ---
    const products = (productRows || []) as Record<string, unknown>[];
    const liveProducts = products.filter((p) => String(p.status || "active") !== "archived");
    let contentChecks = 0;
    let contentPassed = 0;
    const noPhoto: string[] = [];
    const noPrice: string[] = [];
    const noDescription: string[] = [];
    const noSpecs: string[] = [];

    for (const p of liveProducts) {
      const seo = (p.seo_content || {}) as Record<string, unknown>;
      const hasName = isFilled(p.name);
      const hasDesc = isFilled(p.description) || isFilled(seo.intro) || isFilled(seo.body);
      const hasSpecs = isFilled(p.characteristics);
      const hasPrice = isFilled(p.price) || Number(p.price) > 0;
      const hasPhoto = isFilled(p.images);
      const hasFaq = isFilled(seo.faq);
      contentChecks += 6;
      contentPassed += [hasName, hasDesc, hasSpecs, hasPrice, hasPhoto, hasFaq].filter(Boolean).length;
      if (!hasPhoto && noPhoto.length < 5) noPhoto.push(textOf(p.name));
      if (!hasDesc && noDescription.length < 5) noDescription.push(textOf(p.name));
      if (!hasSpecs && noSpecs.length < 5) noSpecs.push(textOf(p.name));
      if (!hasPrice && noPrice.length < 5) noPrice.push(textOf(p.name));
      if (!hasDesc || !hasFaq) affected.content.add(String(p.id));
    }
    const countMissing = (fn: (p: Record<string, unknown>) => boolean) => liveProducts.filter(fn).length;
    push({ group: "content", key: "product_photo", blocking: false, step: 4,
      count: countMissing((p) => !isFilled(p.images)),
      label_ru: "Товаров без фото", label_en: "Products without a photo", samples: noPhoto });
    push({ group: "content", key: "product_description", blocking: true, step: 5,
      count: countMissing((p) => !isFilled(p.description) && !isFilled((p.seo_content as Record<string, unknown>)?.intro)),
      label_ru: "Товаров без описания", label_en: "Products without a description", samples: noDescription });
    push({ group: "content", key: "product_specs", blocking: false, step: 4,
      count: countMissing((p) => !isFilled(p.characteristics)),
      label_ru: "Товаров без характеристик", label_en: "Products without specs", samples: noSpecs });
    push({ group: "content", key: "product_price", blocking: false, step: 4,
      count: countMissing((p) => !isFilled(p.price)),
      label_ru: "Товаров без цены (будет «цена по запросу»)", label_en: "Products without a price (falls back to on request)",
      samples: noPrice });
    push({ group: "content", key: "product_faq", blocking: false, step: 5,
      count: countMissing((p) => !isFilled((p.seo_content as Record<string, unknown>)?.faq)),
      label_ru: "Товаров без FAQ", label_en: "Products without FAQ" });

    // Category / hub pages: intro + FAQ come from the SEO/content engines.
    const catPages = contentPages.filter((r) => ["category", "hub", "silo", "service"].includes(textOf(r.page_type)));
    let catNoIntro = 0;
    for (const r of catPages) {
      const s = seoByReg.get(String(r.id));
      contentChecks += 2;
      const hasIntro = isFilled(s?.h1) && isFilled(s?.meta_description);
      const hasFaq = isFilled(s?.faq) || (blocksByReg.get(String(r.id))?.has("faq") ?? false);
      contentPassed += [hasIntro, hasFaq].filter(Boolean).length;
      if (!hasIntro) {
        catNoIntro++;
        if (isFilled(r.entity_id)) affected.content.add(String(r.entity_id));
      }
    }
    push({ group: "content", key: "category_intro", count: catNoIntro, blocking: true, step: 5,
      label_ru: "Категорий без вводного текста", label_en: "Categories without an intro" });

    // -------------------------------------------------------- Blog / Article -
    const articles = (articleRows || []) as Record<string, unknown>[];
    const publishable = articles.filter((a) => ["completed", "published"].includes(textOf(a.status)));
    let blogPassed = 0;
    let blogChecks = 0;
    let emptyArticles = 0;
    let noLinks = 0;
    let noFaq = 0;
    const commercialPaths = contentPages
      .filter((r) => ["product", "category", "service", "hub", "silo"].includes(textOf(r.page_type)))
      .map((r) => textOf(r.url_path)).filter(Boolean);
    for (const a of publishable) {
      const content = textOf(a.content);
      const hasBody = content.replace(/<[^>]+>/g, " ").trim().length > 400;
      const hasDate = isFilled(a.created_at);
      const hasUpdated = isFilled(a.content_updated_at) || isFilled(a.created_at);
      const hasFaq = /faq|вопрос/i.test(content);
      const hasLinks = commercialPaths.some((p) => p && content.includes(p));
      blogChecks += 5;
      blogPassed += [hasBody, hasDate, hasUpdated, hasFaq, hasLinks].filter(Boolean).length;
      if (!hasBody) emptyArticles++;
      if (!hasLinks) noLinks++;
      if (!hasFaq) noFaq++;
    }
    push({ group: "blog", key: "article_body", count: emptyArticles, blocking: true, step: 5,
      label_ru: "Статей без текста", label_en: "Articles without a body" });
    push({ group: "blog", key: "article_links", count: noLinks, blocking: false, step: 5,
      label_ru: "Статей без ссылок на коммерческие страницы", label_en: "Articles without links to commercial pages" });
    push({ group: "blog", key: "article_faq", count: noFaq, blocking: false, step: 5,
      label_ru: "Статей без блока FAQ", label_en: "Articles without an FAQ block" });

    // --------------------------------------------------------- Commercial ---
    const cp = (project.commercial_profile || {}) as Record<string, unknown>;
    const pick = (...keys: string[]) => keys.some((k) => isFilled(cp[k]) || isFilled(project[k]));
    const commercialChecks: { key: string; ok: boolean; label_ru: string; label_en: string; blocking: boolean }[] = [
      { key: "company", ok: pick("company_name", "name"), blocking: true,
        label_ru: "Не указано название компании", label_en: "Company name is missing" },
      { key: "phone", ok: pick("company_phone", "phone"), blocking: true,
        label_ru: "Нет телефона компании", label_en: "Company phone is missing" },
      { key: "email", ok: pick("company_email", "email"), blocking: false,
        label_ru: "Нет email компании", label_en: "Company email is missing" },
      { key: "address", ok: pick("company_address", "address", "legal_address", "city"), blocking: false,
        label_ru: "Нет адреса компании", label_en: "Company address is missing" },
      { key: "delivery", ok: pick("delivery", "delivery_terms") || [...blocksByReg.values()].some((s) => s.has("delivery")),
        blocking: false, label_ru: "Нет условий доставки", label_en: "Delivery terms are missing" },
      { key: "warranty", ok: pick("warranty", "warranty_terms") || [...blocksByReg.values()].some((s) => s.has("warranty")),
        blocking: false, label_ru: "Нет условий гарантии", label_en: "Warranty terms are missing" },
      { key: "payment", ok: pick("payment", "payment_methods", "order_method") || [...blocksByReg.values()].some((s) => s.has("payment")),
        blocking: false, label_ru: "Не описаны способы оплаты и заказа", label_en: "Payment and ordering options are missing" },
      { key: "cta", ok: pick("primary_cta", "order_method") || [...blocksByReg.values()].some((s) => s.has("cta")), blocking: false,
        label_ru: "Нет блоков CTA на страницах", label_en: "No CTA blocks on pages" },
      { key: "trust", ok: pick("advantages", "certificates", "years_in_business")
          || [...blocksByReg.values()].some((s) => s.has("trust") || s.has("advantages")), blocking: false,
        label_ru: "Нет блоков доверия и преимуществ", label_en: "No trust or advantages blocks" },
    ];
    for (const c of commercialChecks) {
      if (!c.ok) {
        issues.push({ group: "commercial", key: `commercial_${c.key}`, count: 1, blocking: c.blocking,
          step: c.key === "company" || c.key === "phone" || c.key === "email" || c.key === "address" ? 1 : 5,
          label_ru: c.label_ru, label_en: c.label_en });
      }
    }
    const commercialScore = pct(commercialChecks.filter((c) => c.ok).length, commercialChecks.length);

    // ------------------------------------------------------------- Visual ---
    const visual = (visualRows || []) as { visual_score: number | null }[];
    const visualScoreRaw = visual.length
      ? Math.round(visual.reduce((s, v) => s + (v.visual_score || 0), 0) / visual.length)
      : 0;
    const hasProfile = !!designProfile;
    const visualScore = visual.length ? visualScoreRaw : (hasProfile ? 95 : 0);
    if (!hasProfile) {
      issues.push({ group: "visual", key: "design_profile", count: 1, blocking: true, step: 8,
        label_ru: "Не настроен профиль дизайна", label_en: "Design profile is not configured" });
    } else if (visual.length && visualScoreRaw < MIN_VISUAL_SCORE) {
      issues.push({ group: "visual", key: "visual_score", count: 1, blocking: true, step: 8,
        label_ru: `Visual Score ниже ${MIN_VISUAL_SCORE}`, label_en: `Visual Score below ${MIN_VISUAL_SCORE}` });
    }

    // ---------------------------------------------------------- Technical ---
    const qa = (project.last_qa_report || null) as { critical?: number; score?: number; pages?: number } | null;
    const qaCritical = Number(qa?.critical ?? -1);
    const techChecks = [
      { key: "registry", ok: active.length > 0, blocking: true, step: 3,
        label_ru: "Реестр страниц пуст", label_en: "Page registry is empty" },
      { key: "content_pages", ok: contentPages.length > 0, blocking: true, step: 5,
        label_ru: "Нет контентных страниц", label_en: "No content pages" },
      { key: "qa", ok: qaCritical === 0, blocking: true, step: 6,
        label_ru: qaCritical < 0 ? "QA не выполнялся" : `Критических ошибок QA: ${qaCritical}`,
        label_en: qaCritical < 0 ? "QA has not run yet" : `QA critical issues: ${qaCritical}` },
      { key: "indexable", ok: active.some((r) => r.indexable !== false), blocking: true, step: 5,
        label_ru: "Все страницы закрыты от индексации", label_en: "Every page is set to noindex" },
      { key: "indexnow", ok: isFilled(project.indexnow_key), blocking: false, step: 9,
        label_ru: "Нет ключа IndexNow - индексация пойдет только через sitemap",
        label_en: "IndexNow key is missing - indexing falls back to sitemap pings" },
    ];
    for (const c of techChecks) {
      if (!c.ok) {
        issues.push({ group: "technical", key: `tech_${c.key}`, count: 1, blocking: c.blocking, step: c.step,
          label_ru: c.label_ru, label_en: c.label_en });
      }
    }
    const technicalScore = pct(techChecks.filter((c) => c.ok).length, techChecks.length);

    const seoScore = pct(seoPassed, active.length);
    const contentScore = pct(contentPassed + blogPassed, contentChecks + blogChecks);

    const scores: ScoreRow[] = [
      { group: "seo", score: seoScore, passed: seoPassed, total: active.length },
      { group: "content", score: contentScore, passed: contentPassed + blogPassed, total: contentChecks + blogChecks },
      { group: "commercial", score: commercialScore, passed: commercialChecks.filter((c) => c.ok).length, total: commercialChecks.length },
      { group: "visual", score: visualScore, passed: visualScore, total: 100 },
      { group: "technical", score: technicalScore, passed: techChecks.filter((c) => c.ok).length, total: techChecks.length },
    ];

    const blocking = issues.filter((i) => i.blocking);
    const overall = Math.round(scores.reduce((s, r) => s + r.score, 0) / scores.length);
    const verdict = blocking.length > 0
      ? "BLOCKED"
      : overall >= READY_SCORE ? "SITE_READY" : "SITE_NEEDS_FIX";

    return jsonResponse({
      success: true,
      verdict,
      overall,
      scores,
      issues: issues.sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.count - a.count),
      stats: {
        pages: active.length,
        content_pages: contentPages.length,
        products: liveProducts.length,
        articles: publishable.length,
        qa_critical: qaCritical,
        visual_score: visualScore,
      },
      site: {
        domain: project.domain || null,
        custom_domain: project.custom_domain || null,
        custom_domain_status: project.custom_domain_status || null,
        ssl_status: project.ssl_status || null,
        production_url: project.production_url || null,
        published_at: project.published_at || null,
        deployment_status: project.deployment_status || null,
      },
    });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});
