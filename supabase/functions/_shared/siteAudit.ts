// P7.4 - Shared QA engine for Site Factory bundles.
//
// Used by `site-qa-check` (report) and by `deploy-cloudflare-direct`
// (deployment gate). Pure functions, no DB, no network.

export interface QaIssue {
  level: "critical" | "warning";
  kind: string;
  page: string;
  detail?: string;
}

export interface StructureFacts {
  silos: { id: string; name: string; status?: string }[];
  clusters: { id: string; silo_id: string | null; name: string; status?: string }[];
  products: { id: string; name: string; site_cluster_id: string | null; silo_id: string | null }[];
  /** Commerce Content Engine facts (optional - legacy projects pass nothing). */
  content?: {
    kind: "product" | "service" | "category" | "hub" | "informational" | "article";
    name: string;
    path?: string | null;
    has_content: boolean;
    words: number;
    /** P13: adaptive threshold for this page type. */
    min_words?: number;
    faq: number;
    entities: number;
    semantic_terms: number;
    /** P13: 0-100 share of the page semantics actually present in the text. */
    coverage?: number;
    /** P13: 0-100 multi-signal content sufficiency (volume is only 30 of it). */
    sufficiency?: number;
    primary_keyword?: string | null;
    /** Hash of the generated body, used to spot copy-paste content. */
    body_hash?: string | null;
    thin?: boolean;
    low_semantic?: boolean;
    intent_ok?: boolean;
  }[];
  keywords?: { keyword: string; target_type?: string | null; target_id?: string | null }[];
}

/** P12 — page_registry snapshot used to prove REGISTRY = BUILD = SITEMAP. */
export interface RegistryFacts {
  active: boolean;
  pages: {
    url_path: string;
    indexable: boolean;
    page_type: string;
    entity_type: string;
    is_system: boolean;
    /** Bundle file key resolved by the builder, null when the page is missing. */
    file_key: string | null;
  }[];
}

export interface QaReport {
  checked_at: string;
  pages: number;
  critical: number;
  warnings: number;
  /** legacy alias for existing UI */
  errors: number;
  score: number;
  ok: boolean;
  pass: boolean;
  issues: QaIssue[];
  counts: Record<string, number>;
}

const ASSET_RE = /\.(css|js|mjs|json|xml|txt|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|pdf|zip|mp4|webm)$/i;

function textOf(html: string, re: RegExp): string {
  const m = html.match(re);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
}

/** Correct meta-robots parsing: only the directive, never the word anywhere. */
export function robotsDirectives(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = tag.match(/\bname\s*=\s*["']?([\w-]+)["']?/i)?.[1]?.toLowerCase();
    if (name !== "robots" && name !== "googlebot" && name !== "yandex") continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] || "";
    for (const d of content.split(",")) {
      const v = d.trim().toLowerCase();
      if (v) out.push(v);
    }
  }
  return out;
}

export function isNoindex(html: string): boolean {
  return robotsDirectives(html).includes("noindex");
}

function jsonLdTypes(html: string): Set<string> {
  const types = new Set<string>();
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const walk = (node: unknown) => {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== "object") return;
        const t = (node as Record<string, unknown>)["@type"];
        if (typeof t === "string") types.add(t);
        if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
        Object.values(node as Record<string, unknown>).forEach(walk);
      };
      walk(parsed);
    } catch { /* malformed JSON-LD is reported separately */ }
  }
  return types;
}

function hasMalformedLd(html: string): boolean {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { JSON.parse(m[1].trim()); } catch { return true; }
  }
  return false;
}

