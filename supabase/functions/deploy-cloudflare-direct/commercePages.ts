// Commercial layer for the Site Factory bundle (P6).
//
// Runs AFTER the SILO layer. Purely additive: a project without rows in
// site_products gets exactly the bundle it got before. For a commercial
// project it renders:
//   /catalog/                      - catalog index (all categories)
//   /{silo}/{cluster}/             - category listing gets a product grid
//   /{silo}/{cluster}/{slug}.html  - product / service page (Product Schema)
//
// Everything is component-based (header/breadcrumbs/grid/specs/cta/footer),
// so templates stay small and consistent across page types.

import { SiteChrome, PageMeta, wrapPage, escHtml } from "./seoChrome.ts";
import {
  getSiloUrl, getClusterUrl, getCanonicalUrl, pathToFileKey, slugifyPath,
  shouldCollapseCluster,
} from "../_shared/siloUrl.ts";
import { asSeoContent, introHtml, bodyHtml, faqHtml, faqLd, entitiesHtml, CONTENT_CSS } from "./contentBlocks.ts";
import { buildCategoryTemplateData, buildProductTemplateData } from "./commerceTemplateData.ts";

export interface ProductRow {
  id: string;
  silo_id: string | null;
  site_cluster_id: string | null;
  sku: string | null;
  name: string;
  slug: string | null;
  url_path: string | null;
  price: number | string | null;
  currency: string | null;
  brand: string | null;
  availability: string | null;
  description: string | null;
  characteristics: Record<string, unknown> | null;
  images: string[] | null;
  kind: string; // product | service
  status: string;
  position: number | null;
  /** Pre-generated SEO content (Commerce Content Engine). Never generated here. */
  seo_content?: unknown;
}

export interface CommerceSilo {
  id: string; name: string; slug: string; description: string | null; position: number; seo_content?: unknown;
}
export interface CommerceCluster {
  id: string; silo_id: string; parent_id: string | null; name: string; slug: string;
  description: string | null; position: number; page_type?: string | null;
  seo_content?: unknown;
}

export interface CommerceResult {
  files: Record<string, string>;
  extraPaths: string[];
  products: number;
  categories: number;
  pathByProductId: Map<string, string>;
  /** P7.2: internal link graph produced by the commercial layer. */
  links: CommerceLink[];
  /** Part 3d: product pages served from the bundle cache instead of rendered. */
  skippedProducts?: number;
}

export interface CommerceLink {
  from_path: string;
  to_path: string;
  anchor: string;
  type: string;
  from_kind: string;
  to_kind: string;
  from_product_id?: string | null;
  to_product_id?: string | null;
}

export const COMMERCE_CSS = `
.cm-grid{list-style:none;padding:0;margin:1.5rem 0;display:grid;gap:1.1rem;grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
.cm-card{border:1px solid rgba(0,0,0,.1);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.cm-card a{text-decoration:none;display:flex;flex-direction:column;height:100%}
.cm-card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:rgba(0,0,0,.04)}
.cm-card__body{padding:.85rem 1rem;display:flex;flex-direction:column;gap:.35rem}
.cm-card__title{font-weight:600;line-height:1.3}
.cm-card__price{font-weight:700}
.cm-card__meta{font-size:.85rem;opacity:.7}
.cm-hero{display:grid;gap:1.5rem;grid-template-columns:minmax(0,1fr);margin:1rem 0 2rem}
@media(min-width:780px){.cm-hero{grid-template-columns:minmax(0,420px) minmax(0,1fr)}}
.cm-hero img{width:100%;border-radius:12px;object-fit:cover}
.cm-price{font-size:1.6rem;font-weight:700;margin:.5rem 0}
.cm-avail{font-size:.9rem;opacity:.8}
.cm-specs{width:100%;border-collapse:collapse;margin:1.25rem 0}
.cm-specs th,.cm-specs td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid rgba(0,0,0,.08);font-size:.95rem}
.cm-specs th{width:45%;font-weight:600;opacity:.8}
.cm-cta{margin:2rem 0;padding:1.25rem 1.4rem;border:1px solid rgba(0,0,0,.12);border-radius:12px}
.cm-cta h2{margin-top:0;font-size:1.2rem}
.cm-related{margin:2.5rem 0}
.cm-up{margin:1.5rem 0;font-size:.92rem}
.cm-cats{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:.75rem 1.25rem;margin:.75rem 0 1.5rem}
.cm-silo-block{margin:2.5rem 0}
.cm-nav-catalog{margin-left:.75rem}
.cm-crumbs{font-size:.85rem;opacity:.75;margin:.5rem 0 1rem}
.cm-crumbs ol{list-style:none;display:flex;flex-wrap:wrap;gap:.4rem;padding:0;margin:0}
.cm-crumbs li+li:before{content:"/";margin-right:.4rem;opacity:.5}
`;

