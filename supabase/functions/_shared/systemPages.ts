// P12 — System pages registry identity.
//
// Structural pages (home, catalog, blog, about, contacts, privacy, terms,
// 404) are produced by the site builder itself, not by the semantic pipeline.
// They still need an identity inside `page_registry` so that
// REGISTRY = BUILD = SITEMAP = CANONICAL holds for every indexable page.
//
// They bypass the PDE decision matrix on purpose: their existence is a
// site-policy fact, not a demand-driven decision.

export type SystemPageKey =
  | "home" | "catalog" | "blog" | "about" | "contacts" | "privacy" | "terms" | "notfound";

export interface SystemPageDef {
  key: SystemPageKey;
  /** page_type stored in page_registry */
  pageType: "system";
  urlPath: string;
  /** Bundle file key produced by the builder. */
  fileKey: string;
  indexable: boolean;
  inSitemap: boolean;
  priority: string;
  title: string;
}

export const SYSTEM_PAGES: SystemPageDef[] = [
  { key: "home",     pageType: "system", urlPath: "/",              fileKey: "index.html",         indexable: true,  inSitemap: true,  priority: "1.0", title: "Главная" },
  { key: "catalog",  pageType: "system", urlPath: "/catalog/",      fileKey: "catalog/index.html", indexable: true,  inSitemap: true,  priority: "0.9", title: "Каталог" },
  { key: "blog",     pageType: "system", urlPath: "/blog/",         fileKey: "blog/index.html",    indexable: true,  inSitemap: true,  priority: "0.8", title: "Блог" },
  { key: "about",    pageType: "system", urlPath: "/about.html",    fileKey: "about.html",         indexable: true,  inSitemap: true,  priority: "0.8", title: "О компании" },
  { key: "contacts", pageType: "system", urlPath: "/contacts.html", fileKey: "contacts.html",      indexable: true,  inSitemap: true,  priority: "0.7", title: "Контакты" },
  { key: "privacy",  pageType: "system", urlPath: "/privacy.html",  fileKey: "privacy.html",       indexable: true,  inSitemap: true,  priority: "0.3", title: "Политика конфиденциальности" },
  { key: "terms",    pageType: "system", urlPath: "/terms.html",    fileKey: "terms.html",         indexable: true,  inSitemap: true,  priority: "0.3", title: "Условия использования" },
  // 404 is the documented exception: rendered, noindex, never in the sitemap.
  { key: "notfound", pageType: "system", urlPath: "/404.html",      fileKey: "404.html",           indexable: false, inSitemap: false, priority: "0.0", title: "Страница не найдена" },
];

export const SYSTEM_PAGE_BY_KEY: Record<string, SystemPageDef> =
  Object.fromEntries(SYSTEM_PAGES.map((p) => [p.key, p]));

export function systemPageByFile(fileKey: string): SystemPageDef | undefined {
  return SYSTEM_PAGES.find((p) => p.fileKey === fileKey);
}

/**
 * Deterministic UUID (v5-style, SHA-1 based) for a system page of a project.
 * page_registry.entity_id is a NOT NULL uuid and system pages have no row of
 * their own anywhere else, so the id is derived from (project_id, key).
 */
export async function systemEntityId(projectId: string, key: SystemPageKey): Promise<string> {
  const data = new TextEncoder().encode(`page_registry:system:${projectId}:${key}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", data));
  const b = digest.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Bundle file key candidates for a registry url_path. */
export function fileCandidates(urlPath: string): string[] {
  const clean = String(urlPath || "/").split(/[?#]/)[0];
  const key = clean.replace(/^\/+/, "");
  if (key === "" ) return ["index.html"];
  if (key.endsWith("/")) return [`${key}index.html`];
  return [key, `${key}/index.html`, `${key}.html`];
}

/** Normalised site path for a bundle file key ("catalog/index.html" -> "/catalog/"). */
export function pathOfFile(fileKey: string): string {
  return "/" + fileKey.replace(/index\.html$/, "");
}