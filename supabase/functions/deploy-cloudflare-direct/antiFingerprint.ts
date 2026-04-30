// ============================================================================
// PBN anti-fingerprint post-processor.
//
// All transforms are DETERMINISTIC from a per-project seed: re-deploys of the
// same project produce byte-identical output, but different projects look
// structurally distinct to fingerprint scanners.
//
// Three transforms (Stage 1):
//   1. obfuscateClasses(html, css, seed)  — rename CSS classes to 5-char hashes
//   2. shuffleSections(html, seed)        — permute middle <section> blocks
//   3. shuffleMetaTags(html, seed)        — permute og:/twitter: meta order
//
// An ALLOWLIST of class names is preserved verbatim because external parsers
// (Speakable JSON-LD, our own server-side regex parsers, AI search engines,
// article reader-mode extractors) rely on them.
// ============================================================================

// ----------------------------- Deterministic RNG ----------------------------

function fnv1a(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic shuffler from seed. */
function seededShuffle<T>(arr: T[], seed: string): T[] {
  const a = arr.slice();
  let s = fnv1a(seed) || 1;
  for (let i = a.length - 1; i > 0; i--) {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ----------------------------- Class obfuscation ----------------------------

/** Classes that MUST stay readable (parsers/JSON-LD/external reader rely on them). */
const CLASS_ALLOWLIST = new Set<string>([
  // Article body / reader-mode signals
  "ai-summary", "md-table", "page-article", "entry-content",
  "post-content", "prose", "article-body",
  // Business pages structural anchors used by server-side parsers
  "bp-pricing-table", "bp-faq", "bp-pricing",
  // Microformats / structured data
  "h-entry", "p-name", "e-content", "u-url", "dt-published",
  "p-author", "h-card", "p-summary",
  // Common semantic helpers we explicitly want crawlers to read
  "breadcrumb", "breadcrumbs",
]);

/** Class prefixes that must stay readable (e.g. all `bp-*` business-page hooks). */
const CLASS_PREFIX_ALLOWLIST = ["bp-", "ai-", "md-", "schema-", "microformat-"];

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const ALPHANUM = "abcdefghijklmnopqrstuvwxyz0123456789";

function isAllowedClass(name: string): boolean {
  if (CLASS_ALLOWLIST.has(name)) return true;
  for (const p of CLASS_PREFIX_ALLOWLIST) if (name.startsWith(p)) return true;
  return false;
}

/** Generate a deterministic 5-char obfuscated name from (seed, original). */
function hashClass(name: string, seed: string): string {
  const h = fnv1a(seed + ":" + name);
  // First char must be a letter (CSS ident rule).
  let out = ALPHABET[h % ALPHABET.length];
  let n = (h / ALPHABET.length) >>> 0;
  for (let i = 0; i < 4; i++) {
    out += ALPHANUM[n % ALPHANUM.length];
    n = (n / ALPHANUM.length) >>> 0;
  }
  return out;
}

/**
 * Build a stable rename map for every class found in the given CSS sources.
 * Collisions (two different originals hashing to the same obfuscated name)
 * are resolved by appending a numeric suffix.
 */
function buildRenameMap(cssSources: string[], seed: string): Map<string, string> {
  const found = new Set<string>();
  // CSS class selector: .name (escapes ignored — we don't generate any).
  const re = /\.([a-zA-Z_][a-zA-Z0-9_-]*)/g;
  for (const css of cssSources) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
      const n = m[1];
      if (!isAllowedClass(n)) found.add(n);
    }
  }
  const map = new Map<string, string>();
  const used = new Set<string>();
  // Sort for determinism (Set iteration order is insertion-based, but sort
  // makes the algorithm independent of CSS author order across files).
  const sorted = Array.from(found).sort();
  for (const orig of sorted) {
    let candidate = hashClass(orig, seed);
    let suffix = 0;
    while (used.has(candidate)) {
      suffix++;
      candidate = hashClass(orig + "#" + suffix, seed);
    }
    used.add(candidate);
    map.set(orig, candidate);
  }
  return map;
}

/** Replace classes inside CSS source. */
function rewriteCss(css: string, map: Map<string, string>): string {
  return css.replace(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g, (m, name) => {
    const r = map.get(name);
    return r ? "." + r : m;
  });
}

/** Replace classes inside an HTML attribute string ("a b c" -> "x y c"). */
function rewriteClassAttr(value: string, map: Map<string, string>): string {
  return value.split(/\s+/).filter(Boolean).map((n) => map.get(n) || n).join(" ");
}

/** Replace `class="..."` and `class='...'` attributes inside HTML. */
function rewriteHtmlClassAttrs(html: string, map: Map<string, string>): string {
  return html.replace(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/g, (_m, _q, dq, sq) => {
    const v = dq != null ? dq : sq;
    return ` class="${rewriteClassAttr(v, map)}"`;
  });
}

/**
 * Walks an HTML document, rewrites ALL inline <style> blocks with the rename
 * map, then rewrites every class="" attribute in the surrounding HTML.
 * Pass `extraCss` to also accumulate class names from external CSS files
 * (e.g. style.css) so that selectors stay in sync.
 */
export function obfuscateClassesInHtml(
  html: string,
  seed: string,
  extraCss: string = "",
): { html: string; map: Map<string, string> } {
  // 1. Collect CSS sources: all <style> blocks + extraCss.
  const styleBlocks: string[] = [];
  html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, body) => {
    styleBlocks.push(body);
    return _m;
  });
  const map = buildRenameMap([...styleBlocks, extraCss], seed);
  if (map.size === 0) return { html, map };

  // 2. Rewrite each <style> block.
  let out = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_m, attrs, body) => {
    return `<style${attrs}>${rewriteCss(body, map)}</style>`;
  });

  // 3. Rewrite class="" attributes in the surrounding HTML.
  out = rewriteHtmlClassAttrs(out, map);

  return { html: out, map };
}