export function money(price: number | string | null, currency: string | null, lang: string): string {
  if (price === null || price === undefined || price === "") return "";
  const n = Number(price);
  if (!Number.isFinite(n)) return "";
  const cur = (currency || "RUB").toUpperCase();
  const sym = cur === "RUB" ? " руб." : cur === "USD" ? " $" : cur === "EUR" ? " EUR" : ` ${cur}`;
  const formatted = n.toLocaleString(lang === "en" ? "en-US" : "ru-RU");
  return cur === "USD" ? `$${formatted}` : `${formatted}${sym}`;
}

// P26.2: breadcrumbs are rendered once by the page chrome (wrapPage). The
// in-body copy stayed only as a duplicate, so it is no longer emitted; the
// crumb list itself is still used for meta + JSON-LD.
function crumbsHtml(_items: { label: string; href?: string }[]): string {
  return "";
}


function crumbsLd(chrome: SiteChrome, items: { label: string; href?: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.label,
      ...(it.href ? { item: getCanonicalUrl(chrome.domain, it.href) } : {}),
    })),
  } as Record<string, unknown>;
}

function organizationLd(chrome: SiteChrome, biz: BusinessInfo) {
  const o: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": biz.city ? "LocalBusiness" : "Organization",
    name: chrome.siteName,
    url: getCanonicalUrl(chrome.domain, "/"),
  };
  if (biz.phone) o.telephone = biz.phone;
  if (biz.address || biz.city) {
    o.address = {
      "@type": "PostalAddress",
      ...(biz.address ? { streetAddress: biz.address } : {}),
      ...(biz.city ? { addressLocality: biz.city } : {}),
    };
  }
  if (biz.workHours) o.openingHours = biz.workHours;
  return o;
}

export interface BusinessInfo {
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  workHours?: string | null;
}

function productCard(p: ProductRow, href: string, lang: string): string {
  const img = (p.images || [])[0];
  const price = money(p.price, p.currency, lang);
  return `<li class="cm-card"><a href="${escHtml(href)}">
${img ? `<img src="${escHtml(img)}" alt="${escHtml(p.name)}" loading="lazy" width="400" height="300">` : ""}
<span class="cm-card__body">
<span class="cm-card__title">${escHtml(p.name)}</span>
${price ? `<span class="cm-card__price">${escHtml(price)}</span>` : ""}
${p.brand ? `<span class="cm-card__meta">${escHtml(p.brand)}</span>` : ""}
</span></a></li>`;
}

function productPath(p: ProductRow, clusterPath: string): string {
  if (p.url_path && p.url_path.startsWith("/")) return p.url_path;
  const slug = slugifyPath(p.slug || p.name);
  return `${clusterPath}${slug}.html`;
}

/**
 * Template runtime v1 (opt-in, default off). When a flag is on and the matching
 * template is present, the page BODY comes from DATA -> TEMPLATE -> HTML.
 * Everything else - URLs, meta, canonical, JSON-LD, breadcrumbs, link graph,
 * sitemap - is produced by the same code as before.
 */
export interface CommerceTemplateRuntime {
  categoryTpl?: string | null;
  productTpl?: string | null;
  enableCategory?: boolean;
  enableProduct?: boolean;
  /** Stylesheet added to template-driven pages only (single source of tokens). */
  themeHref?: string;
  /** Optional facet landings per cluster id (from the existing filter engine). */
  filtersByClusterId?: Map<string, { label: string; href: string; count?: number | null }[]>;
  renderCategory?: (tpl: string, data: Record<string, unknown>) => string | null;
  renderProduct?: (tpl: string, data: Record<string, unknown>) => string | null;
}

