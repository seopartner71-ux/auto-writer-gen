// P24 - faceted landing renderer.
//
// Runs AFTER the commercial layer and reuses its chrome, cards and CSS: there
// is no separate template. A filter landing is a normal category page with a
// narrowed assortment, ItemList schema, breadcrumbs and its own canonical.
//
// Purely additive: a project without rows in catalog_filter_pages gets exactly
// the bundle it got before.

import { SiteChrome, PageMeta, wrapPage, escHtml } from "./seoChrome.ts";
import { getCanonicalUrl, pathToFileKey } from "../_shared/siloUrl.ts";
import { ProductRow } from "./commercePages.ts";

export interface FilterPageRow {
  id: string;
  cluster_id: string | null;
  cluster_path: string | null;
  url_path: string;
  title: string;
  h1: string | null;
  facets: { attribute: string; value: string }[] | null;
  product_ids: string[] | null;
  product_count: number;
  indexable: boolean;
  canonical: string | null;
  seo_content: {
    intro?: string;
    advantages?: string[];
    faq?: { q: string; a: string }[];
  } | null;
}

export interface FilterLink {
  from_path: string; to_path: string; anchor: string; type: string;
  from_kind: string; to_kind: string; to_product_id?: string | null;
}

export interface FilterResult {
  pages: number;
  indexable: number;
  extraPaths: string[];
  links: FilterLink[];
}

export const FILTER_CSS = `
.fl-facets{display:flex;flex-wrap:wrap;gap:.5rem;margin:.75rem 0 1.25rem;list-style:none;padding:0}
.fl-facets li{border:1px solid rgba(0,0,0,.12);border-radius:999px;padding:.25rem .8rem;font-size:.85rem}
.fl-count{font-size:.92rem;opacity:.75;margin:.25rem 0 1rem}
.fl-adv{margin:1.5rem 0;padding-left:1.1rem}
.fl-siblings{margin:2rem 0;font-size:.92rem}
.fl-siblings a{margin-right:.9rem;display:inline-block}
`;

function money(price: number | string | null, currency: string | null, lang: string): string {
  if (price === null || price === undefined || price === "") return "";
  const n = Number(price);
  if (!Number.isFinite(n)) return "";
  const cur = (currency || "RUB").toUpperCase();
  const formatted = n.toLocaleString(lang === "en" ? "en-US" : "ru-RU");
  if (cur === "USD") return `$${formatted}`;
  return `${formatted}${cur === "RUB" ? " руб." : ` ${cur}`}`;
}

function card(p: ProductRow, href: string, lang: string): string {
  const img = (p.images || [])[0];
  const price = money(p.price, p.currency, lang);
  return `<li class="cm-card"><a href="${escHtml(href)}">
${img ? `<img src="${escHtml(img)}" alt="${escHtml(p.name)}" loading="lazy" width="400" height="300">` : ""}
<span class="cm-card__body"><span class="cm-card__title">${escHtml(p.name)}</span>${
    price ? `<span class="cm-card__price">${escHtml(price)}</span>` : ""}</span></a></li>`;
}