/** Apply an existing rename map to a CSS file. */
export function obfuscateCssFile(css: string, map: Map<string, string>): string {
  return rewriteCss(css, map);
}

/** Apply an existing rename map to an HTML page (no <style> processing here). */
export function obfuscateHtmlWithMap(html: string, map: Map<string, string>): string {
  // Rewrite both inline <style> blocks AND class attributes.
  let out = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_m, attrs, body) => {
    return `<style${attrs}>${rewriteCss(body, map)}</style>`;
  });
  out = rewriteHtmlClassAttrs(out, map);
  return out;
}

// ----------------------------- Section shuffling ----------------------------

/**
 * Find every top-level <section ...id="..."> ... </section> block on the home
 * page and reorder a fixed subset deterministically.
 *
 * Pinned (untouched):
 *   - .hero (always first; rendered as <section class="hero"> without id)
 *   - #cta  (always near end)
 *   - #map, #contacts (always after CTA)
 *
 * Shuffled middle: stats, why, services, process, team, guarantee,
 *                  testimonials, blog, about
 */
const SHUFFLE_IDS = [
  "stats", "why", "services", "process", "team",
  "guarantee", "testimonials", "blog", "about",
];

export function shuffleHomeSections(html: string, seed: string): string {
  // Match <section ...> ... </section> non-greedy at top level. The landing
  // page is generated flat (no nested <section>), so this is safe.
  const sectionRe = /<section\b[^>]*>[\s\S]*?<\/section>/gi;
  // Capture id attribute when present.
  const idRe = /\sid\s*=\s*("([^"]*)"|'([^']*)')/i;

  // Collect all sections with positions.
  const matches: { start: number; end: number; id: string; html: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(html)) !== null) {
    const blockHtml = m[0];
    const idm = idRe.exec(blockHtml);
    const id = idm ? (idm[2] ?? idm[3] ?? "") : "";
    matches.push({ start: m.index, end: m.index + blockHtml.length, id, html: blockHtml });
  }
  if (matches.length === 0) return html;

  // Bucket: indices in `matches` we want to shuffle, in source order.
  const shuffleIdxList = matches
    .map((sec, i) => ({ i, id: sec.id }))
    .filter((x) => SHUFFLE_IDS.includes(x.id));
  if (shuffleIdxList.length < 2) return html;

  const shuffledOrder = seededShuffle(shuffleIdxList.map((x) => x.id), seed);
  // Map: original-id -> new-html-block-from-section-with-that-id
  // (since each id is unique, we just permute by id list).
  const idToHtml = new Map<string, string>();
  for (const x of shuffleIdxList) {
    idToHtml.set(x.id, matches[x.i].html);
  }
  const newOrderedBlocks = shuffledOrder.map((id) => idToHtml.get(id)!);

  // Rebuild html: walk matches; whenever we hit a shuffle slot, emit the next
  // shuffled block; otherwise emit the original section. Pinned sections stay
  // at their original positions.
  let result = "";
  let cursor = 0;
  let shuffleCursor = 0;
  for (const sec of matches) {
    // Append text between previous cursor and section start (untouched).
    result += html.slice(cursor, sec.start);
    if (SHUFFLE_IDS.includes(sec.id)) {
      result += newOrderedBlocks[shuffleCursor++];
    } else {
      result += sec.html;
    }
    cursor = sec.end;
  }
  result += html.slice(cursor);
  return result;
}

