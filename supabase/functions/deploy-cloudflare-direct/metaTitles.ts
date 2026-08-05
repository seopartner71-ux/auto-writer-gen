// Centralized SEO title / description construction for Site Factory sites.
//
// Three title shapes:
//   home:     "{site_name}: {short_positioning}"
//   category: "{category_name} — {site_name}"
//   article:  "{article_h1} — {site_name}"
//
// Hard limit: 65 chars. Overflow is always trimmed at a word boundary —
// never mid-word. For home we shorten the positioning, for the other two
// we shorten the site name.

export const TITLE_MAX = 65;
export const DESC_MIN = 130;
export const DESC_MAX = 160;

export function normalizeText(s: unknown): string {
  return String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function trimEdges(s: string): string {
  return s.replace(/^[\s\-–—:,.;|·]+/, "").replace(/[\s\-–—:,.;|·]+$/, "").trim();
}

/** Cut a string to `max` chars at the nearest word boundary (never mid-word). */
export function clampWords(input: unknown, max: number): string {
  const s = normalizeText(input);
  if (s.length <= max) return s;
  const slice = s.slice(0, max + 1);
  const cut = slice.lastIndexOf(" ");
  const out = cut > 0 ? slice.slice(0, cut) : s.slice(0, max);
  return trimEdges(out);
}

/** Homepage: "{siteName}: {positioning}" capped at 65 chars. */
export function buildHomeTitle(siteName: unknown, positioning: unknown, max = TITLE_MAX): string {
  const name = trimEdges(normalizeText(siteName)) || "";
  const pos = trimEdges(normalizeText(positioning));
  if (!name) return clampWords(pos, max);
  if (!pos) return clampWords(name, max);
  const full = `${name}: ${pos}`;
  if (full.length <= max) return full;
  const room = max - name.length - 2; // ": "
  if (room >= 12) {
    const shortPos = clampWords(pos, room);
    if (shortPos) return `${name}: ${shortPos}`;
  }
  return clampWords(name, max);
}

/** Category / article: "{primary} — {siteName}" capped at 65 chars. */
export function buildPairTitle(primary: unknown, siteName: unknown, max = TITLE_MAX): string {
  const head = trimEdges(normalizeText(primary));
  const name = trimEdges(normalizeText(siteName));
  if (!name) return clampWords(head, max);
  if (!head) return clampWords(name, max);
  const full = `${head} — ${name}`;
  if (full.length <= max) return full;
  const room = max - head.length - 3; // " — "
  if (room >= 4) {
    const shortName = trimEdges(clampWords(name, room));
    if (shortName) return `${head} — ${shortName}`;
  }
  return clampWords(head, max);
}

export const buildCategoryTitle = buildPairTitle;
export const buildArticleTitle = buildPairTitle;

const BAD_OPENERS = [
  /^наш\s+блог\b[\s,:—-]*/i,
  /^наш\s+сайт\b[\s,:—-]*/i,
  /^этот\s+сайт\b[\s,:—-]*/i,
  /^our\s+blog\b[\s,:—-]*/i,
  /^our\s+site\b[\s,:—-]*/i,
  /^this\s+site\b[\s,:—-]*/i,
];

function stripBadOpeners(s: string): string {
  let out = s;
  for (const re of BAD_OPENERS) {
    const next = out.replace(re, "");
    if (next !== out) {
      out = next.charAt(0).toUpperCase() + next.slice(1);
      break;
    }
  }
  return out.trim();
}

/**
 * Meta description for the snippet: 130-160 chars, cut only at a sentence or
 * word boundary, never mid-word, never a verbatim copy of the title.
 */
export function buildMetaDescription(
  raw: unknown,
  opts: { title?: string; fallback?: string; min?: number; max?: number } = {},
): string {
  const min = opts.min ?? DESC_MIN;
  const max = opts.max ?? DESC_MAX;
  let s = stripBadOpeners(normalizeText(raw));
  const fallback = stripBadOpeners(normalizeText(opts.fallback));
  const title = normalizeText(opts.title);
  if (!s || (title && s.toLowerCase() === title.toLowerCase())) s = fallback;
  if (!s) return "";

  if (s.length <= max) return s;

  // Prefer a sentence boundary inside [min, max].
  const window = s.slice(0, max + 1);
  let best = -1;
  const re = /[.!?…](\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(window)) !== null) {
    const end = m.index + 1;
    if (end >= min && end <= max) best = end;
  }
  if (best > 0) return trimEdges(s.slice(0, best)) + (/[.!?…]$/.test(s.slice(0, best).trim()) ? "" : ".");

  const cut = clampWords(s, max - 1);
  return cut ? `${trimEdges(cut)}.` : "";
}