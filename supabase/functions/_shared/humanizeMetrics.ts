// Server-side metrics for the humanize pipeline.
//
// Used by `runDoubleHumanizePass` to:
//   1. Reject passes that mangle structure (lost <a>, headings, list items,
//      numbers/tables) — `structuralIntegrityOk`.
//   2. Compute pre/post snapshots that get persisted into `humanize_meta`
//      and surfaced in the UI (HumanizeProgress) and the admin panel.
//   3. Detect leftover BANLIST words and "что/поскольку/в то время как"
//      chains so we can fire an optional cleanup mini-pass.
//
// Pure regex + sentence math, no I/O.

import { analyzeSentenceStructure } from "./sentenceStructure.ts";

export interface StructureSignatures {
  chars: number;
  words: number;
  headings: number;
  listItems: number;
  links: number;
  tables: number;
  numbers: number;
}

export function countSignatures(text: string): StructureSignatures {
  const s = text || "";
  const headings =
    (s.match(/^\s{0,3}#{1,6}\s/gm) || []).length +
    (s.match(/<h[1-6][^>]*>/gi) || []).length;
  const listItems =
    (s.match(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm) || []).length +
    (s.match(/<li[^>]*>/gi) || []).length;
  const links =
    (s.match(/\[[^\]]+\]\([^)]+\)/g) || []).length +
    (s.match(/<a\s+[^>]*href=/gi) || []).length;
  const tables =
    ((s.match(/^\|.*\|$/gm) || []).length > 0 ? 1 : 0) +
    (s.match(/<table[^>]*>/gi) || []).length;
  const numbers = (s.replace(/<[^>]+>/g, " ").match(/\b\d[\d.,]*\b/g) || []).length;
  const chars = s.length;
  const words = s.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length;
  return { chars, words, headings, listItems, links, tables, numbers };
}

// BANLIST flat tokens (синхронизировано с antiTurgenevAddon.ts).
const BANLIST_RU_RE = new RegExp(
  [
    "является",
    "осуществляет(?:ся)?",
    "производится",
    "в целях",
    "в рамках",
    "в связи с",
    "на сегодняшний день",
    "в настоящее время",
    "данный(?:ый|ая|ое|ые)?",
    "вышеуказанн(?:ый|ая|ое|ые)",
    "вышеперечисленн(?:ый|ая|ое|ые)",
    "стоит отметить",
    "следует отметить",
    "стоит сказать",
    "стоит подчеркнуть",
    "как известно",
    "не секрет что",
    "ни для кого не секрет",
    "необходимо понимать",
    "важно понимать",
    "в современном мире",
    "играет важную роль",
    "имеет большое значение",
    "оказывает влияние",
    "представляет собой",
    "пользуется популярностью",
    "набирает обороты",
    "не теряет актуальности",
  ].join("|"),
  "giu",
);

const BANLIST_EN_RE = new RegExp(
  [
    "in today's world",
    "it is worth noting",
    "needless to say",
    "as we all know",
    "in conclusion",
    "it is important to note",
    "plays a (?:vital|crucial|important|key) role",
    "in the modern world",
  ].join("|"),
  "gi",
);

// Контекстные нарушения (начало предложения / середина).
const CONTEXT_RU_RE = /(?:в то время как|при этом\b)/giu;

export function countBanlistHits(text: string, lang: "ru" | "en"): number {
  if (!text) return 0;
  const plain = text.replace(/<[^>]+>/g, " ");
  if (lang === "ru") {
    return (plain.match(BANLIST_RU_RE)?.length || 0) +
           (plain.match(CONTEXT_RU_RE)?.length || 0);
  }
  return plain.match(BANLIST_EN_RE)?.length || 0;
}

/** Список конкретных хитов BANLIST для подсказки модели в 3-м проходе. */
export function listBanlistHits(text: string, lang: "ru" | "en", limit = 8): string[] {
  if (!text) return [];
  const plain = text.replace(/<[^>]+>/g, " ");
  const hits = new Set<string>();
  const collect = (re: RegExp) => {
    const m = plain.match(re);
    if (m) for (const h of m) hits.add(h.toLowerCase().trim());
  };
  if (lang === "ru") { collect(BANLIST_RU_RE); collect(CONTEXT_RU_RE); }
  else { collect(BANLIST_EN_RE); }
  return Array.from(hits).slice(0, limit);
}

