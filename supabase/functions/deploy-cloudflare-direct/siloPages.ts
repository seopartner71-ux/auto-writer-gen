// SILO layer for the Site Factory bundle.
//
// Runs AFTER the existing renderers produced `files`. It never touches a
// project whose url_scheme is "legacy" - the caller only invokes it for
// url_scheme = "silo". For a SILO project it:
//   1. moves every article page to its stable /{silo}/{cluster}/{slug}.html path
//      (leaving a canonical redirect stub at the old /posts/ path),
//   2. renders hub (/{silo}/) and cluster (/{silo}/{cluster}/) pages,
//   3. rewrites internal links + canonical/og URLs onto the new paths,
//   4. injects real breadcrumbs and cluster-aware related blocks,
//   5. returns the extra paths for the sitemap.

import { SiteChrome, PageMeta, wrapPage, escHtml } from "./seoChrome.ts";
import {
  getPageUrl, getSiloUrl, getClusterUrl, getCanonicalUrl, pathToFileKey, slugifyPath,
} from "../_shared/siloUrl.ts";
import { asSeoContent, introHtml, bodyHtml, faqHtml, faqLd, entitiesHtml } from "./contentBlocks.ts";

export interface SiloRow {
  id: string; name: string; slug: string; description: string | null;
  position: number; hub_article_id: string | null; seo_content?: unknown;
}
export interface ClusterRow {
  id: string; silo_id: string; parent_id: string | null; name: string; slug: string;
  description: string | null; position: number; type: string; hub_article_id: string | null;
  seo_content?: unknown;
}
export interface SiloPage {
  articleId: string; title: string; slug: string; excerpt: string;
  urlPath: string | null; siloId: string | null; clusterId: string | null;
  publishedAt?: string; modifiedAt?: string; featuredImageUrl?: string;
}

export interface SiloApplyResult {
  files: Record<string, string>;
  /** Extra sitemap paths: hubs + clusters. */
  extraPaths: string[];
  /** Final path per article slug (used for the sitemap + persistence). */
  pathBySlug: Map<string, string>;
  pathByArticleId: Map<string, string>;
  hubs: number;
  clusters: number;
  moved: number;
}