export function applyFilterLayer(opts: {
  chrome: SiteChrome;
  files: Record<string, string>;
  pages: FilterPageRow[];
  productsById: Map<string, ProductRow>;
  pathByProductId: Map<string, string>;
  clusterNameById: Map<string, string>;
  siloCrumbByClusterId?: Map<string, { label: string; href: string }>;
}): FilterResult {
  const { chrome, files } = opts;
  const lang = chrome.lang === "en" ? "en" : "ru";
  const t = (ru: string, en: string) => (lang === "en" ? en : ru);
  const extraPaths: string[] = [];
  const links: FilterLink[] = [];
  let rendered = 0;
  let indexable = 0;

  // Sibling navigation inside one category (max 8 links, keeps the graph sane).
  const byCluster = new Map<string, FilterPageRow[]>();
  for (const p of opts.pages) {
    const k = String(p.cluster_id || "");
    byCluster.set(k, [...(byCluster.get(k) || []), p]);
  }

  for (const page of opts.pages) {
    const path = String(page.url_path || "");
    if (!path.startsWith("/")) continue;
    const key = pathToFileKey(path);
    if (files[key]) continue; // never overwrite a real registry page

    const items = (page.product_ids || [])
      .map((id) => opts.productsById.get(String(id)))
      .filter(Boolean) as ProductRow[];
    if (!items.length) continue;

    const clusterName = opts.cluster_id_name(page) || "";
    const categoryHref = page.cluster_path || "/catalog/";
    const crumbSilo = page.cluster_id ? opts.siloCrumbByClusterId?.get(page.cluster_id) : undefined;
    const crumbs = [
      { label: t("Главная", "Home"), href: "/" },
      ...(crumbSilo ? [crumbSilo] : []),
      ...(clusterName ? [{ label: clusterName, href: categoryHref }] : []),
      { label: page.h1 || page.title },
    ];

    const sc = page.seo_content || {};
    const facets = page.facets || [];
    const h1 = page.h1 || page.title;

    const grid = `<ul class="cm-grid">${items
      .slice(0, 120)
      .map((p) => card(p, opts.pathByProductId.get(p.id) || `${categoryHref}${p.slug || ""}`, lang))
      .join("")}</ul>`;

    const siblings = (byCluster.get(String(page.cluster_id || "")) || [])
      .filter((s) => s.url_path !== path && s.indexable)
      .slice(0, 8);

    const body = `<nav class="cm-crumbs" aria-label="breadcrumb"><ol>${
      crumbs.map((c: any) => (c.href
        ? `<li><a href="${escHtml(c.href)}">${escHtml(c.label)}</a></li>`
        : `<li aria-current="page">${escHtml(c.label)}</li>`)).join("")
    }</ol></nav>
<h1>${escHtml(h1)}</h1>
${facets.length ? `<ul class="fl-facets">${facets.map((f) =>
  `<li>${escHtml(f.attribute)}: ${escHtml(f.value)}</li>`).join("")}</ul>` : ""}
${sc.intro ? `<p class="lead">${escHtml(sc.intro)}</p>` : ""}
<p class="fl-count">${escHtml(t(`Позиций в подборке: ${items.length}`, `Items in this selection: ${items.length}`))}</p>
${grid}
${Array.isArray(sc.advantages) && sc.advantages.length
      ? `<section><h2>${escHtml(t("Преимущества", "Advantages"))}</h2><ul class="fl-adv">${
        sc.advantages.map((a) => `<li>${escHtml(a)}</li>`).join("")}</ul></section>`
      : ""}
${Array.isArray(sc.faq) && sc.faq.length
      ? `<section><h2>${escHtml(t("Частые вопросы", "FAQ"))}</h2>${
        sc.faq.map((f) => `<h3>${escHtml(f.q)}</h3><p>${escHtml(f.a)}</p>`).join("")}</section>`
      : ""}
<p class="cm-up"><a href="${escHtml(categoryHref)}">${escHtml(t("Вернуться в раздел", "Back to category"))}</a></p>
${siblings.length ? `<nav class="fl-siblings"><strong>${escHtml(t("Смотрите также", "See also"))}:</strong> ${
      siblings.map((s) => `<a href="${escHtml(s.url_path)}">${escHtml(s.h1 || s.title)}</a>`).join("")}</nav>` : ""}`;

    const itemListLd = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: h1,
      numberOfItems: items.length,
      itemListElement: items.slice(0, 50).map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: p.name,
        url: getCanonicalUrl(chrome.domain, opts.pathByProductId.get(p.id) || categoryHref),
      })),
    } as Record<string, unknown>;

    const breadcrumbLd = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c: any, i: number) => ({
        "@type": "ListItem", position: i + 1, name: c.label,
        ...(c.href ? { item: getCanonicalUrl(chrome.domain, c.href) } : {}),
      })),
    } as Record<string, unknown>;

    const faqLd = Array.isArray(sc.faq) && sc.faq.length
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: sc.faq.map((f) => ({
            "@type": "Question", name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        } as Record<string, unknown>
      : null;

    const canonical = String(page.canonical || path);
    const meta: PageMeta = {
      title: (page.title || h1).slice(0, 65),
      description: (sc.intro
        || t(`${h1}. Подборка из ${items.length} позиций с ценами и характеристиками.`,
             `${h1}. ${items.length} items with prices and specs.`)).replace(/\s+/g, " ").slice(0, 158),
      path,
      canonicalPath: canonical,
      type: "website",
      noIndex: !page.indexable,
      breadcrumbs: crumbs.map((c: any) => ({ label: c.label, href: c.href || path })),
      jsonLd: [itemListLd, breadcrumbLd, faqLd].filter(Boolean) as Record<string, unknown>[],
    };

    files[key] = wrapPage(chrome, meta, body);
    rendered++;
    if (page.indexable) { indexable++; extraPaths.push(path); }

    links.push({
      from_path: path, to_path: categoryHref, anchor: clusterName || t("Раздел", "Category"),
      type: "navigation", from_kind: "filter", to_kind: "category",
    });
    for (const p of items.slice(0, 60)) {
      const to = opts.pathByProductId.get(p.id);
      if (!to) continue;
      links.push({
        from_path: path, to_path: to, anchor: p.name, type: "listing",
        from_kind: "filter", to_kind: "product", to_product_id: p.id,
      });
    }
  }

  if (rendered) files["style.css"] = (files["style.css"] || "") + "\n" + FILTER_CSS;

  return { pages: rendered, indexable, extraPaths, links };
}
