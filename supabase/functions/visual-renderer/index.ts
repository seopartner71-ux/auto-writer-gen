// ============================================================================
// P18 - VISUAL RENDERER (separate renderer layer)
//
//   page_registry + page_visual_config + content + seo + commercial blocks
//   + design_profile -> [RENDERER] -> HTML
//
// Does NOT touch PDE / Registry / Content Engine / SEO Engine / Blog Engine /
// QA / Build API. No publish, no CDN, no IndexNow.
//
// Body: { project_id, action: "pages" | "render" | "preview_set" | "qa",
//         registry_id?, page_type?, fragment?: boolean }
// ============================================================================

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { readCommercialProfile } from "../_shared/commercialProfile.ts";
import {
  buildPageVisualConfig, presetFor, sanitizeColorScheme, sanitizeTypography, visualPageType,
  type DesignProfile, type Industry, type LayoutType, type VisualStyle,
} from "../_shared/visualTemplates.ts";
import {
  renderPage, siteDesignQa, visualReady,
  type PageData, type SiteContext, type VisualBlock,
} from "../_shared/render/renderPage.ts";
import { scorePage } from "../_shared/render/visualScore.ts";
// P20 - Media Engine assets (image_assets). The renderer only consumes them.
import { loadMedia, mediaKey, mediaUrls, mergeImages } from "../_shared/mediaAssets.ts";

const t = (v: unknown) => String(v ?? "").trim();
const INDUSTRIES: Industry[] = ["ecommerce", "services", "informational", "local_business", "b2b_catalog"];
const STYLES: VisualStyle[] = ["industrial", "minimal", "corporate", "bold", "warm"];
const LAYOUTS: LayoutType[] = ["wide", "boxed", "split"];

type Row = Record<string, unknown>;

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
const between = (html: string, open: RegExp, close: string) => {
  const m = open.exec(html);
  if (!m) return "";
  const end = html.indexOf(close, m.index);
  return end < 0 ? "" : html.slice(m.index, end);
};

function profileFromRow(row: Row | null): DesignProfile {
  const industry = (INDUSTRIES.includes(t(row?.industry) as Industry) ? t(row?.industry) : "ecommerce") as Industry;
  const base = presetFor(industry);
  if (!row) return base;
  return {
    name: t(row.name) || base.name,
    industry,
    style: (STYLES.includes(t(row.style) as VisualStyle) ? t(row.style) : base.style) as VisualStyle,
    color_scheme: sanitizeColorScheme(row.color_scheme, base.color_scheme),
    typography: sanitizeTypography(row.typography, base.typography),
    layout_type: (LAYOUTS.includes(t(row.layout_type) as LayoutType) ? t(row.layout_type) : base.layout_type) as LayoutType,
    components_config: {
      ...base.components_config,
      ...((row.components_config as Row) || {}),
      templates: { ...base.components_config.templates, ...(((row.components_config as Row)?.templates as Record<string, string>) || {}) },
      blocks: (((row.components_config as Row)?.blocks as Record<string, never>) || {}),
    } as DesignProfile["components_config"],
  };
}

const cards = (items: unknown, fallbackTitle: string) =>
  (Array.isArray(items) ? items : []).map((x) => (typeof x === "string"
    ? { title: fallbackTitle, text: x }
    : { title: t((x as Row)?.title) || fallbackTitle, text: t((x as Row)?.text) })).filter((c) => c.title || c.text);