/** Считает предложения с >=2 союзов из "в то время как / поскольку / что". */
export function countChainViolations(text: string, lang: "ru" | "en"): number {
  if (lang !== "ru" || !text) return 0;
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const sentences = plain.split(/(?<=[.!?])\s+/);
  const chainRe = /в то время как|поскольку|\bчто\b/gi;
  let count = 0;
  for (const s of sentences) {
    const hits = (s.match(chainRe) || []).length;
    if (hits >= 2) count++;
  }
  return count;
}

export interface HumanizeMetrics {
  signatures: StructureSignatures;
  avgWords: number;
  shortRatio: number;
  maxShortRun: number;
  chainViolations: number;
  banlistHits: number;
  repeatedOpeners: number;
  repeatedNgrams: number;
}

export function measureHumanize(text: string, lang: "ru" | "en"): HumanizeMetrics {
  const sig = countSignatures(text);
  const sent = analyzeSentenceStructure(text);
  return {
    signatures: sig,
    avgWords: sent.avgWords,
    shortRatio: sent.shortRatio,
    maxShortRun: sent.maxShortRun,
    chainViolations: countChainViolations(text, lang),
    banlistHits: countBanlistHits(text, lang),
    repeatedOpeners: countRepeatedOpeners(text),
    repeatedNgrams: countRepeatedNgrams(text),
  };
}