/** Swap only the <main> content of an already rendered page (SEO shell intact). */
function swapMainHtml(page: string, mainHtml: string, themeHref?: string): string {
  const open = page.indexOf('<main class="page">');
  const close = page.lastIndexOf("</main>");
  if (open < 0 || close < 0 || close < open) return page;
  let out = page.slice(0, open + '<main class="page">'.length) + mainHtml + page.slice(close);
  if (themeHref && !out.includes(themeHref)) {
    out = out.replace("</head>", `<link rel="stylesheet" href="${escHtml(themeHref)}"></head>`);
  }
  return out;
}

function withThemeLink(page: string, themeHref?: string): string {
  if (!themeHref || page.includes(themeHref)) return page;
  return page.replace("</head>", `<link rel="stylesheet" href="${escHtml(themeHref)}"></head>`);
}

export function applyCommerceLayer(opts: {
  chrome: SiteChrome;
  files: Record<string, string>;
  silos: CommerceSilo[];
  clusters: CommerceCluster[];
  products: ProductRow[];
  business?: BusinessInfo;
  templateRuntime?: CommerceTemplateRuntime;
  /**
   * Part 3d render gate. Returns false for product pages whose HTML is reused
   * from the cached bundle: the link graph and the path list are still built
   * (sitemap, interlinking and the registry must stay complete), only the page
   * body is not generated. Absent => every page renders, as before.
   */
  shouldRenderPage?: (path: string) => boolean;
  renderPage?: <T>(path: string, render: () => T) => T | null;
}): CommerceResult {
  const { chrome, files } = opts;
  const lang = chrome.lang === "en" ? "en" : "ru";
  const t = (ru: string, en: string) => (lang === "en" ? en : ru);
  const biz = opts.business || {};
  const tr = opts.templateRuntime || {};
  const tplCategoryOn = !!(tr.enableCategory && tr.categoryTpl && tr.renderCategory);
  const tplProductOn = !!(tr.enableProduct && tr.productTpl && tr.renderProduct);
  let tplCategoryPages = 0;
  let tplProductPages = 0;
  let skippedProducts = 0;


  const siloById = new Map(opts.silos.map((s) => [s.id, s]));
  const clusterById = new Map(opts.clusters.map((c) => [c.id, c]));
  // Single same-named child category shares the hub URL (no /{silo}/{silo}/).
  const collapsed = new Set<string>();
  for (const s of opts.silos) {
    const roots = opts.clusters.filter((c) => c.silo_id === s.id && !c.parent_id);
    for (const c of roots) {
      if (shouldCollapseCluster(c, s, roots.length)) collapsed.add(c.id);
    }
  }
  const extraPaths: string[] = [];
  const pathByProductId = new Map<string, string>();
  const links: CommerceLink[] = [];
  const addLink = (l: CommerceLink) => { if (l.from_path !== l.to_path) links.push(l); };

  const active = opts.products.filter((p) => p.status !== "archived");
  // Pre-index siblings once. The old per-product active.filter() made this
  // loop O(n²), so even cached pages exhausted the worker on 500+ catalogs.
  const productsByCluster = new Map<string, ProductRow[]>();
  for (const p of active) {
    if (!p.site_cluster_id) continue;
    const bucket = productsByCluster.get(p.site_cluster_id) || [];
    bucket.push(p);
    productsByCluster.set(p.site_cluster_id, bucket);
  }

  const clusterPathOf = (c: CommerceCluster): string => {
    const silo = siloById.get(c.silo_id);
    if (!silo) return "/catalog/";
    const parents: string[] = [];
    let cur = c.parent_id ? clusterById.get(c.parent_id) : undefined;
    let guard = 0;
    while (cur && guard++ < 5) { parents.unshift(cur.slug); cur = cur.parent_id ? clusterById.get(cur.parent_id) : undefined; }
    return getClusterUrl({
      slug: c.slug, siloSlug: silo.slug, parentSlugs: parents,
      collapse: collapsed.has(c.id),
    });
  };

  // ---- 1. product / service pages -----------------------------------------
  for (const p of active) {
    const cluster = p.site_cluster_id ? clusterById.get(p.site_cluster_id) : undefined;
    const silo = cluster ? siloById.get(cluster.silo_id) : (p.silo_id ? siloById.get(p.silo_id) : undefined);
    const basePath = cluster ? clusterPathOf(cluster) : (silo ? getSiloUrl({ slug: silo.slug }) : "/catalog/");
    const path = productPath(p, basePath);
    pathByProductId.set(p.id, path);
  }

  for (const p of active) {
    const cluster = p.site_cluster_id ? clusterById.get(p.site_cluster_id) : undefined;
    const silo = cluster ? siloById.get(cluster.silo_id) : (p.silo_id ? siloById.get(p.silo_id) : undefined);
    const path = pathByProductId.get(p.id)!;

    // P7.2: sibling products keep every leaf page linked into the cluster.
    const clusterProducts = p.site_cluster_id ? productsByCluster.get(p.site_cluster_id) || [] : [];
    const siblings: ProductRow[] = [];
    for (const candidate of clusterProducts) {
      if (candidate.id === p.id) continue;
      siblings.push(candidate);
      if (siblings.length === 4) break;
    }

    if (cluster) {
      addLink({ from_path: path, to_path: clusterPathOf(cluster), anchor: cluster.name, type: "breadcrumb", from_kind: "product", to_kind: "category", from_product_id: p.id });
    }
    if (silo) {
      addLink({ from_path: path, to_path: getSiloUrl({ slug: silo.slug }), anchor: silo.name, type: "breadcrumb", from_kind: "product", to_kind: "hub", from_product_id: p.id });
    }
    addLink({ from_path: path, to_path: "/catalog/", anchor: t("Весь каталог", "Full catalog"), type: "navigation", from_kind: "product", to_kind: "catalog", from_product_id: p.id });
    for (const s of siblings) {
      addLink({ from_path: path, to_path: pathByProductId.get(s.id)!, anchor: s.name, type: "related", from_kind: "product", to_kind: "product", from_product_id: p.id, to_product_id: s.id });
    }

    // 3d: cached product page - the O(n) link/path bookkeeping above is kept,
    // while all page-only preparation and HTML generation stay behind the gate.
    const productKey = pathToFileKey(path);
    if (opts.shouldRenderPage && !opts.shouldRenderPage(productKey)) {
      extraPaths.push(path);
      skippedProducts++;
      continue;
    }

    const rawCrumbs = [
      { label: t("Главная", "Home"), href: "/" },
      ...(silo ? [{ label: silo.name, href: getSiloUrl({ slug: silo.slug }) }] : []),
      ...(cluster ? [{ label: cluster.name, href: clusterPathOf(cluster) }] : []),
      { label: p.name },
    ];
    // A collapsed category shares the hub URL - keep one crumb for it.
    const crumbs = rawCrumbs.filter((c, i) =>
      !c.href || rawCrumbs.findIndex((x) => x.href === c.href) === i);
    const chars = p.characteristics && typeof p.characteristics === "object"
      ? Object.entries(p.characteristics as Record<string, unknown>).filter(([, v]) => v !== null && v !== "")
      : [];
    const img = (p.images || [])[0];
    const priceStr = money(p.price, p.currency, lang);
    const isService = p.kind === "service";
    const sc = asSeoContent(p.seo_content);
    const relatedHtml = siblings.length
      ? `<section class="cm-related"><h2>${escHtml(t("Смотрите также", "See also"))}</h2>
<ul class="cm-grid">${siblings.map((s) => productCard(s, pathByProductId.get(s.id)!, lang)).join("")}</ul></section>`
      : "";
    const upHtml = `<p class="cm-up">${
      cluster ? `<a href="${escHtml(clusterPathOf(cluster))}">${escHtml(t("Все в разделе", "All in category"))}: ${escHtml(cluster.name)}</a> · ` : ""
    }<a href="/catalog/">${escHtml(t("Весь каталог", "Full catalog"))}</a></p>`;

    const gallery = (p.images || []).filter(Boolean).slice(0, 4);
    const keySpecs = chars.slice(0, 4);
    const inStock = p.availability !== "out_of_stock";
    const body = `${crumbsHtml(crumbs)}
<div class="cm-hero">
  <div class="cm-gallery">${
    gallery.length
      ? gallery.map((src, i) => `<img${i === 0 ? ` class="cm-gallery__main"` : ` class="cm-gallery__thumb" loading="lazy"`} src="${escHtml(src)}" alt="${escHtml(p.name)}" width="800" height="600">`).join("")
      : ""
  }</div>
  <div class="cm-buybox">
    <h1>${escHtml(sc?.h1 || p.name)}</h1>
    ${keySpecs.length
      ? `<ul class="cm-keyspecs">${keySpecs.map(([k, v]) => `<li><span>${escHtml(k)}</span><b>${escHtml(String(v))}</b></li>`).join("")}</ul>`
      : ""}
    <div class="cm-price">${escHtml(priceStr || t("Цена по запросу", "Price on request"))}</div>
    <p class="cm-avail ${inStock ? "cm-avail--in" : "cm-avail--out"}">${escHtml(
      inStock ? t("В наличии", "In stock") : t("Нет в наличии", "Out of stock"),
    )}</p>
    ${p.brand ? `<p class="cm-avail">${escHtml(t("Бренд", "Brand"))}: ${escHtml(p.brand)}</p>` : ""}
    ${p.sku ? `<p class="cm-avail">${escHtml(t("Артикул", "SKU"))}: ${escHtml(p.sku)}</p>` : ""}
    <div class="pm-actions">
      ${biz.phone
        ? `<a class="pm-btn pm-btn--primary" href="tel:${escHtml(String(biz.phone).replace(/[^\d+]/g, ""))}">${escHtml(isService ? t("Заказать услугу", "Request service") : t("Заказать по телефону", "Order by phone"))}</a>`
        : `<a class="pm-btn pm-btn--primary" href="/contacts.html">${escHtml(isService ? t("Оставить заявку", "Request a quote") : t("Оставить заявку", "Request a quote"))}</a>`}
      <a class="pm-btn pm-btn--ghost" href="/catalog/">${escHtml(t("Весь каталог", "Full catalog"))}</a>
    </div>
  </div>
</div>
${introHtml(sc)}
${p.description ? `<h2>${escHtml(t("Описание", "Description"))}</h2><p>${escHtml(p.description)}</p>` : ""}
${bodyHtml(sc)}
${chars.length
  ? `<h2>${escHtml(t("Характеристики", "Specifications"))}</h2><table class="cm-specs"><tbody>${
      chars.map(([k, v]) => `<tr><th>${escHtml(k)}</th><td>${escHtml(String(v))}</td></tr>`).join("")
    }</tbody></table>`
  : ""}
${faqHtml(sc, t("Частые вопросы", "FAQ"))}
<section class="cm-cta">
  <h2>${escHtml(isService ? t("Оставить заявку", "Request a quote") : t("Как купить", "How to order"))}</h2>
  <p>${escHtml(t(
    "Свяжитесь с нами - подберем решение под вашу задачу и рассчитаем стоимость.",
    "Contact us - we will match the right option and quote the price.",
  ))}</p>
  ${biz.phone ? `<p><a href="tel:${escHtml(String(biz.phone).replace(/[^\d+]/g, ""))}">${escHtml(biz.phone)}</a></p>` : ""}
</section>
${relatedHtml}
${upHtml}`;


    const offerAvail = p.availability === "out_of_stock"
      ? "https://schema.org/OutOfStock"
      : "https://schema.org/InStock";
    const priceNum = Number(p.price);
    const productLd: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": isService ? "Service" : "Product",
      name: p.name,
      url: getCanonicalUrl(chrome.domain, path),
      ...(p.description ? { description: p.description.slice(0, 400) } : {}),
      ...(img ? { image: [img] } : {}),
      ...(p.sku && !isService ? { sku: p.sku } : {}),
      ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
      ...(Number.isFinite(priceNum) && priceNum > 0
        ? {
            offers: {
              "@type": "Offer",
              price: priceNum,
              priceCurrency: (p.currency || "RUB").toUpperCase(),
              availability: offerAvail,
              url: getCanonicalUrl(chrome.domain, path),
            },
          }
        : {}),
      ...(isService ? { provider: { "@type": "Organization", name: chrome.siteName } } : {}),
    };

    const meta: PageMeta = {
      title: sc?.seo_title || `${p.name}${priceStr ? ` - ${priceStr}` : ""} - ${chrome.siteName}`.slice(0, 65),
      description: sc?.seo_description
        || (p.description || `${p.name}. ${chrome.siteAbout}`).replace(/\s+/g, " ").slice(0, 158),
      path,
      type: "website",
      breadcrumbs: crumbs.map((c) => ({ label: c.label, href: c.href || path })),
      jsonLd: [productLd, crumbsLd(chrome, crumbs), organizationLd(chrome, biz), faqLd(sc)]
        .filter(Boolean) as Record<string, unknown>[],
    };
    let productPage = wrapPage(chrome, meta, body);
    if (tplProductOn) {
      // DATA -> TEMPLATE -> HTML. Meta, JSON-LD, canonical and breadcrumbs above
      // are reused as-is: the template only replaces the <main> content.
      const tplBody = tr.renderProduct!(tr.productTpl!, buildProductTemplateData({
        lang,
        product: p,
        seoContent: p.seo_content,
        breadcrumbs: crumbs,
        related: siblings.map((s) => ({ product: s, href: pathByProductId.get(s.id)! })),
        business: biz,
        categoryHref: cluster ? clusterPathOf(cluster) : undefined,
        categoryName: cluster ? cluster.name : undefined,
        catalogHref: "/catalog/",
      }) as unknown as Record<string, unknown>);
      if (tplBody) {
        productPage = withThemeLink(wrapPage(chrome, meta, tplBody), tr.themeHref);
        tplProductPages++;
      }
    }
    files[productKey] = productPage;
    extraPaths.push(path);
  }

  // ---- 2. product grid injected into category (cluster) pages -------------
  let categories = 0;
  for (const c of opts.clusters) {
    const items = active.filter((p) => p.site_cluster_id === c.id);
    if (!items.length) continue;
    const path = clusterPathOf(c);
    const key = pathToFileKey(path);
    if (opts.shouldRenderPage && !opts.shouldRenderPage(key)) {
      extraPaths.push(path);
      continue;
    }
    const grid = `<section class="cm-catalog"><h2>${escHtml(t("Каталог раздела", "Category catalog"))}</h2>
<ul class="cm-grid">${items
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((p) => productCard(p, pathByProductId.get(p.id)!, lang)).join("")}</ul>
<p class="cm-up"><a href="/catalog/">${escHtml(t("Весь каталог", "Full catalog"))}</a></p></section>`;
    for (const p of items) {
      addLink({ from_path: path, to_path: pathByProductId.get(p.id)!, anchor: p.name, type: "listing", from_kind: "category", to_kind: "product", to_product_id: p.id });
    }
    addLink({ from_path: path, to_path: "/catalog/", anchor: t("Весь каталог", "Full catalog"), type: "navigation", from_kind: "category", to_kind: "catalog" });
    // Template runtime v1: the category body comes from the template. Path,
    // meta, canonical, JSON-LD and breadcrumbs stay exactly as produced by the
    // SILO/commerce layers - only the <main> content is replaced.
    const categoryTplBody = tplCategoryOn
      ? tr.renderCategory!(tr.categoryTpl!, buildCategoryTemplateData({
          lang,
          h1: asSeoContent(c.seo_content)?.h1 || c.name,
          intro: c.description || "",
          seoContent: c.seo_content,
          breadcrumbs: [
            { label: t("Главная", "Home"), href: "/" },
            ...(siloById.get(c.silo_id) ? [{ label: siloById.get(c.silo_id)!.name, href: getSiloUrl({ slug: siloById.get(c.silo_id)!.slug }) }] : []),
            { label: c.name },
          ],
          subcategories: opts.clusters
            .filter((x) => x.parent_id === c.id)
            .map((x) => ({
              name: x.name,
              href: clusterPathOf(x),
              count: active.filter((p) => p.site_cluster_id === x.id).length || null,
            })),
          products: items
            .slice()
            .sort((a, b) => (a.position || 0) - (b.position || 0))
            .map((p) => ({ product: p, href: pathByProductId.get(p.id)! })),
          filters: tr.filtersByClusterId?.get(String(c.id)) || [],
          catalogHref: "/catalog/",
          business: biz,
        }) as unknown as Record<string, unknown>)
      : null;

    const existing = files[key];
    if (existing && categoryTplBody) {
      files[key] = swapMainHtml(existing, categoryTplBody, tr.themeHref);
      tplCategoryPages++;
    } else if (existing) {
      // P26.2: products belong right after the page head (H1 + intro), not
      // below the FAQ. The silo layer always opens the body with
      // <section class="pm-pagehead">, so inject after its closing tag.
      const headEnd = existing.indexOf("</section>");
      files[key] = headEnd > -1
        ? existing.slice(0, headEnd + 10) + grid + existing.slice(headEnd + 10)
        : existing.replace(/<\/main>/i, `${grid}</main>`);
    } else {
      const silo = siloById.get(c.silo_id);
      const csc = asSeoContent(c.seo_content);
      const crumbs = [
        { label: t("Главная", "Home"), href: "/" },
        ...(silo ? [{ label: silo.name, href: getSiloUrl({ slug: silo.slug }) }] : []),
        { label: c.name },
      ];
      const body = `${crumbsHtml(crumbs)}<section class="pm-pagehead"><h1>${escHtml(csc?.h1 || c.name)}</h1>${
        csc ? introHtml(csc) : (c.description ? `<p class="lead">${escHtml(c.description)}</p>` : "")
      }</section>${grid}${bodyHtml(csc)}${faqHtml(csc, t("Частые вопросы", "FAQ"))}${
        entitiesHtml(csc, t("Связанные понятия", "Related entities"))}`;

      files[key] = wrapPage(chrome, {
        title: csc?.seo_title || `${c.name} - ${chrome.siteName}`.slice(0, 65),
        description: csc?.seo_description || (c.description || `${c.name}. ${chrome.siteAbout}`).slice(0, 158),
        path,
        type: "website",
        breadcrumbs: crumbs.map((x) => ({ label: x.label, href: x.href || path })),
        jsonLd: [crumbsLd(chrome, crumbs), organizationLd(chrome, biz), faqLd(csc)]
          .filter(Boolean) as Record<string, unknown>[],
      }, categoryTplBody || body);
      if (categoryTplBody) {
        files[key] = withThemeLink(files[key], tr.themeHref);
        tplCategoryPages++;
      }
      extraPaths.push(path);
    }
    categories++;
  }

  // ---- 3. catalog index ----------------------------------------------------
  if (active.length) {
    const path = "/catalog/";
    const catalogKey = pathToFileKey(path);
    if (opts.shouldRenderPage && !opts.shouldRenderPage(catalogKey)) {
      extraPaths.push(path);
    } else {
    // A product whose category page is not part of this build (rejected by the
    // registry) keeps its registry URL but has no category grid to link it -
    // the catalog picks it up so no page is left unlinked.
    const orphans = active.filter((p) => !p.site_cluster_id || !clusterById.has(p.site_cluster_id));

    const crumbs = [{ label: t("Главная", "Home"), href: "/" }, { label: t("Каталог", "Catalog") }];
    // Grouped by silo -> category, so the catalog mirrors the real SILO tree.
    const siloBlocks = opts.silos
      .slice()
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((s) => {
        const cats = opts.clusters
          .filter((c) => c.silo_id === s.id)
          .map((c) => ({ c, items: active.filter((p) => p.site_cluster_id === c.id) }))
          .filter((g) => g.items.length);
        return { s, cats };
      })
      .filter((b) => b.cats.length);

    const body = `${crumbsHtml(crumbs)}<h1>${escHtml(t("Каталог", "Catalog"))}</h1>
<p class="lead">${escHtml(t(
      `Все разделы и позиции: ${active.length}.`,
      `All sections and items: ${active.length}.`,
    ))}</p>
${siloBlocks.map((b) => `<section class="cm-silo-block">
<h2><a href="${escHtml(getSiloUrl({ slug: b.s.slug }))}">${escHtml(b.s.name)}</a></h2>
<ul class="cm-cats">${b.cats
      .filter((g) => clusterPathOf(g.c) !== getSiloUrl({ slug: b.s.slug }))
      .map((g) =>
      `<li><a href="${escHtml(clusterPathOf(g.c))}">${escHtml(g.c.name)}</a> <span class="cm-card__meta">(${g.items.length})</span></li>`,
    ).join("")}</ul>
${b.cats.map((g) => `<h3><a href="${escHtml(clusterPathOf(g.c))}">${escHtml(g.c.name)}</a></h3>
<ul class="cm-grid">${g.items.map((p) => productCard(p, pathByProductId.get(p.id)!, lang)).join("")}</ul>`).join("")}
</section>`).join("")}
${orphans.length ? `<section><h2>${escHtml(t("Другое", "Other"))}</h2><ul class="cm-grid">${
  orphans.map((p) => productCard(p, pathByProductId.get(p.id)!, lang)).join("")}</ul></section>` : ""}`;

    for (const b of siloBlocks) {
      addLink({ from_path: path, to_path: getSiloUrl({ slug: b.s.slug }), anchor: b.s.name, type: "navigation", from_kind: "catalog", to_kind: "hub" });
      for (const g of b.cats) {
        addLink({ from_path: path, to_path: clusterPathOf(g.c), anchor: g.c.name, type: "navigation", from_kind: "catalog", to_kind: "category" });
        for (const p of g.items) {
          addLink({ from_path: path, to_path: pathByProductId.get(p.id)!, anchor: p.name, type: "listing", from_kind: "catalog", to_kind: "product", to_product_id: p.id });
        }
      }
    }
    for (const p of orphans) {
      addLink({ from_path: path, to_path: pathByProductId.get(p.id)!, anchor: p.name, type: "listing", from_kind: "catalog", to_kind: "product", to_product_id: p.id });
    }
    files[catalogKey] = wrapPage(chrome, {
      title: `${t("Каталог", "Catalog")} - ${chrome.siteName}`.slice(0, 65),
      description: `${t("Каталог", "Catalog")}: ${chrome.siteAbout}`.slice(0, 158),
      path,
      type: "website",
      breadcrumbs: crumbs.map((x) => ({ label: x.label, href: x.href || path })),
      jsonLd: [crumbsLd(chrome, crumbs), organizationLd(chrome, biz)],
    }, body);
    extraPaths.push(path);
    }
  }

  files["style.css"] = (files["style.css"] || "") + "\n" + COMMERCE_CSS + "\n" + CONTENT_CSS;

  // ---- 4. catalog entry point in the site navigation ----------------------
  if (active.length) {
    const label = t("Каталог", "Catalog");
    const navItem = `<a href="/catalog/" class="cm-nav-catalog">${escHtml(label)}</a>`;
    for (const [key, content] of Object.entries(files)) {
      if (!key.endsWith(".html")) continue;
      const html = String(content);
      if (html.includes('href="/catalog/"') && html.includes("cm-nav-catalog")) continue;
      if (/<\/nav>/i.test(html)) {
        files[key] = html.replace(/<\/nav>/i, `${navItem}</nav>`);
      } else if (/<\/header>/i.test(html)) {
        files[key] = html.replace(/<\/header>/i, `<nav class="cm-nav">${navItem}</nav></header>`);
      }
    }
  }

  if (tplCategoryPages || tplProductPages) {
    console.log("[commerce][template-runtime] category pages=", tplCategoryPages,
      "product pages=", tplProductPages);
  }
  return { files, extraPaths, products: active.length, categories, pathByProductId, links, skippedProducts };
}