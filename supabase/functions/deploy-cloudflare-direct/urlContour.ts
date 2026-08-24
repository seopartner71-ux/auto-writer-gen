// ============================================================================
// URL CONTOUR - single, hosting-consistent public URL form.
//
// Cloudflare Pages serves `foo.html` but 308-redirects every request for
// `/foo.html` to the extensionless `/foo`. Emitting `.html` in canonical,
// sitemap, llms.txt and internal links therefore means every indexable URL is
// a redirect. This pass rewrites the PUBLIC url form to the extensionless one
// the host actually serves. File keys stay `foo.html` (that is the artefact
// the host needs), the registry keeps its file geometry, and siteAudit
// compares both forms through the same normalizer.
//
// No new URL mechanism: only the textual form of already-computed URLs.
// ============================================================================

/** Files whose content must keep the raw `.html` targets. */
const SKIP_FILES = new Set(["_redirects", "_headers", "_routes.json"]);

/** Paths that stay as-is: the host maps them itself. */
const KEEP = /(^|\/)(index|404)\.html$/i;

const TEXT_EXT = /\.(html|xml|txt|json|md)$/i;

function escapeHost(h: string): string {
  return h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips `.html` from internal URL references inside the generated bundle.
 * Only absolute-path (`/x.html`) and same-host (`https://domain/x.html`)
 * references are touched.
 */
export function normalizeCleanUrls(
  files: Record<string, string>,
  domains: string[],
): number {
  const hosts = [...new Set(domains.filter(Boolean).map((d) => escapeHost(d)))];
  const hostAlt = hosts.length ? `(?:https?:\\/\\/(?:${hosts.join("|")}))?` : "";
  const re = new RegExp(
    `(["'(\\s>=])(${hostAlt}\\/[A-Za-z0-9_\\-.\\/%]*?)\\.html(?=["')\\s<>#?])`,
    "g",
  );

  let changed = 0;
  for (const [key, raw] of Object.entries(files)) {
    if (SKIP_FILES.has(key) || !TEXT_EXT.test(key)) continue;
    const text = String(raw ?? "");
    const next = text.replace(re, (full, lead: string, path: string) => {
      if (KEEP.test(`${path}.html`)) return full;
      return `${lead}${path}`;
    });
    if (next !== text) { files[key] = next; changed++; }
  }
  return changed;
}

/** `about.html` -> `/about`, `blog/index.html` -> `/blog/`. */
export function publicPathOfFile(fileKey: string): string {
  const p = "/" + fileKey.replace(/index\.html$/, "");
  return p.replace(/\.html$/i, "");
}

/** Resolves a public path back to the bundle file that serves it. */
export function fileKeyForPublicPath(
  files: Record<string, string>,
  path: string,
): string | null {
  const p = path.replace(/^https?:\/\/[^/]+/, "") || "/";
  const bare = p.replace(/^\//, "");
  const candidates = [
    bare === "" ? "index.html" : "",
    bare,
    `${bare}.html`,
    `${bare.replace(/\/$/, "")}/index.html`,
    `${bare.replace(/\/$/, "")}.html`,
  ].filter(Boolean);
  return candidates.find((c) => files[c] !== undefined) || null;
}

function titleOf(html: string, fallback: string): string {
  const t = (html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t) return t.replace(/\s*[|\u2013\u2014-]\s*[^|\u2013\u2014-]*$/, "").trim() || t;
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "")
    .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return h1 || fallback;
}

/**
 * Rebuilds llms.txt from the FINAL sitemap so the AI index lists exactly the
 * URLs the site publishes. The header (`# name`, `> about`) and the trailing
 * `## About` block of the previously generated file are preserved.
 */
export function rebuildLlmsTxt(
  files: Record<string, string>,
  domain: string,
  lang: string,
): number {
  const sm = String(files["sitemap.xml"] || "");
  if (!sm.includes("<loc>")) return 0;
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (!locs.length) return 0;

  const prev = String(files["llms.txt"] || "");
  const isRu = lang !== "en";
  const head = prev ? prev.split(/\n##\s/)[0].trimEnd() : `# ${domain}`;
  const aboutIdx = prev.search(/\n##\s+(About|О компании)\b/);
  const about = aboutIdx >= 0 ? prev.slice(aboutIdx).trimEnd() : "";

  const pages: string[] = [];
  const posts: string[] = [];
  for (const loc of locs) {
    const path = loc.replace(/^https?:\/\/[^/]+/, "") || "/";
    const key = fileKeyForPublicPath(files, path);
    const fallback = path === "/" ? (isRu ? "Главная" : "Home") : path;
    const title = key ? titleOf(String(files[key]), fallback) : fallback;
    const line = `- [${title}](${loc})`;
    (path.startsWith("/posts/") ? posts : pages).push(line);
  }

  const out: string[] = [head, ""];
  out.push(isRu ? "## Страницы" : "## Pages", ...pages);
  if (posts.length) {
    out.push("", isRu ? "## Статьи блога" : "## Blog posts", ...posts);
  }
  if (about) out.push("", about);
  out.push("");
  files["llms.txt"] = out.join("\n");
  return locs.length;
}
