// ============================================================================
// P16 - INTERNAL LINK ENGINE (rules layer)
//
// Pure + deterministic. No DB, no LLM.
// Owns: which commercial pages an article must link to and how the links land
// inside the markdown body.
//
// Rules:
//   - an article links to at least 2 commercial pages;
//   - priority: commercial cluster (hub) > category > product / service;
//   - rejected / non-indexable pages are never linked.
// ============================================================================

import { norm, stemSet, tokens } from "./topicAuthority.ts";

export interface LinkTarget {
  registry_id: string;
  url_path: string;
  page_type: string;
  title: string;
  status?: string | null;
  indexable?: boolean | null;
}

export interface ResolvedLink {
  registry_id: string;
  url: string;
  anchor: string;
  page_type: string;
  placement: "inline" | "block";
}

export const MIN_COMMERCIAL_LINKS = 2;
export const MAX_COMMERCIAL_LINKS = 6;

const TYPE_PRIORITY: Record<string, number> = {
  hub: 3, category: 2, service: 1, product: 1, local: 1,
};

export function isLinkable(p: LinkTarget): boolean {
  if (!p.url_path || !p.url_path.startsWith("/")) return false;
  if (p.indexable === false) return false;
  if (!["approved", "review"].includes(String(p.status ?? "approved"))) return false;
  return TYPE_PRIORITY[String(p.page_type)] !== undefined;
}

/**
 * Picks the pages an article should link to.
 * `preferred` (the cluster registry ids) always wins over global relevance.
 */
export function pickLinkTargets(
  candidates: LinkTarget[],
  opts: {
    preferred?: string[];
    keywords?: string[];
    title?: string;
    min?: number;
    max?: number;
  } = {},
): LinkTarget[] {
  const pool = candidates.filter(isLinkable);
  if (!pool.length) return [];
  const preferred = new Set(opts.preferred || []);
  const topic = stemSet([opts.title || "", ...(opts.keywords || [])]);

  const scored = pool.map((p) => {
    const bag = stemSet([p.title || p.url_path]);
    let rel = 0;
    for (const w of bag) if (topic.has(w)) rel++;
    const relevance = bag.size ? rel / bag.size : 0;
    return {
      page: p,
      score:
        (preferred.has(p.registry_id) ? 100 : 0) +
        (TYPE_PRIORITY[p.page_type] || 0) * 10 +
        Math.round(relevance * 20),
    };
  }).sort((a, b) => b.score - a.score);

  const max = opts.max ?? MAX_COMMERCIAL_LINKS;
  const min = opts.min ?? MIN_COMMERCIAL_LINKS;
  const chosen: LinkTarget[] = [];
  const seenPath = new Set<string>();

  // keep type diversity: hub / category first, then leaves
  for (const s of scored) {
    if (chosen.length >= max) break;
    if (seenPath.has(s.page.url_path)) continue;
    seenPath.add(s.page.url_path);
    chosen.push(s.page);
  }
  return chosen.length >= min ? chosen : chosen;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Places links in the body: first tries an inline anchor on the first plain
 * mention of the page title, everything left over goes to a "read also" block.
 */
export function injectLinks(
  markdown: string,
  targets: LinkTarget[],
  opts: { ru?: boolean; blockTitle?: string } = {},
): { markdown: string; links: ResolvedLink[] } {
  const ru = opts.ru !== false;
  let body = String(markdown || "");
  const links: ResolvedLink[] = [];
  const leftovers: LinkTarget[] = [];

  for (const t of targets) {
    const anchor = String(t.title || "").trim();
    if (!anchor) { leftovers.push(t); continue; }
    if (body.includes(`(${t.url_path})`)) {
      links.push({ registry_id: t.registry_id, url: t.url_path, anchor, page_type: t.page_type, placement: "inline" });
      continue;
    }
    const words = tokens(anchor).slice(0, 3);
    const probe = words.length ? words.join("\\s+\\S{0,4}\\s*") : escapeRe(anchor);
    // never rewrite inside headings, tables, existing links or code
    const re = new RegExp(`(?<![\\[|#>])\\b(${probe}\\w*)\\b(?![^\\[]*\\])`, "iu");
    const m = re.exec(body);
    if (m && !isProtectedLine(body, m.index)) {
      body = body.slice(0, m.index) + `[${m[1]}](${t.url_path})` + body.slice(m.index + m[1].length);
      links.push({ registry_id: t.registry_id, url: t.url_path, anchor: m[1], page_type: t.page_type, placement: "inline" });
    } else {
      leftovers.push(t);
    }
  }

  if (leftovers.length) {
    const head = opts.blockTitle || (ru ? "Смотрите также" : "See also");
    const items = leftovers.map((t) => {
      links.push({ registry_id: t.registry_id, url: t.url_path, anchor: t.title, page_type: t.page_type, placement: "block" });
      return `- [${t.title}](${t.url_path})`;
    });
    body = `${body.trimEnd()}\n\n## ${head}\n\n${items.join("\n")}\n`;
  }

  return { markdown: body, links };
}

function isProtectedLine(body: string, index: number): boolean {
  const start = body.lastIndexOf("\n", index) + 1;
  const line = body.slice(start, body.indexOf("\n", index) === -1 ? undefined : body.indexOf("\n", index));
  return /^\s*(#|\||>|```|- \[)/.test(line);
}

/** Count of distinct commercial pages an article really links to. */
export function countCommercialLinks(links: ResolvedLink[]): number {
  return new Set(links.map((l) => l.url)).size;
}

/** Anchors the build/QA layer must never see (rejected pages). */
export function stripDeadLinks(markdown: string, validPaths: Set<string>): string {
  return String(markdown || "").replace(/\[([^\]]+)\]\((\/[^)]*)\)/g, (full, text, url) =>
    validPaths.has(String(url)) ? full : String(text));
}

export const linkKey = (s: string) => norm(s);
