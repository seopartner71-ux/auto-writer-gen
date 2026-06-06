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
  };
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