function parentChain(cluster: ClusterRow, byId: Map<string, ClusterRow>): string[] {
  const out: string[] = [];
  let cur = cluster.parent_id ? byId.get(cluster.parent_id) : undefined;
  let guard = 0;
  while (cur && guard++ < 5) {
    out.unshift(cur.slug);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out;
}

function cardHtml(title: string, href: string, text: string): string {
  return `<li class="silo-card"><a href="${escHtml(href)}"><span class="silo-card__title">${escHtml(title)}</span>${
    text ? `<span class="silo-card__text">${escHtml(text)}</span>` : ""
  }</a></li>`;
}

export const SILO_CSS = `
.silo-grid{list-style:none;padding:0;margin:1.5rem 0;display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.silo-card a{display:block;padding:1rem 1.1rem;border:1px solid rgba(0,0,0,.1);border-radius:10px;text-decoration:none;height:100%}
.silo-card__title{display:block;font-weight:600;margin-bottom:.35rem}
.silo-card__text{display:block;font-size:.9rem;opacity:.75}
.silo-related{margin-top:2.5rem}
.silo-related h2{font-size:1.25rem;margin-bottom:.75rem}
`;

export function applySiloLayer(opts: {
  chrome: SiteChrome;
  silos: SiloRow[];
  clusters: ClusterRow[];
  pages: SiloPage[];
  files: Record<string, string>;
  crossSiloLimit?: number;
}): SiloApplyResult {
  const { chrome, files } = opts;
  const lang = chrome.lang === "en" ? "en" : "ru";
  const t = (ru: string, en: string) => (lang === "en" ? en : ru);

  const silos = [...opts.silos].sort((a, b) => a.position - b.position);
  const clusterById = new Map(opts.clusters.map((c) => [c.id, c]));
  const siloById = new Map(silos.map((s) => [s.id, s]));
  for (const s of silos) registerSiloSlug(s.id, s.slug);

  // ---- 1. resolve a stable path for every article -------------------------
  const pathByArticleId = new Map<string, string>();
  const pathBySlug = new Map<string, string>();
  for (const p of opts.pages) {
    const cluster = p.clusterId ? clusterById.get(p.clusterId) : undefined;
    const silo = cluster ? siloById.get(cluster.silo_id) : (p.siloId ? siloById.get(p.siloId) : undefined);
    const path = getPageUrl({
      scheme: "silo",
      slug: p.slug,
      urlPath: p.urlPath,
      silo: silo ? { slug: silo.slug } : null,
      cluster: cluster && silo
        ? { slug: cluster.slug, siloSlug: silo.slug, parentSlugs: parentChain(cluster, clusterById) }
        : null,
    });
    pathByArticleId.set(p.articleId, path);
    pathBySlug.set(p.slug.toLowerCase(), path);
  }

  // ---- 2. move article pages + rewrite links ------------------------------
  let moved = 0;
  const legacyToNew: [string, string][] = [];
  for (const p of opts.pages) {
    const newPath = pathByArticleId.get(p.articleId)!;
    const legacyPath = `/posts/${p.slug}.html`;
    if (newPath !== legacyPath) legacyToNew.push([legacyPath, newPath]);
  }

  for (const p of opts.pages) {
    const legacyKey = `posts/${p.slug}.html`;
    const html = files[legacyKey];
    if (!html) continue;
    const newPath = pathByArticleId.get(p.articleId)!;
    const newKey = pathToFileKey(newPath);
    if (newKey === legacyKey) continue;

    let out = html;
    // canonical / og:url / any absolute or relative legacy path anywhere
    for (const [from, to] of legacyToNew) {
      out = out.split(getCanonicalUrl(chrome.domain, from)).join(getCanonicalUrl(chrome.domain, to));
      out = out.split(`"${from}"`).join(`"${to}"`);
      out = out.split(`'${from}'`).join(`'${to}'`);
    }
    out = injectBreadcrumbs(out, chrome, p, clusterById, siloById, pathByArticleId);
    out = injectRelated(out, chrome, p, opts.pages, pathByArticleId, clusterById, t);

    files[newKey] = out;
    files[legacyKey] = redirectStub(chrome, newPath, p.title);
    moved++;
  }

  // ---- 3. hub + cluster pages ---------------------------------------------
  const extraPaths: string[] = [];
  let hubCount = 0, clusterCount = 0;

  for (const silo of silos) {
    const siloPath = getSiloUrl({ slug: silo.slug });
    const siloClusters = opts.clusters
      .filter((c) => c.silo_id === silo.id && !c.parent_id)
      .sort((a, b) => a.position - b.position);
    const directPages = opts.pages.filter((p) => p.siloId === silo.id && !p.clusterId);

    const crumbs = [
      { label: t("Главная", "Home"), href: "/" },
      { label: silo.name, href: siloPath },
    ];
    const ssc = asSeoContent(silo.seo_content);
    const body = `
      <h1>${escHtml(ssc?.h1 || silo.name)}</h1>
      ${ssc ? introHtml(ssc) : (silo.description ? `<p class="lead">${escHtml(silo.description)}</p>` : "")}
      ${siloClusters.length
        ? `<h2>${escHtml(t("Разделы", "Sections"))}</h2><ul class="silo-grid">${
            siloClusters.map((c) => cardHtml(
              c.name,
              getClusterUrl({ slug: c.slug, siloSlug: silo.slug, parentSlugs: parentChain(c, clusterById) }),
              c.description || "",
            )).join("")
          }</ul>`
        : ""}
      ${directPages.length
        ? `<h2>${escHtml(t("Материалы", "Articles"))}</h2><ul class="silo-grid">${
            directPages.map((p) => cardHtml(p.title, pathByArticleId.get(p.articleId)!, p.excerpt)).join("")
          }</ul>`
        : ""}
      ${bodyHtml(ssc)}
      ${faqHtml(ssc, t("Частые вопросы", "FAQ"))}
      ${entitiesHtml(ssc, t("Связанные понятия", "Related entities"))}`;
    const meta: PageMeta = {
      title: ssc?.seo_title || `${silo.name} - ${chrome.siteName}`,
      description: ssc?.seo_description || silo.description || `${silo.name}: ${chrome.siteAbout}`,
      path: siloPath,
      type: "website",
      breadcrumbs: crumbs,
      jsonLd: [collectionLd(chrome, silo.name, siloPath, [
        ...siloClusters.map((c) => getClusterUrl({ slug: c.slug, siloSlug: silo.slug, parentSlugs: parentChain(c, clusterById) })),
        ...directPages.map((p) => pathByArticleId.get(p.articleId)!),
      ]), faqLd(ssc)].filter(Boolean) as Record<string, unknown>[],
    };
    files[pathToFileKey(siloPath)] = wrapPage(chrome, meta, body);
    extraPaths.push(siloPath);
    hubCount++;

    for (const cl of opts.clusters.filter((c) => c.silo_id === silo.id).sort((a, b) => a.position - b.position)) {
      const clPath = getClusterUrl({ slug: cl.slug, siloSlug: silo.slug, parentSlugs: parentChain(cl, clusterById) });
      const children = opts.pages.filter((p) => p.clusterId === cl.id);
      const subClusters = opts.clusters.filter((c) => c.parent_id === cl.id).sort((a, b) => a.position - b.position);
      const clCrumbs = [
        { label: t("Главная", "Home"), href: "/" },
        { label: silo.name, href: siloPath },
        ...parentChain(cl, clusterById).map((s) => {
          const parent = opts.clusters.find((x) => x.slug === s && x.silo_id === silo.id)!;
          return {
            label: parent?.name || s,
            href: getClusterUrl({ slug: s, siloSlug: silo.slug, parentSlugs: parentChain(parent, clusterById) }),
          };
        }),
        { label: cl.name, href: clPath },
      ];
      const csc = asSeoContent(cl.seo_content);
      const clBody = `
        <h1>${escHtml(csc?.h1 || cl.name)}</h1>
        ${csc ? introHtml(csc) : (cl.description ? `<p class="lead">${escHtml(cl.description)}</p>` : "")}
        ${subClusters.length
          ? `<ul class="silo-grid">${subClusters.map((c) => cardHtml(
              c.name,
              getClusterUrl({ slug: c.slug, siloSlug: silo.slug, parentSlugs: parentChain(c, clusterById) }),
              c.description || "",
            )).join("")}</ul>`
          : ""}
        ${children.length
          ? `<ul class="silo-grid">${children.map((p) => cardHtml(p.title, pathByArticleId.get(p.articleId)!, p.excerpt)).join("")}</ul>`
          : (csc ? "" : `<p>${escHtml(t("Материалы готовятся.", "Content is on the way."))}</p>`)}
        ${bodyHtml(csc)}
        ${faqHtml(csc, t("Частые вопросы", "FAQ"))}
        <p><a href="${escHtml(siloPath)}">&larr; ${escHtml(silo.name)}</a></p>`;
      const clMeta: PageMeta = {
        title: csc?.seo_title || `${cl.name} - ${silo.name} - ${chrome.siteName}`,
        description: csc?.seo_description || cl.description || `${cl.name}: ${silo.name}`,
        path: clPath,
        type: "website",
        breadcrumbs: clCrumbs,
        jsonLd: [collectionLd(chrome, cl.name, clPath, children.map((p) => pathByArticleId.get(p.articleId)!)), faqLd(csc)]
          .filter(Boolean) as Record<string, unknown>[],
      };
      files[pathToFileKey(clPath)] = wrapPage(chrome, clMeta, clBody);
      extraPaths.push(clPath);
      clusterCount++;
    }
  }

  files["style.css"] = (files["style.css"] || "") + "\n" + SILO_CSS;

  return {
    files, extraPaths, pathBySlug, pathByArticleId,
    hubs: hubCount, clusters: clusterCount, moved,
  };
}

function collectionLd(c: SiteChrome, name: string, path: string, itemPaths: string[]) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    url: getCanonicalUrl(c.domain, path),
    isPartOf: { "@type": "WebSite", name: c.siteName, url: getCanonicalUrl(c.domain, "/") },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: itemPaths.map((p, i) => ({
        "@type": "ListItem", position: i + 1, url: getCanonicalUrl(c.domain, p),
      })),
    },
  } as Record<string, unknown>;
}

