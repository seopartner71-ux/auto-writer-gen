// Live re-check of the client site at build time: site facts that vanished from their page are hidden,
// unreadable pages downgrade facts to needs_confirmation, and archive paragraphs copied verbatim from the site block export.
import type { KbFact } from "./buildKnowledgeBase";

export interface KbSitePage { url: string; ok: boolean; text: string }
export interface KbSiteCheck { checkedAt: string; pages: KbSitePage[] }

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/(\d)[\s\u00a0](?=\d{3}\b)/g, "$1").replace(/\s+/g, " ");
const keyUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
const stems = (s: string) => norm(s).split(/[^a-zа-я0-9]+/i).filter((w) => w.length >= 4).map((w) => w.slice(0, 5));

export function findPage(check: KbSiteCheck | undefined, url: string): KbSitePage | undefined {
  if (!check || !url) return undefined;
  const k = keyUrl(url);
  return check.pages.find((p) => keyUrl(p.url) === k);
}

/** True when the fact is still on the page: all its numbers present, or most of its word stems for text-only facts. */
export function factOnPage(f: Pick<KbFact, "statement" | "value">, text: string): boolean {
  const t = norm(text);
  const src = `${f.value || ""} ${f.statement}`;
  const nums = [...new Set((norm(src).match(/\d+(?:[.,]\d+)?/g) || []).filter((n) => n.replace(/\D/g, "").length >= 2))];
  if (nums.length) return nums.every((n) => t.includes(n) || t.includes(n.replace(",", ".")) || t.includes(n.replace(".", ",")));
  const st = [...new Set(stems(f.statement.replace(/^[^:]*:\s*/, "")))];
  if (!st.length) return true;
  const tStems = new Set(stems(t));
  return st.filter((w) => tStems.has(w)).length / st.length >= 0.6;
}

/** Site facts (not confirmed form data) re-checked against the freshly loaded page. */
export function applySiteCheck(facts: KbFact[], check: KbSiteCheck | undefined, siteHost: string): { facts: KbFact[]; vanished: KbFact[]; unread: KbFact[] } {
  if (!check) return { facts, vanished: [], unread: [] };
  const vanished: KbFact[] = [], unread: KbFact[] = [];
  const out = facts.map((f) => {
    if (f.status === "confirmed" || f.status === "conflict" || f.status === "outdated" || !f.source_url) return f;
    let host = ""; try { host = new URL(f.source_url).hostname.replace(/^www\./, ""); } catch { /* skip */ }
    if (host !== siteHost) return f;
    const page = findPage(check, f.source_url);
    if (!page || !page.ok) { unread.push(f); return { ...f, status: "needs_confirmation" as const }; }
    if (!factOnPage(f, page.text)) { vanished.push(f); return { ...f, status: "outdated" as const }; }
    return f;
  });
  return { facts: out, vanished, unread };
}

/** Archive paragraphs sharing 12+ consecutive words with a site page (a copy, not a supplement). */
export function copiedParagraphs(files: Record<string, string>, check: KbSiteCheck | undefined, run = 12): string[] {
  if (!check) return [];
  const words = (s: string) => norm(s).split(/[^a-zа-я0-9]+/i).filter(Boolean);
  const grams = new Set<string>();
  for (const p of check.pages.filter((x) => x.ok)) { const w = words(p.text); for (let i = 0; i + run <= w.length; i++) grams.add(w.slice(i, i + run).join(" ")); }
  if (!grams.size) return [];
  const hits: string[] = [];
  for (const [path, md] of Object.entries(files)) {
    if (!path.startsWith("docs/") || !path.endsWith(".md")) continue;
    for (const para of md.split(/\n{2,}/)) {
      if (/^\s*(\||#|<a )/.test(para)) continue;
      const w = words(para);
      for (let i = 0; i + run <= w.length; i++) if (grams.has(w.slice(i, i + run).join(" "))) { hits.push(`${path}: ${para.slice(0, 80)}`); break; }
    }
  }
  return hits;
}
