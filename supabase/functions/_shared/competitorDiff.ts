// Competitor Monitoring — structural / content / SEO diff + significance score.
//
// Works on normalized snapshots only (never on raw HTML). Produces:
//  - `summary`  : compact numeric stats (this is what goes to the AI)
//  - `diff`     : detailed added/removed lists for the UI
//  - `severity` : low | medium | high | critical

import type { NormalizedSnapshot, Heading, FaqItem } from "./competitorSnapshot.ts";

export type MonitorKey =
  | "title" | "description" | "headings" | "content" | "word_count" | "images" | "alt"
  | "internal_links" | "external_links" | "faq" | "tables" | "lists" | "cta"
  | "schema" | "canonical" | "robots" | "prices";

export const ALL_MONITOR_KEYS: MonitorKey[] = [
  "title", "description", "headings", "content", "word_count", "images", "alt",
  "internal_links", "external_links", "faq", "tables", "lists", "cta",
  "schema", "canonical", "robots", "prices",
];

export type MonitorConfig = Partial<Record<MonitorKey, boolean>>;

export function isOn(cfg: MonitorConfig | null | undefined, key: MonitorKey): boolean {
  if (!cfg || typeof cfg !== "object" || Object.keys(cfg).length === 0) return true;
  return cfg[key] !== false;
}

export interface FieldChange { before: string; after: string }

export interface DiffResult {
  hasChanges: boolean;
  severity: "low" | "medium" | "high" | "critical";
  score: number;
  summary: Record<string, unknown>;
  diff: Record<string, unknown>;
}