function redirectStub(c: SiteChrome, newPath: string, title: string): string {
  const abs = getCanonicalUrl(c.domain, newPath);
  return `<!DOCTYPE html>
<html lang="${escHtml(c.lang)}">
<head>
<meta charset="UTF-8">
<title>${escHtml(title)}</title>
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="${escHtml(abs)}">
<meta http-equiv="refresh" content="0;url=${escHtml(newPath)}">
</head>
<body><p><a href="${escHtml(newPath)}">${escHtml(title)}</a></p></body>
</html>`;
}

function injectBreadcrumbs(
  html: string,
  c: SiteChrome,
  page: SiloPage,
  clusterById: Map<string, ClusterRow>,
  siloById: Map<string, SiloRow>,
  _paths: Map<string, string>,
): string {
  const cluster = page.clusterId ? clusterById.get(page.clusterId) : undefined;
  const silo = cluster ? siloById.get(cluster.silo_id) : (page.siloId ? siloById.get(page.siloId) : undefined);
  if (!silo) return html;
  const lang = c.lang === "en" ? "en" : "ru";
  const items = [
    { label: lang === "en" ? "Home" : "Главная", href: "/" },
    { label: silo.name, href: getSiloUrl({ slug: silo.slug }) },
  ];
  if (cluster) {
    items.push({
      label: cluster.name,
      href: getClusterUrl({ slug: cluster.slug, siloSlug: silo.slug, parentSlugs: [] }),
    });
  }
  items.push({ label: page.title, href: "" });

  const nav = `<nav class="breadcrumbs silo-breadcrumbs" aria-label="breadcrumb"><ol>${
    items.map((it, i) => (it.href
      ? `<li><a href="${escHtml(it.href)}">${escHtml(it.label)}</a></li>`
      : `<li aria-current="page">${escHtml(it.label)}</li>`) + (i < items.length - 1 ? "" : "")).join("")
  }</ol></nav>`;
  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.label,
      ...(it.href ? { item: getCanonicalUrl(c.domain, it.href) } : {}),
    })),
  };
  let out = html.replace(/<\/head>/i,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n</head>`);
  const mainMatch = out.match(/<main[^>]*>/i);
  if (mainMatch) {
    out = out.replace(mainMatch[0], `${mainMatch[0]}${nav}`);
  }
  return out;
}

function injectRelated(
  html: string,
  _c: SiteChrome,
  page: SiloPage,
  all: SiloPage[],
  paths: Map<string, string>,
  clusterById: Map<string, ClusterRow>,
  t: (ru: string, en: string) => string,
): string {
  const cluster = page.clusterId ? clusterById.get(page.clusterId) : undefined;
  const sameCluster = all.filter((p) => p.articleId !== page.articleId && p.clusterId && p.clusterId === page.clusterId);
  const sameSilo = all.filter((p) =>
    p.articleId !== page.articleId && p.siloId && p.siloId === page.siloId && p.clusterId !== page.clusterId);
  const crossSilo = all.filter((p) => p.articleId !== page.articleId && p.siloId !== page.siloId);
  const picked = [...sameCluster, ...sameSilo, ...crossSilo.slice(0, 1)].slice(0, 4);
  if (!picked.length) return html;
  const block = `<section class="silo-related"><h2>${escHtml(t("Читайте также в этом разделе", "More in this section"))}</h2>
<ul class="silo-grid">${picked.map((p) => cardHtml(p.title, paths.get(p.articleId)!, p.excerpt)).join("")}</ul>
${cluster ? `<p><a href="${escHtml(paths.get(page.articleId) ? getClusterUrlFromCluster(cluster, clusterById) : "/")}">${escHtml(cluster.name)}</a></p>` : ""}
</section>`;
  return html.replace(/<\/main>/i, `${block}</main>`);
}

const siloSlugCache = new Map<string, string>();
export function registerSiloSlug(siloId: string, slug: string) { siloSlugCache.set(siloId, slug); }
function getClusterUrlFromCluster(cluster: ClusterRow, byId: Map<string, ClusterRow>): string {
  const siloSlug = siloSlugCache.get(cluster.silo_id) || "";
  if (!siloSlug) return "/";
  return getClusterUrl({ slug: cluster.slug, siloSlug, parentSlugs: parentChain(cluster, byId) });
}

export { slugifyPath };
