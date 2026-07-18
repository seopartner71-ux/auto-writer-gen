// Helpers for the Deep Fact Check UI. Pure functions, no side effects.

export type Verdict = "CONFIRMED" | "OUTDATED" | "UNVERIFIABLE";
export type Severity = "critical" | "major" | "minor";

export interface FactFinding {
  type: string;
  severity: Severity;
  quote: string;
  verdict: string;
  suggested_fix: string | null;
  source_url: string | null;
  search_query?: string | null;
  needs_manual_review?: boolean;
  confidence?: number;
  verification?: Verdict;
  verification_summary?: string;
  verification_sources?: Array<{ title: string; url: string }>;
  origin?: "layer1" | "critic" | "factcheck";
  duplicated?: boolean;
}

export const YMYL_KEYWORDS = [
  "виза", "ВНЖ", "внж", "гражданство", "налог", "закон", "штраф",
  "лечение", "диагноз", "препарат", "кредит", "ипотека",
  "инвестиции", "недвижимость",
];

export function detectYmyl(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return YMYL_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
}

function normalizeQuote(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalizeQuote(s).split(" ").filter((w) => w.length > 0);
}

/** Return overlap ratio of tokens between two quotes (Jaccard against shorter set). */
export function quoteOverlap(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

/**
 * Merge layer1, critic, and factcheck findings. If a critic/factcheck finding
 * overlaps > 50% with a layer1 finding, keep only the critic version and mark
 * it as duplicated (confirmed by both). Factcheck findings take priority over
 * plain critic ones (they carry the verification verdict).
 */
export function dedupeFindings(
  layer1: FactFinding[],
  critic: FactFinding[],
  factcheck: FactFinding[],
): FactFinding[] {
  // Prefer factcheck > critic > layer1 for the same base findings.
  const primary: FactFinding[] = factcheck.length > 0
    ? factcheck.map((f) => ({ ...f, origin: "factcheck" }))
    : critic.map((f) => ({ ...f, origin: "critic" }));

  const primaryMarked = primary.map((p) => ({ ...p }));
  const usedL1 = new Set<number>();
  primaryMarked.forEach((p) => {
    layer1.forEach((l, idx) => {
      if (usedL1.has(idx)) return;
      if (quoteOverlap(p.quote, l.quote) > 0.5) {
        p.duplicated = true;
        usedL1.add(idx);
      }
    });
  });

  const remainingL1 = layer1
    .filter((_, idx) => !usedL1.has(idx))
    .map<FactFinding>((l) => ({ ...l, origin: "layer1" }));

  return [...primaryMarked, ...remainingL1];
}

const WEIGHTS: Record<Severity, number> = { critical: 15, major: 7, minor: 1 };

export function computeFactScore(findings: FactFinding[]): number {
  let penalty = 0;
  for (const f of findings) {
    if (f.type === "client_slot") continue;
    if (f.verification === "CONFIRMED") continue;
    penalty += WEIGHTS[f.severity] ?? 0;
  }
  return Math.max(0, Math.min(100, 100 - penalty));
}

export function typeLabelRu(type: string): string {
  const map: Record<string, string> = {
    outdated_fact: "Устаревший факт",
    invented_fact: "Выдуманный факт",
    logic_break: "Логический разрыв",
    anon_expert: "Безымянный эксперт",
    self_repeat: "Самоповтор",
    seam: "Шов структуры",
    keyword_stuffing: "Переспам ключом",
    cross_article_conflict: "Конфликт с базой",
    client_slot: "Данные клиента",
  };
  return map[type] || type;
}

export type Confidence = "green" | "red" | "orange" | "yellow";

export function confidenceOf(f: FactFinding): Confidence {
  if (f.verification === "CONFIRMED") return "green";
  if (f.verification === "OUTDATED" || f.type === "invented_fact") return "red";
  if (f.verification === "UNVERIFIABLE") return "orange";
  if (typeof f.confidence === "number" && f.confidence < 0.5) return "orange";
  return "yellow";
}

export function countOccurrences(hay: string, needle: string): number {
  if (!needle || needle.length < 3) return 0;
  let i = 0;
  let n = 0;
  while (true) {
    const p = hay.indexOf(needle, i);
    if (p === -1) break;
    n++;
    i = p + needle.length;
  }
  return n;
}

export function severityOrder(s: Severity): number {
  if (s === "critical") return 0;
  if (s === "major") return 1;
  return 2;
}

// Instruction-like suggested_fix detector.
// If the model wrote a recommendation to the editor instead of a ready-to-paste
// replacement (e.g. "Удалить", "Переформулировать", "Атрибутировать..."), we treat
// the finding as informational and hide the Apply button.
const INSTRUCTION_VERBS = [
  "удалить", "удали",
  "убрать", "убери",
  "переформулировать", "переформулируй",
  "атрибутировать", "атрибутируй",
  "заменить", "замени",
  "оставить", "оставь",
  "уточнить", "уточни",
  "запросить", "запроси",
  "добавить", "добавь",
  "сократить", "сократи",
];

export function isInstructionFix(fix: string | null | undefined): boolean {
  if (!fix) return false;
  const first = String(fix)
    .trim()
    .replace(/^[«"'`(\[\-–—•*\s]+/u, "")
    .toLowerCase()
    .split(/[\s,.:;!?]/)[0];
  if (!first) return false;
  return INSTRUCTION_VERBS.includes(first);
}