// ─── Repeated paragraph/heading openers ───────────────────────────
// Counts how many H2 titles + first paragraph after each H2 (or top-level
// paragraphs in markdown) share the same first 3 words. Returns the number
// of "extra" duplicates (sum of (group_size - 1) for groups of size >= 2).
// Catches templates like "В этом разделе...", "Стоит понимать, что...".
export function countRepeatedOpeners(text: string): number {
  if (!text) return 0;
  const blocks: string[] = [];
  const htmlBlockRe = /<(?:h2|h3|p|li)[^>]*>([\s\S]*?)<\/(?:h2|h3|p|li)>/gi;
  let m: RegExpExecArray | null;
  while ((m = htmlBlockRe.exec(text)) !== null) {
    const inner = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (inner) blocks.push(inner);
  }
  if (blocks.length === 0) {
    // Markdown fallback — split on blank lines, skip code fences.
    const md = text.replace(/```[\s\S]*?```/g, " ");
    for (const para of md.split(/\n{2,}/)) {
      const t = para.replace(/^[#>\-\*\d\.\s]+/, "").replace(/\s+/g, " ").trim();
      if (t) blocks.push(t);
    }
  }
  const freq = new Map<string, number>();
  for (const b of blocks) {
    const words = b.toLowerCase().split(/[^a-zа-яё0-9]+/i).filter(w => w.length >= 2).slice(0, 3);
    if (words.length < 3) continue;
    const key = words.join(" ");
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  let extra = 0;
  for (const c of freq.values()) if (c >= 2) extra += (c - 1);
  return extra;
}

// ─── Repeated 3-grams ─────────────────────────────────────────────
// Counts distinct 3-word sequences (of meaningful words >= 3 chars) that
// appear >= minFreq times in the article body. Catches LLM phrase loops.
export function countRepeatedNgrams(text: string, n = 3, minFreq = 3): number {
  if (!text) return 0;
  const plain = text.replace(/<[^>]+>/g, " ").replace(/```[\s\S]*?```/g, " ").toLowerCase();
  const words = plain.split(/[^a-zа-яё0-9]+/i).filter(w => w.length >= 3);
  if (words.length < n) return 0;
  const freq = new Map<string, number>();
  for (let i = 0; i <= words.length - n; i++) {
    const gram = words.slice(i, i + n).join(" ");
    freq.set(gram, (freq.get(gram) || 0) + 1);
  }
  let count = 0;
  for (const c of freq.values()) if (c >= minFreq) count++;
  return count;
}

// ─── H2 structural validator ──────────────────────────────────────
// Catches empty sections, uniformly-sized sections (templated), and
// uniform prefixes ("В этом разделе...", "Что такое..."). Pure-regex,
// runs in preflight; warnings are persisted to articles.h2_warnings.
export interface H2Report {
  sections: number;
  empty: number;
  tooShort: number;
  uniformLength: boolean;
  uniformPrefix: boolean;
  warnings: string[];
}
export function analyzeH2Structure(text: string): H2Report {
  const out: H2Report = {
    sections: 0, empty: 0, tooShort: 0,
    uniformLength: false, uniformPrefix: false, warnings: [],
  };
  if (!text) return out;
  // Extract H2 titles + the text between this H2 and the next H2 / EOF.
  // Supports both <h2> and markdown `## `.
  const isHtml = /<h2[^>]*>/i.test(text);
  const parts: Array<{ title: string; body: string }> = [];
  if (isHtml) {
    const re = /<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2[^>]*>|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      parts.push({
        title: m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        body: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      });
    }
  } else {
    const lines = text.split(/\n/);
    let cur: { title: string; body: string } | null = null;
    for (const ln of lines) {
      const h = ln.match(/^##\s+(.+)$/);
      if (h) {
        if (cur) parts.push(cur);
        cur = { title: h[1].trim(), body: "" };
      } else if (cur) {
        cur.body += " " + ln;
      }
    }
    if (cur) parts.push(cur);
    for (const p of parts) p.body = p.body.replace(/\s+/g, " ").trim();
  }
  out.sections = parts.length;
  if (out.sections === 0) return out;
  const lens = parts.map(p => p.body.length);
  for (const len of lens) {
    if (len < 50) out.empty++;
    else if (len < 200) out.tooShort++;
  }
  if (out.empty) out.warnings.push(`${out.empty} пустых H2`);
  if (out.tooShort) out.warnings.push(`${out.tooShort} слишком коротких H2`);
  // Uniform length: stddev/avg < 0.15 на достаточном корпусе.
  if (out.sections >= 4) {
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    if (avg > 200) {
      const variance = lens.reduce((a, b) => a + (b - avg) ** 2, 0) / lens.length;
      const sigma = Math.sqrt(variance);
      if (avg > 0 && sigma / avg < 0.15) {
        out.uniformLength = true;
        out.warnings.push("одинаковая длина секций");
      }
    }
  }
  // Uniform prefix: >=50% секций начинаются с одной и той же пары слов.
  if (out.sections >= 4) {
    const prefixes = parts.map(p => {
      const w = p.body.toLowerCase().split(/[^a-zа-яё0-9]+/i).filter(t => t.length >= 2).slice(0, 2);
      return w.length === 2 ? w.join(" ") : "";
    }).filter(Boolean);
    if (prefixes.length) {
      const freq = new Map<string, number>();
      for (const p of prefixes) freq.set(p, (freq.get(p) || 0) + 1);
      const top = Math.max(...freq.values());
      if (top / out.sections >= 0.5) {
        out.uniformPrefix = true;
        out.warnings.push("одинаковые зачины секций");
      }
    }
  }
  return out;
}

/**
 * Reject the pass if structural signatures shrank too much (lost links,
 * headings, list items, tables, numbers). Threshold: -15% relative or
 * absolute drop > max(2, 15%).
 */
export function structuralIntegrityOk(
  before: StructureSignatures,
  after: StructureSignatures,
): { ok: boolean; reason?: string } {
  const dropped = (b: number, a: number, absMin = 2, rel = 0.85) =>
    b > 0 && (a < b * rel || (b - a) > Math.max(absMin, b * 0.15));

  if (dropped(before.headings, after.headings, 1)) {
    return { ok: false, reason: `headings ${before.headings}->${after.headings}` };
  }
  if (dropped(before.listItems, after.listItems, 2)) {
    return { ok: false, reason: `list_items ${before.listItems}->${after.listItems}` };
  }
  if (dropped(before.links, after.links, 1)) {
    return { ok: false, reason: `links ${before.links}->${after.links}` };
  }
  if (dropped(before.tables, after.tables, 1)) {
    return { ok: false, reason: `tables ${before.tables}->${after.tables}` };
  }
  // Numbers must survive — fact integrity.
  if (before.numbers > 0 && after.numbers < before.numbers * 0.9) {
    return { ok: false, reason: `numbers ${before.numbers}->${after.numbers}` };
  }
  return { ok: true };
}