function keyCandidates(href: string): string[] {
  const key = href.replace(/^\//, "").split(/[?#]/)[0];
  return [key, `${key}index.html`, `${key}/index.html`, `${key}.html`];
}

export function auditBundle(
  files: Record<string, string>,
  domain: string,
  structure?: StructureFacts,
  registry?: RegistryFacts,
): QaReport {
  const issues: QaIssue[] = [];
  const allHtml = Object.keys(files).filter((k) => k.endsWith(".html"));
  const pages = allHtml.filter((k) => k !== "404.html");
  const indexable: string[] = [];
  const titles = new Map<string, string[]>();
  const h1s = new Map<string, string[]>();
  const canonicals = new Map<string, string[]>();
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();

  // Public URL form: the host serves `foo.html` at `/foo`, so bundle keys,
  // registry paths, canonical and sitemap are all compared extensionless.
  const pathOf = (key: string) =>
    ("/" + key.replace(/index\.html$/, "")).replace(/\.html$/i, "");

  for (const page of pages) {
    const html = files[page];
    const noindex = isNoindex(html);
    const directives = robotsDirectives(html);
    if (noindex && directives.includes("index")) {
      issues.push({ level: "warning", kind: "robots_conflict", page, detail: directives.join(",") });
    }
    if (noindex) continue; // redirect stubs and intentionally hidden pages
    indexable.push(page);

    const title = textOf(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] || "";
    const heads = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || [];
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] || "";

    if (!title) issues.push({ level: "critical", kind: "missing_title", page });
    else {
      if (title.length > 65) issues.push({ level: "warning", kind: "long_title", page, detail: `${title.length}` });
      const arr = titles.get(title) || []; arr.push(page); titles.set(title, arr);
    }
    if (!desc) issues.push({ level: "critical", kind: "missing_description", page });
    else if (desc.length > 160) issues.push({ level: "warning", kind: "long_description", page, detail: `${desc.length}` });
    if (heads.length === 0) issues.push({ level: "critical", kind: "missing_h1", page });
    if (heads.length > 1) issues.push({ level: "critical", kind: "multiple_h1", page, detail: `${heads.length}` });
    if (heads.length === 1) {
      const text = heads[0].replace(/<[^>]+>/g, "").trim().toLowerCase();
      const arr = h1s.get(text) || []; arr.push(page); h1s.set(text, arr);
    }

    if (!canonical) issues.push({ level: "warning", kind: "missing_canonical", page });
    else {
      if (domain && !canonical.includes(domain)) {
        issues.push({ level: "critical", kind: "foreign_canonical", page, detail: canonical });
      }
      const canonPath = canonical.replace(/^https?:\/\/[^/]+/, "") || "/";
      if (canonPath.replace(/\/$/, "") !== pathOf(page).replace(/\/$/, "")) {
        issues.push({ level: "warning", kind: "canonical_mismatch", page, detail: canonPath });
      }
      const arr = canonicals.get(canonPath) || []; arr.push(page); canonicals.set(canonPath, arr);
    }

    const imgs = html.match(/<img\b[^>]*>/gi) || [];
    const noAlt = imgs.filter((t) => !/\balt=/.test(t)).length;
    if (noAlt) issues.push({ level: "warning", kind: "img_without_alt", page, detail: `${noAlt}` });

    if (hasMalformedLd(html)) issues.push({ level: "warning", kind: "invalid_schema", page });
    const types = jsonLdTypes(html);
    const isProductPage = /schema\.org\/(InStock|OutOfStock)/.test(html) || types.has("Product") || types.has("Service");
    if (isProductPage && !types.has("BreadcrumbList")) {
      issues.push({ level: "warning", kind: "missing_breadcrumb_schema", page });
    }

    let out = 0;
    for (const m of html.matchAll(/href=["'](\/[^"']*)["']/g)) {
      const href = m[1];
      if (ASSET_RE.test(href.split(/[?#]/)[0])) continue;
      const target = keyCandidates(href).find((c) => files[c] !== undefined);
      if (!target) {
        issues.push({ level: "critical", kind: "broken_internal_link", page, detail: href });
        continue;
      }
      out++;
      if (target !== page) inbound.set(target, (inbound.get(target) || 0) + 1);
    }
    outbound.set(page, out);
  }

  for (const [title, list] of titles) {
    if (list.length > 1) issues.push({ level: "warning", kind: "duplicate_title", page: list.slice(0, 5).join(", "), detail: title });
  }
  for (const [text, list] of h1s) {
    if (list.length > 1) issues.push({ level: "warning", kind: "duplicate_h1", page: list.slice(0, 5).join(", "), detail: text.slice(0, 60) });
  }
  for (const [canon, list] of canonicals) {
    if (list.length > 1) issues.push({ level: "critical", kind: "duplicate_canonical", page: list.slice(0, 5).join(", "), detail: canon });
  }

  // orphan pages (no inbound / no outbound), homepage excluded
  for (const page of indexable) {
    if (page === "index.html") continue;
    if (!(inbound.get(page) || 0)) issues.push({ level: "warning", kind: "orphan_page", page });
    if (!(outbound.get(page) || 0)) issues.push({ level: "warning", kind: "page_without_outgoing_links", page });
  }

  // sitemap / robots
  const sitemap = files["sitemap.xml"];
  if (!sitemap) issues.push({ level: "critical", kind: "missing_sitemap", page: "sitemap.xml" });
  else if (!/<urlset|<sitemapindex/.test(sitemap)) {
    issues.push({ level: "critical", kind: "invalid_sitemap", page: "sitemap.xml" });
  } else {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    const locPaths = new Set(locs.map((l) => l.replace(/^https?:\/\/[^/]+/, "") || "/"));
    for (const l of locPaths) {
      if (!keyCandidates(l).some((c) => files[c] !== undefined)) {
        issues.push({ level: "critical", kind: "sitemap_missing_file", page: "sitemap.xml", detail: l });
      }
    }
    for (const page of indexable) {
      const p = pathOf(page);
      if (!locPaths.has(p) && !locPaths.has(p.replace(/\/$/, ""))) {
        issues.push({ level: "warning", kind: "url_not_in_sitemap", page: p });
      }
    }
    for (const page of allHtml) {
      if (indexable.includes(page)) continue;
      const p = pathOf(page);
      if (locPaths.has(p)) issues.push({ level: "warning", kind: "noindex_in_sitemap", page: p });
    }
  }
  if (!files["robots.txt"]) issues.push({ level: "critical", kind: "missing_robots", page: "robots.txt" });

  // ---- P12: registry <-> bundle <-> sitemap <-> canonical consistency -----
  if (registry?.active) {
    const norm = (p: string) =>
      p === "/" ? "/" : p.replace(/\.html$/i, "").replace(/\/$/, "");
    const sm = files["sitemap.xml"] || "";
    const smPaths = new Set(
      [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map((m) => norm(m[1].trim().replace(/^https?:\/\/[^/]+/, "") || "/")),
    );
    const regByPath = new Map<string, RegistryFacts["pages"][number]>();
    for (const r of registry.pages) {
      const key = norm(r.url_path);
      if (regByPath.has(key)) {
        issues.push({ level: "critical", kind: "duplicate_registry_url", page: r.url_path });
        continue;
      }
      regByPath.set(key, r);
    }

    for (const r of registry.pages) {
      const key = norm(r.url_path);
      if (!r.file_key || files[r.file_key] === undefined) {
        if (r.indexable) {
          issues.push({ level: "critical", kind: "registry_page_missing_from_bundle", page: r.url_path });
        }
        continue;
      }
      const noindexFile = isNoindex(String(files[r.file_key]));
      if (r.indexable && !noindexFile && !smPaths.has(key)) {
        issues.push({ level: "critical", kind: "registry_url_missing_sitemap", page: r.url_path });
      }
      if (!r.indexable && smPaths.has(key)) {
        issues.push({ level: "critical", kind: "noindex_in_sitemap", page: r.url_path });
      }
    }

    for (const page of indexable) {
      const key = norm(pathOf(page));
      if (regByPath.has(key)) continue;
      issues.push({ level: "critical", kind: "bundle_indexable_page_missing_registry", page });
    }

    for (const l of smPaths) {
      if (!regByPath.has(l)) {
        issues.push({ level: "critical", kind: "sitemap_url_missing_registry", page: "sitemap.xml", detail: l });
      }
    }

    for (const page of indexable) {
      const html = files[page];
      const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] || "";
      if (!canonical) continue;
      const canonPath = norm(canonical.replace(/^https?:\/\/[^/]+/, "") || "/");
      if (!regByPath.has(canonPath)) {
        issues.push({ level: "critical", kind: "canonical_missing_registry", page, detail: canonPath });
      }
    }
  }

  // structural facts (DB side)
  if (structure) {
    const clusterIds = new Set(structure.clusters.map((c) => c.id));
    const siloIds = new Set(structure.silos.map((s) => s.id));
    for (const p of structure.products) {
      if (!p.site_cluster_id || !clusterIds.has(p.site_cluster_id)) {
        issues.push({ level: "critical", kind: "orphan_product", page: p.name });
      }
    }
    for (const c of structure.clusters) {
      if (!c.silo_id || !siloIds.has(c.silo_id)) {
        issues.push({ level: "critical", kind: "cluster_without_silo", page: c.name });
      }
      const hasChild = structure.products.some((p) => p.site_cluster_id === c.id) ||
        structure.clusters.some((x) => x.silo_id === c.silo_id && x.id !== c.id);
      if (!hasChild) issues.push({ level: "warning", kind: "empty_cluster", page: c.name });
    }
    for (const s of structure.silos) {
      if (!structure.clusters.some((c) => c.silo_id === s.id)) {
        issues.push({ level: "warning", kind: "empty_silo", page: s.name });
      }
    }

    // ---- Commerce Content Engine checks ----------------------------------
    const FAQ_REQUIRED = new Set(["category", "hub", "service"]);
    const byHash = new Map<string, string[]>();
    const byDesc = new Map<string, string[]>();
    for (const c of structure.content || []) {
      const where = c.path || c.name;
      if (!c.has_content) {
        issues.push({ level: "critical", kind: "commercial_page_without_content", page: where });
        continue;
      }
      if (!c.primary_keyword) issues.push({ level: "critical", kind: "page_without_primary_keyword", page: where });
      // P13: thresholds depend on the page type, and volume alone never fails a page.
      const minWords = c.min_words ?? 120;
      if (c.thin ?? c.words < minWords) {
        issues.push({
          level: c.words < minWords * 0.6 ? "critical" : "warning",
          kind: "thin_commercial_content",
          page: where,
          detail: `${c.words}/${minWords} (${c.kind})`,
        });
      }
      if (c.low_semantic ?? c.semantic_terms < 5) {
        issues.push({
          level: "warning",
          kind: "low_semantic_coverage",
          page: where,
          detail: `coverage ${c.coverage ?? 0}%, terms ${c.semantic_terms}`,
        });
      }
      if (c.intent_ok === false) {
        issues.push({ level: "warning", kind: "intent_mismatch", page: where, detail: c.primary_keyword || "" });
      }
      if (!c.entities) issues.push({ level: "warning", kind: "missing_entity_data", page: where });
      if (FAQ_REQUIRED.has(c.kind) && !c.faq) issues.push({ level: "warning", kind: "missing_faq", page: where });
      if (c.body_hash) {
        const arr = byHash.get(c.body_hash) || []; arr.push(where); byHash.set(c.body_hash, arr);
      }
      void byDesc;
    }
    for (const [, list] of byHash) {
      if (list.length > 1) {
        issues.push({ level: "critical", kind: "duplicate_generated_content", page: list.slice(0, 5).join(", "), detail: `${list.length}` });
      }
    }
    for (const k of structure.keywords || []) {
      if (!k.target_type || !k.target_id) {
        issues.push({ level: "warning", kind: "keyword_without_target", page: k.keyword });
      }
    }
    const catsWithKw = new Set((structure.keywords || [])
      .filter((k) => k.target_type === "category" && k.target_id).map((k) => k.target_id));
    if ((structure.keywords || []).length) {
      for (const c of structure.clusters) {
        if (!catsWithKw.has(c.id)) {
          issues.push({ level: "warning", kind: "category_without_semantic_coverage", page: c.name });
        }
      }
    }
  }

  const counts: Record<string, number> = {};
  for (const i of issues) counts[i.kind] = (counts[i.kind] || 0) + 1;
  const critical = issues.filter((i) => i.level === "critical").length;
  const warnings = issues.length - critical;
  const score = Math.max(0, 100 - critical * 6 - warnings * 2);

  return {
    checked_at: new Date().toISOString(),
    pages: pages.length,
    critical,
    warnings,
    errors: critical,
    score,
    ok: critical === 0,
    pass: critical === 0,
    issues: issues.slice(0, 300),
    counts,
  };
}