// ----------------------------- Meta tag shuffling ---------------------------

/**
 * Permute the order of OpenGraph and Twitter meta tags inside <head>.
 * Charset, viewport, title, description, canonical, and <link>/<script> tags
 * stay at their original positions — only og:* / twitter:* meta tags move.
 */
export function shuffleMetaTags(html: string, seed: string): string {
  const headMatch = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) return html;
  const head = headMatch[1];

  // Find every <meta ...og:*> or <meta ...twitter:*> tag.
  const tagRe = /<meta\b[^>]*?(property|name)\s*=\s*"(og:[^"]+|twitter:[^"]+)"[^>]*>/gi;
  const tags: { start: number; end: number; html: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(head)) !== null) {
    tags.push({ start: m.index, end: m.index + m[0].length, html: m[0] });
  }
  if (tags.length < 2) return html;

  const shuffled = seededShuffle(tags.map((t) => t.html), seed + ":meta");

  // Replace tags in-place (preserving the gaps between them).
  let newHead = "";
  let cursor = 0;
  let i = 0;
  for (const t of tags) {
    newHead += head.slice(cursor, t.start);
    newHead += shuffled[i++];
    cursor = t.end;
  }
  newHead += head.slice(cursor);

  return html.replace(headMatch[0], `<head${headMatch[0].slice(5, headMatch[0].indexOf(">"))}>${newHead}</head>`);
}

// ----------------------------- Public façade --------------------------------

export interface AntiFpResult {
  files: Record<string, string>;
  classMap: Map<string, string>;
}

/**
 * Apply all Stage-1 transforms to a complete site bundle.
 *
 *  - Builds a single class-rename map from the union of every <style> block
 *    in every HTML file PLUS the external style.css.
 *  - Rewrites all HTML files (classes, sections on index.html, meta order).
 *  - Rewrites style.css with the same map so selectors keep matching.
 *
 * `seed` should be the project_id so re-deploys are idempotent and different
 * projects yield distinct fingerprints.
 */
export function applyAntiFingerprint(
  files: Record<string, string>,
  seed: string,
): AntiFpResult {
  // 1. Collect CSS sources from every HTML <style> block + style.css.
  const cssSources: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith(".html")) continue;
    content.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, body) => {
      cssSources.push(body);
      return _m;
    });
  }
  if (typeof files["style.css"] === "string") cssSources.push(files["style.css"]);

  const classMap = buildRenameMap(cssSources, seed);

  const out: Record<string, string> = { ...files };

  // 2. Rewrite every HTML file: class attrs + inline <style> blocks.
  for (const [path, content] of Object.entries(out)) {
    if (!path.endsWith(".html")) continue;
    let next = obfuscateHtmlWithMap(content, classMap);
    if (path === "index.html") {
      next = shuffleHomeSections(next, seed);
    }
    next = shuffleMetaTags(next, seed + ":" + path);
    out[path] = next;
  }

  // 3. Rewrite style.css.
  if (typeof out["style.css"] === "string") {
    out["style.css"] = rewriteCss(out["style.css"], classMap);
  }

  return { files: out, classMap };
}