function splitSentences(text: string): string[] {
  return String(text || "")
    .split(/(?<=[.!?…])\s+(?=[A-ZА-ЯЁ0-9«"'(])/u)
    .map(s => s.trim())
    .filter(s => s.length > 25);
}

function key(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function setDiff<T>(before: T[], after: T[], k: (x: T) => string): { added: T[]; removed: T[] } {
  const b = new Map(before.map(x => [k(x), x]));
  const a = new Map(after.map(x => [k(x), x]));
  const added: T[] = [];
  const removed: T[] = [];
  for (const [kk, v] of a) if (!b.has(kk)) added.push(v);
  for (const [kk, v] of b) if (!a.has(kk)) removed.push(v);
  return { added, removed };
}

/** Headings whose text changed only slightly are reported as "changed", not add+remove. */
function headingDiff(before: Heading[], after: Heading[]) {
  const { added, removed } = setDiff(before, after, h => `${h.level}|${key(h.text)}`);
  const changed: FieldChange[] = [];
  const stillAdded: Heading[] = [];
  const usedRemoved = new Set<number>();
  for (const a of added) {
    let matchIdx = -1;
    for (let i = 0; i < removed.length; i++) {
      if (usedRemoved.has(i)) continue;
      const r = removed[i];
      if (r.level !== a.level) continue;
      const ka = key(a.text), kr = key(r.text);
      if (ka.startsWith(kr.slice(0, Math.max(10, Math.floor(kr.length * 0.6)))) ||
          kr.startsWith(ka.slice(0, Math.max(10, Math.floor(ka.length * 0.6))))) {
        matchIdx = i; break;
      }
    }
    if (matchIdx >= 0) { usedRemoved.add(matchIdx); changed.push({ before: removed[matchIdx].text, after: a.text }); }
    else stillAdded.push(a);
  }
  const stillRemoved = removed.filter((_, i) => !usedRemoved.has(i));
  return { added: stillAdded, removed: stillRemoved, changed };
}

export function computeDiff(
  prev: NormalizedSnapshot | Record<string, any>,
  next: NormalizedSnapshot | Record<string, any>,
  cfg: MonitorConfig | null | undefined,
): DiffResult {
  const diff: Record<string, any> = {};
  const summary: Record<string, any> = {};
  let score = 0;

  // ---- META -------------------------------------------------------------
  const meta: Record<string, FieldChange> = {};
  const metaField = (k: MonitorKey, field: string) => {
    if (!isOn(cfg, k)) return;
    const b = String(prev?.[field] ?? ""), a = String(next?.[field] ?? "");
    if (key(b) !== key(a)) {
      meta[field] = { before: b, after: a };
      summary[`${field}_changed`] = true;
      score += field === "title" ? 25 : field === "description" ? 15 : 10;
    }
  };
  metaField("title", "title");
  metaField("description", "description");
  metaField("canonical", "canonical");
  metaField("robots", "robots");
  if (isOn(cfg, "headings")) {
    const b = String(prev?.h1 ?? ""), a = String(next?.h1 ?? "");
    if (key(b) !== key(a)) { meta.h1 = { before: b, after: a }; summary.h1_changed = true; score += 20; }
  }
  if (Object.keys(meta).length) diff.meta = meta;

  // ---- HEADINGS ---------------------------------------------------------
  if (isOn(cfg, "headings")) {
    const hd = headingDiff((prev?.headings ?? []) as Heading[], (next?.headings ?? []) as Heading[]);
    if (hd.added.length || hd.removed.length || hd.changed.length) {
      diff.headings = hd;
      summary.headings_added = hd.added.length;
      summary.headings_removed = hd.removed.length;
      summary.headings_changed = hd.changed.length;
      summary.h2_added = hd.added.filter(h => h.level === 2).length;
      score += hd.added.length * 8 + hd.removed.length * 8 + hd.changed.length * 4;
    }
  }

  // ---- CONTENT ----------------------------------------------------------
  const wb = Number(prev?.word_count ?? 0), wa = Number(next?.word_count ?? 0);
  if (isOn(cfg, "word_count") && wb !== wa) {
    summary.words_before = wb;
    summary.words_after = wa;
    summary.words_delta = wa - wb;
    score += Math.min(40, Math.round(Math.abs(wa - wb) / 25));
  }
  if (isOn(cfg, "content")) {
    const sb = splitSentences(String(prev?.content ?? ""));
    const sa = splitSentences(String(next?.content ?? ""));
    const { added, removed } = setDiff(sb, sa, key);
    if (added.length || removed.length) {
      diff.content = {
        added: added.slice(0, 80),
        removed: removed.slice(0, 80),
        added_total: added.length,
        removed_total: removed.length,
        before_text: String(prev?.content ?? "").slice(0, 20_000),
        after_text: String(next?.content ?? "").slice(0, 20_000),
      };
      summary.content_fragments_added = added.length;
      summary.content_fragments_removed = removed.length;
      score += Math.min(30, added.length * 2 + removed.length * 2);
    }
  }

  // ---- LISTS / TABLES / CTA / SCHEMA / PRICES ---------------------------
  const simpleList = (k: MonitorKey, field: string, weight: number, label = field) => {
    if (!isOn(cfg, k)) return;
    const { added, removed } = setDiff<string>((prev?.[field] ?? []) as string[], (next?.[field] ?? []) as string[], key);
    if (added.length || removed.length) {
      diff[label] = { added: added.slice(0, 40), removed: removed.slice(0, 40) };
      summary[`${label}_added`] = added.length;
      summary[`${label}_removed`] = removed.length;
      score += (added.length + removed.length) * weight;
    }
  };
  simpleList("tables", "tables", 6);
  simpleList("lists", "lists", 2);
  simpleList("cta", "cta", 4);
  simpleList("schema", "schema_types", 6, "schema");
  simpleList("prices", "prices", 5);

  // ---- FAQ ---------------------------------------------------------------
  if (isOn(cfg, "faq")) {
    const { added, removed } = setDiff<FaqItem>((prev?.faq ?? []) as FaqItem[], (next?.faq ?? []) as FaqItem[], f => key(f.q));
    if (added.length || removed.length) {
      diff.faq = { added: added.slice(0, 40), removed: removed.slice(0, 40) };
      summary.faq_added = added.length;
      summary.faq_removed = removed.length;
      score += added.length * 7 + removed.length * 5;
    }
  }

  // ---- LINKS -------------------------------------------------------------
  const linkDiff = (k: MonitorKey, field: string, label: string, weight: number) => {
    if (!isOn(cfg, k)) return;
    const { added, removed } = setDiff<any>((prev?.[field] ?? []) as any[], (next?.[field] ?? []) as any[], l => String(l?.href || ""));
    if (added.length || removed.length) {
      diff[label] = { added: added.slice(0, 50), removed: removed.slice(0, 50) };
      summary[`${label}_added`] = added.length;
      summary[`${label}_removed`] = removed.length;
      score += (added.length + removed.length) * weight;
    }
  };
  linkDiff("internal_links", "internal_links", "internal_links", 1);
  linkDiff("external_links", "external_links", "external_links", 1);

  // ---- IMAGES / ALT -------------------------------------------------------
  if (isOn(cfg, "images")) {
    const { added, removed } = setDiff<any>((prev?.images ?? []) as any[], (next?.images ?? []) as any[], i => String(i?.src || ""));
    if (added.length || removed.length) {
      diff.images = { added: added.slice(0, 40), removed: removed.slice(0, 40) };
      summary.images_added = added.length;
      summary.images_removed = removed.length;
      score += (added.length + removed.length) * 2;
    }
  }
  if (isOn(cfg, "alt")) {
    const bMap = new Map(((prev?.images ?? []) as any[]).map(i => [String(i.src), String(i.alt || "")]));
    const altChanged: FieldChange[] = [];
    for (const img of (next?.images ?? []) as any[]) {
      const before = bMap.get(String(img.src));
      if (before !== undefined && before !== String(img.alt || "")) {
        altChanged.push({ before, after: String(img.alt || "") });
      }
    }
    if (altChanged.length) {
      diff.alt = { changed: altChanged.slice(0, 40) };
      summary.alt_changed = altChanged.length;
      score += altChanged.length;
    }
  }

  const hasChanges = Object.keys(diff).length > 0 || Object.keys(summary).length > 0;
  const commercialTouched = Boolean(summary.prices_added || summary.prices_removed || summary.cta_added || summary.tables_added);
  if (commercialTouched) score += 10;

  const severity: DiffResult["severity"] =
    score >= 90 ? "critical" : score >= 45 ? "high" : score >= 15 ? "medium" : "low";

  return { hasChanges, severity, score, summary, diff };
}

/** Fast pre-check: identical hashes for every enabled group -> no AI, no change row. */
export function hashesEqual(prev: Record<string, any>, next: Record<string, any>, cfg: MonitorConfig | null | undefined): boolean {
  const pairs: Array<[MonitorKey[], string]> = [
    [["content", "word_count"], "content_hash"],
    [["headings", "tables", "lists", "faq", "images"], "structure_hash"],
    [["title", "description", "canonical", "robots"], "meta_hash"],
    [["internal_links", "external_links"], "links_hash"],
  ];
  for (const [keys, field] of pairs) {
    if (!keys.some(k => isOn(cfg, k))) continue;
    if (String(prev?.[field] ?? "") !== String(next?.[field] ?? "")) return false;
  }
  return true;
}
