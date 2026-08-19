// Single source of truth for Site Factory page URLs.
//
// Two schemes coexist:
//   legacy -> /posts/{slug}.html            (every site published before SILO)
//   silo   -> /{silo}/{cluster}/{slug}.html (opt-in per project)
//
// Legacy behaviour is byte-for-byte the old convention: the deploy pipeline
// keeps calling the same helpers and gets the same strings back. Nothing in a
// legacy project changes.

export type UrlScheme = "legacy" | "silo";

export const LEGACY_POST_PATTERN = "/posts/{slug}.html";

const RU_MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Same normalisation the deploy pipeline has always used for post slugs. */
export function slugifyPath(input: string): string {
  const s = String(input || "")
    .toLowerCase()
    .split("")
    .map((c) => RU_MAP[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "page";
}

export function normalizeScheme(value: unknown): UrlScheme {
  return String(value || "legacy") === "silo" ? "silo" : "legacy";
}

export interface SiloRef { slug: string }
export interface ClusterRef {
  slug: string;
  siloSlug: string;
  parentSlugs?: string[];
  /**
   * When true the cluster shares its URL with the silo hub (see
   * `shouldCollapseCluster`) - no /{silo}/{silo}/ duplicate is produced.
   */
  collapse?: boolean;
}

/** Case / "ё" / punctuation insensitive entity key. */
export function entityKey(v: string): string {
  return String(v || "").toLowerCase().replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ").trim();
}

/**
 * A silo hub and its single child category with the same name describe the
 * same entity, so they must share one URL (/{silo}/) instead of producing
 * /{silo}/{silo}/. Only collapses a root-level cluster that is the sole
 * category of its silo.
 */
export function shouldCollapseCluster(
  cluster: { slug: string; name?: string | null; parent_id?: string | null },
  silo: { slug: string; name?: string | null },
  rootClusterCount: number,
): boolean {
  if (cluster.parent_id) return false;
  if (rootClusterCount !== 1) return false;
  const sameSlug = slugifyPath(cluster.slug) === slugifyPath(silo.slug);
  const sameName = !!cluster.name && !!silo.name &&
    entityKey(cluster.name) === entityKey(silo.name);
  return sameSlug || sameName;
}

export function getSiloUrl(silo: SiloRef): string {
  return `/${slugifyPath(silo.slug)}/`;
}

export function getClusterUrl(cluster: ClusterRef): string {
  const parents = (cluster.parentSlugs || []).map(slugifyPath).filter(Boolean);
  if (cluster.collapse && !parents.length) return getSiloUrl({ slug: cluster.siloSlug });
  const parts = [slugifyPath(cluster.siloSlug), ...parents, slugifyPath(cluster.slug)];
  return `/${parts.join("/")}/`;
}

export interface PageUrlInput {
  scheme: UrlScheme;
  slug: string;
  /** Stored canonical path. When present it always wins - URLs must be stable. */
  urlPath?: string | null;
  silo?: SiloRef | null;
  cluster?: ClusterRef | null;
}

export function getPageUrl(inp: PageUrlInput): string {
  if (inp.urlPath && inp.urlPath.startsWith("/")) return inp.urlPath;
  const slug = slugifyPath(inp.slug);
  if (inp.scheme !== "silo") return LEGACY_POST_PATTERN.replace("{slug}", slug);
  if (inp.cluster) return `${getClusterUrl(inp.cluster)}${slug}.html`;
  if (inp.silo) return `${getSiloUrl(inp.silo)}${slug}.html`;
  return LEGACY_POST_PATTERN.replace("{slug}", slug);
}

export function getCanonicalUrl(domain: string, path: string): string {
  const host = String(domain || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `https://${host}${p}`;
}

/**
 * Maps any internal href the model may have produced onto a real page path.
 * Returns null when no real page matches (caller unlinks the anchor).
 */
export function resolveInternalUrl(
  href: string,
  pathBySlug: Map<string, string>,
  aliases?: Map<string, string>,
): string | null {
  const raw = String(href || "").trim();
  if (!raw || /^(https?:)?\/\//i.test(raw) || /^(mailto|tel|#)/i.test(raw)) return null;
  const [pathOnly, query = ""] = raw.split(/(?=[?#])/, 2);
  const m = pathOnly.match(/^\/?(?:posts|blog|articles|post|news)?\/?([^/]+?)(?:\.html?)?\/?$/i);
  if (!m) return null;
  let slug = decodeURIComponent(m[1] || "").toLowerCase();
  if (!pathBySlug.has(slug) && aliases) {
    const alias = aliases.get(slug) || aliases.get(slug.replace(/-/g, ""));
    if (alias) slug = alias;
  }
  const target = pathBySlug.get(slug);
  return target ? `${target}${query || ""}` : null;
}

/** Path -> file key inside the deployment bundle ("/a/b/" -> "a/b/index.html"). */
export function pathToFileKey(path: string): string {
  const p = path.replace(/^\/+/, "");
  return p.endsWith("/") || p === "" ? `${p}index.html` : p;
}