const CURRENCY_SIGN: Record<string, string> = { RUB: "\u20bd", USD: "$", EUR: "\u20ac", KZT: "\u20b8", BYN: "Br" };
const money = (price: unknown, currency: unknown) => {
  const n = Number(price);
  if (price == null || price === "" || !Number.isFinite(n) || n <= 0) return "";
  const code = t(currency).toUpperCase();
  return `${n.toLocaleString("ru-RU")} ${CURRENCY_SIGN[code] || t(currency) || "\u20bd"}`;
};
const AVAILABILITY_LABEL: Record<string, string> = {
  in_stock: "\u0412 \u043d\u0430\u043b\u0438\u0447\u0438\u0438",
  out_of_stock: "\u041f\u043e\u0434 \u0437\u0430\u043a\u0430\u0437",
  preorder: "\u041f\u043e\u0434 \u0437\u0430\u043a\u0430\u0437",
  on_request: "\u041f\u043e \u0437\u0430\u043f\u0440\u043e\u0441\u0443",
};
const availabilityLabel = (v: unknown) => {
  const key = t(v).toLowerCase().replace(/[\s-]+/g, "_");
  return key ? (AVAILABILITY_LABEL[key] || t(v)) : "";
};

function seoContentOf(row: Row | undefined) {
  return ((row?.seo_content || {}) as Row);
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = t(body?.project_id);
    const action = t(body?.action) || "pages";
    if (!projectId) return errorResponse("project_id is required", 400);

    const admin = adminClient();
    const { data: project } = await admin.from("projects").select("*").eq("id", projectId).maybeSingle();
    if (!project) return errorResponse("project not found", 404);
    if ((project as Row).user_id !== auth.userId) return errorResponse("Forbidden", 403);

    const commercial = readCommercialProfile(project as Row);
    const { data: profileRow } = await admin.from("design_profiles")
      .select("*").eq("project_id", projectId).eq("is_active", true).maybeSingle();
    const profile = profileFromRow(profileRow as Row | null);

    // ---- registry ----------------------------------------------------------
    const { data: registryRows } = await admin.from("page_registry")
      .select("id, entity_type, entity_id, page_type, url_path, title, status")
      .eq("project_id", projectId).in("status", ["approved", "review"])
      .order("url_path").limit(3000);
    const registry = ((registryRows || []) as Row[]);
    if (!registry.length) return errorResponse("registry_empty: run the Page Decision Engine first", 409);

    if (action === "pages") {
      return jsonResponse({
        ok: true,
        has_profile: Boolean(profileRow),
        pages: registry.slice(0, 500).map((r) => ({
          registry_id: r.id, url_path: r.url_path, title: r.title,
          page_type: visualPageType(r as { page_type?: string; url_path?: string }),
        })),
      });
    }

    // ---- data bundle -------------------------------------------------------
    const [seoRes, visualRes, blocksRes, productsRes, clustersRes, silosRes] = await Promise.all([
      admin.from("page_seo").select("registry_id, title, meta_description, h1, faq").eq("project_id", projectId).limit(3000),
      admin.from("page_visual_config").select("registry_id, blocks, template, page_type").eq("project_id", projectId).limit(3000),
      admin.from("page_commercial_blocks").select("registry_id, block_type, title, content").eq("project_id", projectId).limit(6000),
      admin.from("site_products").select("id, silo_id, site_cluster_id, name, url_path, slug, price, currency, brand, availability, description, characteristics, images, seo_content, kind, benefits").eq("project_id", projectId).limit(4000),
      admin.from("site_clusters").select("id, silo_id, parent_id, name, slug, description, seo_content").eq("project_id", projectId).limit(3000),
      admin.from("site_silos").select("id, name, slug, description, seo_content").eq("project_id", projectId).limit(200),
    ]);

    const seoBy = new Map(((seoRes.data || []) as Row[]).map((r) => [t(r.registry_id), r]));
    const visualBy = new Map(((visualRes.data || []) as Row[]).map((r) => [t(r.registry_id), r]));
    const commercialBy = new Map<string, Row[]>();
    for (const b of ((blocksRes.data || []) as Row[])) {
      const k = t(b.registry_id);
      commercialBy.set(k, [...(commercialBy.get(k) || []), b]);
    }
    const products = ((productsRes.data || []) as Row[]);
    const clusters = ((clustersRes.data || []) as Row[]);
    const silos = ((silosRes.data || []) as Row[]);
    const productById = new Map(products.map((p) => [t(p.id), p]));
    const clusterById = new Map(clusters.map((c) => [t(c.id), c]));
    const siloById = new Map(silos.map((s) => [t(s.id), s]));
    const pathByEntity = new Map(registry.map((r) => [t(r.entity_id), t(r.url_path)]));

    // ---- site context (identical on every page) ----------------------------
    const hubs = registry.filter((r) => t(r.page_type) === "hub" || t(r.entity_type) === "silo").slice(0, 6);
    const nav = hubs.map((r) => ({ href: t(r.url_path), label: t(r.title) || t(r.url_path) }));
    const site: SiteContext = {
      company: t(commercial.companyName) || t((project as Row).site_name) || t((project as Row).name),
      about: t(commercial.description) || t(commercial.positioning),
      phone: t(commercial.phone) || t((project as Row).company_phone),
      email: t(commercial.email) || t((project as Row).company_email),
      address: t(commercial.address) || t((project as Row).company_address) || t((project as Row).legal_address),
      nav: nav.length ? nav : [{ href: "/", label: "Главная" }],
      footerColumns: [
        { title: "Разделы", links: nav.length ? nav : [{ href: "/", label: "Главная" }] },
        { title: "Компания", links: [{ href: "/about/", label: "О компании" }, { href: "/contacts/", label: "Контакты" }] },
      ],
      copyright: `${new Date().getFullYear()} ${t(commercial.companyName) || t((project as Row).site_name)}`,
      primaryCta: t(commercial.primaryCta) || "Оставить заявку",
      stickyCta: profile.components_config?.sticky_mobile_cta !== false,
    };

    const plural = (n: number, one: string, few: string, many: string) => {
      const m10 = n % 10, m100 = n % 100;
      if (m10 === 1 && m100 !== 11) return one;
      if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
      return many;
    };

    const titleByPath = new Map<string, string>();
    for (const r of registry) {
      const tt = t(r.title);
      if (tt) titleByPath.set(t(r.url_path), tt);
    }

    // Factual trust cards built from real catalog data (no invented facts).
    const catalogFacts = [
      products.length ? { title: "Каталог", text: `${products.length} ${plural(products.length, "позиция", "позиции", "позиций")} в наличии и под заказ` } : null,
      clusters.length ? { title: "Разделы", text: `${clusters.length} ${plural(clusters.length, "категория", "категории", "категорий")} в каталоге` } : null,
      silos.length ? { title: "Направления", text: silos.slice(0, 5).map((x) => t(x.name)).join(", ") } : null,
    ].filter(Boolean) as { title: string; text: string }[];

    // ---- page builder ------------------------------------------------------
    function buildPage(row: Row): { page: PageData; blocks: VisualBlock[] } {
      const regId = t(row.id);
      const pageType = visualPageType(row as { page_type?: string; url_path?: string });
      const seo = seoBy.get(regId) || {};
      const product = productById.get(t(row.entity_id));
      const cluster = clusterById.get(t(row.entity_id));
      const silo = siloById.get(t(row.entity_id));
      const entity = product || cluster || silo;
      const sc = seoContentOf(entity);
      const cblocks = commercialBy.get(regId) || [];
      const pick = (type: string) => cblocks.filter((b) => t(b.block_type) === type)
        .map((b) => ({ title: t(b.title), text: t(b.content) }));

      const isHome = pageType === "home";
      const childClusters = cluster
        ? clusters.filter((c) => t(c.parent_id) === t(cluster.id))
        : silo ? clusters.filter((c) => t(c.silo_id) === t(silo.id) && !c.parent_id) : [];
      const scopeProducts = cluster
        ? products.filter((p) => t(p.site_cluster_id) === t(cluster.id))
        : silo ? products.filter((p) => t(p.silo_id) === t(silo.id))
        : product ? products.filter((p) => t(p.site_cluster_id) === t(product.site_cluster_id) && t(p.id) !== t(product.id))
        : products;
      const homeSections = isHome
        ? registry.filter((r) => t(r.page_type) === "hub" || t(r.page_type) === "category").slice(0, 8)
          .map((r) => ({ href: t(r.url_path), label: t(r.title) || t(r.url_path) }))
        : [];
      const homeArticles = registry.filter((r) => t(r.page_type) === "article")
        .slice(0, 3).map((r) => ({ href: t(r.url_path), label: t(r.title) || t(r.url_path) }));

      const toCard = (p: Row) => ({
        title: t(p.name),
        href: t(p.url_path) || pathByEntity.get(t(p.id)) || `/${t(p.slug)}/`,
        image: (Array.isArray(p.images) ? (p.images as string[])[0] : "") || "",
        price: money(p.price, p.currency),
        note: t(p.brand),
      });

      const chars = Object.entries((product?.characteristics as Row) || {})
        .map(([k, v]) => [t(k), t(v)] as [string, string]).filter(([k, v]) => k && v);

      const breadcrumbs = [{ href: "/", label: "Главная" }];
      const parts = t(row.url_path).split("/").filter(Boolean);
      let acc = "";
      for (const part of parts) {
        acc += `/${part}`;
        const href = part.endsWith(".html") ? acc : `${acc}/`;
        const known = titleByPath.get(href) || titleByPath.get(acc) || titleByPath.get(`${acc}/`);
        const label = known || part.replace(/\.html$/, "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
        breadcrumbs.push({ href, label });
      }

      const page: PageData = {
        registry_id: regId,
        page_type: pageType,
        url_path: t(row.url_path),
        h1: t(seo.h1) || t(sc.h1) || (pageType === "home" ? site.company : "") || t(row.title) || t(entity?.name) || "Страница",
        title: t(seo.title) || t(sc.seo_title) || t(row.title),
        description: t(seo.meta_description) || t(sc.seo_description),
        breadcrumbs: breadcrumbs.length > 1 ? breadcrumbs : [],
        intro: t(sc.intro) || t(entity?.description),
        body: Array.isArray(sc.body) ? (sc.body as { heading?: string; text?: string }[]) : [],
        faq: Array.isArray(seo.faq) ? (seo.faq as { q: string; a: string }[])
          : Array.isArray(sc.faq) ? (sc.faq as { q: string; a: string }[]) : [],
        price: money(product?.price, product?.currency),
        availability: availabilityLabel(product?.availability),
        images: Array.isArray(product?.images) ? (product?.images as string[]) : [],
        characteristics: chars,
        facts: [
          isHome && products.length ? `${products.length} ${plural(products.length, "позиция", "позиции", "позиций")} в каталоге` : "",
          isHome && clusters.length ? `${clusters.length} ${plural(clusters.length, "категория", "категории", "категорий")}` : "",
          t(product?.brand) && `Бренд: ${t(product?.brand)}`,
          t(commercial.delivery) && "Доставка по РФ",
          t(commercial.warranty) && "Гарантия",
          t(commercial.yearsInBusiness) && `Опыт: ${t(commercial.yearsInBusiness)}`,
        ].filter(Boolean) as string[],
        subcategories: isHome ? homeSections : childClusters.map((c) => ({
          href: pathByEntity.get(t(c.id)) || `/${t(c.slug)}/`, label: t(c.name),
        })),
        products: scopeProducts.slice(0, 9).map(toCard),
        related: scopeProducts.slice(0, 6).map(toCard),
        articles: pageType === "product" || pageType === "article" ? homeArticles.slice(0, 2) : homeArticles,
        comparison: chars.length && scopeProducts.length > 1
          ? {
              head: ["Модель", ...chars.slice(0, 3).map(([k]) => k)],
              rows: scopeProducts.slice(0, 5).map((p) => [
                t(p.name),
                ...chars.slice(0, 3).map(([k]) => t(((p.characteristics as Row) || {})[k])),
              ]),
            }
          : null,
        advantages: pick("advantages").length ? pick("advantages") : cards(commercial.advantages, "Преимущество"),
        trust: pick("trust").length ? pick("trust")
          : (cards(commercial.certificates, "Подтверждение").length ? cards(commercial.certificates, "Подтверждение") : catalogFacts),
        delivery: pick("delivery").length ? pick("delivery") : (t(commercial.delivery) ? [{ title: "Доставка", text: t(commercial.delivery) }] : []),
        payment: pick("payment").length ? pick("payment") : (t(commercial.payment) ? [{ title: "Оплата", text: t(commercial.payment) }] : []),
        warranty: pick("warranty").length ? pick("warranty") : (t(commercial.warranty) ? [{ title: "Гарантия", text: t(commercial.warranty) }] : []),
        certificates: cards(commercial.certificates, "Сертификат"),
        problem: pick("problem"),
        solution: pick("solution"),
        steps: pick("process").length ? pick("process")
          : Array.isArray(sc.body) ? (sc.body as Row[]).slice(0, 4).map((b) => ({ title: t(b.heading), text: t(b.text).slice(0, 180) })) : [],
        cases: pick("cases"),
        applications: pick("applications").length ? pick("applications")
          : cards(sc.applications ?? (product?.benefits as unknown), "Применение"),
        reviews: pick("reviews").map((r) => ({ text: r.text, author: r.title })),
        expert: pick("expert_block")[0] ? { text: pick("expert_block")[0].text, author: site.company } : null,
        author: pageType === "article" ? { name: site.company, role: "Редакция", date: "" } : null,
        cta: pick("cta")[0]
          ? { title: pick("cta")[0].title, text: pick("cta")[0].text, primary: site.primaryCta }
          : { title: "Готовы обсудить задачу?", text: t(commercial.orderMethod), primary: site.primaryCta },
      };

      const stored = visualBy.get(regId);
      const blocks = Array.isArray(stored?.blocks) && (stored?.blocks as unknown[]).length
        ? (stored?.blocks as VisualBlock[])
        : buildPageVisualConfig(pageType, profile, {
            has_h1: Boolean(page.h1), has_faq: (page.faq || []).length > 0,
            has_characteristics: chars.length > 0, has_price: Boolean(page.price),
            has_images: (page.images || []).length > 0, has_children: (page.subcategories || []).length > 0,
            has_products: (page.products || []).length > 0, has_articles: false,
            has_reviews: (page.reviews || []).length > 0, has_content: Boolean(page.intro || (page.body || []).length),
          }).blocks;

      return { page, blocks };
    }

    // ---- RENDER ONE PAGE ---------------------------------------------------
    if (action === "render") {
      const regId = t(body?.registry_id);
      const wanted = t(body?.page_type);
      const row = regId
        ? registry.find((r) => t(r.id) === regId)
        : registry.find((r) => visualPageType(r as { page_type?: string; url_path?: string }) === wanted);
      if (!row) return errorResponse("page not found in registry", 404);

      const { page, blocks } = buildPage(row);
      const out = renderPage({ page, site, profile, blocks, fragment: Boolean(body?.fragment) });
      const ready = visualReady({ page, blocks, profile: profileRow ? profile : null, rendered: out.rendered });
      return jsonResponse({
        ok: true, url_path: page.url_path, page_type: page.page_type, h1: page.h1,
        html: out.html, rendered: out.rendered, skipped: out.skipped, ready,
      });
    }

    // ---- PREVIEW SET (home + category + product + service + article) -------
    if (action === "preview_set") {
      const wantTypes = ["home", "hub", "category", "product", "service", "article"];
      const picked: Row[] = [];
      for (const type of wantTypes) {
        const row = registry.find((r) => visualPageType(r as { page_type?: string; url_path?: string }) === type);
        if (row) picked.push(row);
      }
      const out = picked.map((row) => {
        const { page, blocks } = buildPage(row);
        const res = renderPage({ page, site, profile, blocks });
        return {
          registry_id: t(row.id), url_path: page.url_path, page_type: page.page_type, h1: page.h1,
          html: res.html, rendered: res.rendered, skipped: res.skipped,
          ready: visualReady({ page, blocks, profile: profileRow ? profile : null, rendered: res.rendered }),
        };
      });
      return jsonResponse({ ok: true, pages: out });
    }

    // ---- SITE DESIGN QA ----------------------------------------------------
    if (action === "qa") {
      const sample: Row[] = [];
      const byType = new Map<string, number>();
      for (const row of registry) {
        const type = visualPageType(row as { page_type?: string; url_path?: string });
        const n = byType.get(type) || 0;
        if (n >= 3) continue;
        byType.set(type, n + 1);
        sample.push(row);
        if (sample.length >= 18) break;
      }
      const inputs = sample.map((row) => {
        const { page, blocks } = buildPage(row);
        const res = renderPage({ page, site, profile, blocks });
        const ready = visualReady({ page, blocks, profile: profileRow ? profile : null, rendered: res.rendered });
        return { input: { url_path: page.url_path, page_type: page.page_type, html: res.html, rendered: res.rendered }, ready };
      });
      const qa = siteDesignQa(inputs.map((i) => i.input));
      const blockedPages = inputs.filter((i) => !i.ready.ok)
        .map((i) => ({ url_path: i.input.url_path, blocked: i.ready.blocked }));
      return jsonResponse({ ok: true, qa, build_gate: { allowed: blockedPages.length === 0, blocked: blockedPages } });
    }

    // ---- P18.1 VISUAL AUDIT (design score per page type) -------------------
    if (action === "audit") {
      const wantTypes = ["home", "hub", "category", "product", "service", "article"];
      const picked: Row[] = [];
      for (const type of wantTypes) {
        const row = registry.find((r) => visualPageType(r as { page_type?: string; url_path?: string }) === type);
        if (row) picked.push(row);
      }
      const built = picked.map((row) => {
        const { page, blocks } = buildPage(row);
        const res = renderPage({ page, site, profile, blocks });
        return { page, blocks, res };
      });
      const hashes = built.map((b) => ({
        css: hash(between(b.res.html, /<style>/, "</style>")),
        header: hash(between(b.res.html, /<header/, "</header>")),
        footer: hash(between(b.res.html, /<footer/, "</footer>")),
      }));
      const siteCss = hashes[0]?.css;
      const siteHeader = hashes[0]?.header;
      const siteFooter = hashes[0]?.footer;

      const pages = built.map((b, i) => {
        const score = scorePage({
          page_type: b.page.page_type, html: b.res.html, rendered: b.res.rendered,
          cssHash: hashes[i].css, siteCssHash: siteCss,
          headerHash: hashes[i].header, siteHeaderHash: siteHeader,
          footerHash: hashes[i].footer, siteFooterHash: siteFooter,
        });
        return {
          registry_id: b.page.registry_id, url_path: b.page.url_path, page_type: b.page.page_type,
          h1: b.page.h1, bytes: b.res.html.length, blocks: b.res.rendered, skipped: b.res.skipped,
          ready: visualReady({ page: b.page, blocks: b.blocks, profile: profileRow ? profile : null, rendered: b.res.rendered }),
          ...score,
          html: body?.include_html ? b.res.html : undefined,
        };
      });
      const avg = pages.length ? Math.round(pages.reduce((s, p) => s + p.visual_score, 0) / pages.length) : 0;
      const qa = siteDesignQa(built.map((b) => ({
        url_path: b.page.url_path, page_type: b.page.page_type, html: b.res.html, rendered: b.res.rendered,
      })));
      return jsonResponse({
        ok: true, site_score: avg,
        consistency: {
          css_unified: new Set(hashes.map((h) => h.css)).size === 1,
          header_unified: new Set(hashes.map((h) => h.header)).size === 1,
          footer_unified: new Set(hashes.map((h) => h.footer)).size === 1,
        },
        qa, pages,
      });
    }

    return errorResponse(`unknown action: ${action}`, 400);
  } catch (e) {
    console.error("[visual-renderer]", e);
    return errorResponse(e instanceof Error ? e.message : "renderer failed", 500);
  }
});
