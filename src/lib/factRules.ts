// Deep Fact Check — Layer 1 (deterministic rules, no LLM).
// ВАЖНО: \b в JS не работает с кириллицей — границы слова эмулируем look-around'ами.

export type FindingType =
  | "outdated_fact"
  | "invented_fact"
  | "logic_break"
  | "anon_expert"
  | "self_repeat"
  | "seam"
  | "keyword_stuffing"
  | "cross_article_conflict"
  | "client_slot";

export type FindingSeverity = "critical" | "major" | "minor";

export interface Finding {
  type: FindingType;
  severity: FindingSeverity;
  quote: string;                    // точная цитата из текста — по ней делается замена
  verdict: string;                  // краткий вердикт
  suggested_fix: string | null;
  source_url: string | null;
}

const CYR_LEFT = "(?<![а-яёА-ЯЁa-zA-Z0-9])";
const CYR_RIGHT = "(?![а-яёА-ЯЁa-zA-Z0-9])";

// ---------- Rule 1: безымянные эксперты рядом с цитатой ----------

const ANON_EXPERT_PATTERNS = [
  "практика показывает",
  "эксперты отмечают",
  "специалисты рекомендуют",
  "опытные мастера",
  "профессионалы сходятся",
];

const QUOTE_RE = /«[^«»]{2,}»|"[^"]{2,}"|"[^"]{2,}"|"[^"]{2,}"/g;

function findAnonExperts(text: string): Finding[] {
  const out: Finding[] = [];
  const quotes: Array<{ start: number; end: number }> = [];
  QUOTE_RE.lastIndex = 0;
  let qm: RegExpExecArray | null;
  while ((qm = QUOTE_RE.exec(text)) !== null) {
    quotes.push({ start: qm.index, end: qm.index + qm[0].length });
  }
  if (!quotes.length) return out;

  for (const phrase of ANON_EXPERT_PATTERNS) {
    const re = new RegExp(CYR_LEFT + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + CYR_RIGHT, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const pStart = m.index;
      const pEnd = pStart + m[0].length;
      const near = quotes.find((q) => {
        const dist = q.start >= pEnd ? q.start - pEnd : pStart - q.end;
        return dist >= 0 && dist <= 200;
      });
      if (!near) continue;
      out.push({
        type: "anon_expert",
        severity: "major",
        quote: m[0],
        verdict: "Безымянный эксперт рядом с цитатой — источник неверифицируем.",
        suggested_fix: "Укажи имя, должность и источник цитаты либо убери персонификацию.",
        source_url: null,
      });
    }
  }
  return out;
}

// ---------- Rule 2: FAQ-заголовки без "?" ----------

const FAQ_STARTS = ["Как ", "Что ", "Какой ", "Какая ", "Какие ", "Почему ", "Можно ли ", "Стоит ли "];

function findFaqNoQuestion(text: string): Finding[] {
  const out: Finding[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const isMd = /^#{1,6}\s+/.test(line);
    const htmlM = line.match(/^<h[1-6][^>]*>(.*?)<\/h[1-6]>\s*$/i);
    let inner = line;
    if (isMd) inner = line.replace(/^#{1,6}\s+/, "");
    else if (htmlM) inner = htmlM[1];
    else if (rawLine.startsWith(" ") || rawLine.startsWith("\t")) continue;

    const isHeading = isMd || !!htmlM || (inner.length <= 100 && !/[.!?…:;]$/.test(inner));
    if (!isHeading) continue;
    if (!FAQ_STARTS.some((p) => inner.startsWith(p))) continue;
    if (inner.includes("?")) continue;

    out.push({
      type: "seam",
      severity: "minor",
      quote: inner,
      verdict: "FAQ-заголовок оформлен как вопрос, но без знака вопроса.",
      suggested_fix: inner.replace(/[\s.:;]*$/, "") + "?",
      source_url: null,
    });
  }
  return out;
}

// ---------- Rule 3: keyword-stuffing (фраза 3+ слов, 4+ повторов в абзаце или 6+ в тексте) ----------

function findKeywordStuffing(text: string): Finding[] {
  const out: Finding[] = [];
  const paragraphs = text.split(/\n{2,}/);
  const perParagraph: Array<Map<string, number>> = [];
  const totalCounts = new Map<string, number>();

  for (const p of paragraphs) {
    const norm = p.toLowerCase().replace(/ё/g, "е");
    const words = norm.split(/[^а-яa-z0-9]+/i).filter((w) => w.length > 2);
    const pCounts = new Map<string, number>();
    if (words.length >= 9) {
      for (let n = 3; n <= 5; n++) {
        for (let i = 0; i + n <= words.length; i++) {
          const gram = words.slice(i, i + n).join(" ");
          pCounts.set(gram, (pCounts.get(gram) || 0) + 1);
        }
      }
    }
    perParagraph.push(pCounts);
    for (const [g, c] of pCounts) totalCounts.set(g, (totalCounts.get(g) || 0) + c);
  }

  type Cand = { gram: string; total: number; paragraphMax: number };
  const candidates: Cand[] = [];
  const seen = new Set<string>();
  for (const pCounts of perParagraph) {
    for (const g of pCounts.keys()) {
      if (seen.has(g)) continue;
      const total = totalCounts.get(g) || 0;
      let paragraphMax = 0;
      for (const m of perParagraph) paragraphMax = Math.max(paragraphMax, m.get(g) || 0);
      if (paragraphMax >= 4 || total >= 6) {
        candidates.push({ gram: g, total, paragraphMax });
        seen.add(g);
      }
    }
  }

  // Merge overlaps: keep longest phrase, sum counts
  candidates.sort(
    (a, b) => b.gram.split(" ").length - a.gram.split(" ").length || b.total - a.total,
  );
  const kept: Cand[] = [];
  for (const cand of candidates) {
    const cw = cand.gram.split(" ");
    let merged = false;
    for (const k of kept) {
      const kw = k.gram.split(" ");
      const shared = cw.filter((w) => kw.includes(w)).length;
      const minLen = Math.min(cw.length, kw.length);
      if (shared / minLen > 0.5) {
        k.total += cand.total;
        k.paragraphMax = Math.max(k.paragraphMax, cand.paragraphMax);
        merged = true;
        break;
      }
    }
    if (!merged) kept.push({ ...cand });
  }

  for (const k of kept) {
    const parts = k.gram.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const exactRe = new RegExp(
      CYR_LEFT + parts.join("[^а-яёА-ЯЁa-zA-Z0-9]+") + CYR_RIGHT,
      "i",
    );
    const match = text.match(exactRe);
    const quote = match ? match[0] : k.gram;
    const severity: FindingSeverity = k.paragraphMax >= 5 ? "major" : "minor";
    out.push({
      type: "keyword_stuffing",
      severity,
      quote,
      verdict: `Фраза повторена ${k.total} раз — переспам.`,
      suggested_fix: "Замени часть повторов синонимами или перестрой предложения.",
      source_url: null,
    });
  }
  return out;
}

// ---------- Rule 4: оборванные предложения (3–7 слов без глагола, конец точкой) ----------

const VERB_HINTS = [
  /(?:ть|ться|тся|л|ла|ло|ли|ит|ат|ят|ет|ют|ут|им|ем|ешь|ишь|ал|ял|ил|ел|ала|яла|ила|ела|ало|яло|ило|ело)$/i,
];
// Краткие причастия/прилагательные: оформлен, получена, запрещены, разрешено — 4+ букв.
const SHORT_PARTICIPLE_RE = /^[а-яa-z]{4,}(?:но|на|ны|ен)$/i;
const VERB_WHITELIST = new Set([
  "есть","нет","был","была","было","были","будет","будут","стал","стала","стало","стали",
  "может","могут","нужно","надо","можно","стоит","решает","показывает","отмечают","рекомендуют",
  "работает","подходит","годится","делает","делают",
  // Предикативы и модальные слова — не глаголы, но делают предложение полноценным.
  "необходимо","нельзя","важно","следует","обязательно","достаточно","желательно","возможно",
  "запрещено","разрешено",
]);

function looksLikeVerb(word: string): boolean {
  const w = word.toLowerCase().replace(/ё/g, "е");
  if (VERB_WHITELIST.has(w)) return true;
  if (SHORT_PARTICIPLE_RE.test(w)) return true;
  return VERB_HINTS.some((re) => re.test(w));
}

function findBrokenSentences(text: string): Finding[] {
  const out: Finding[] = [];
  const sentRe = /[^.!?…]+[.!?…]+/g;
  let m: RegExpExecArray | null;
  while ((m = sentRe.exec(text)) !== null) {
    const trimmed = m[0].trim();
    if (!/\.$/.test(trimmed)) continue;
    const words = trimmed.replace(/[.!?…]+$/g, "").split(/[^а-яёА-ЯЁa-zA-Z0-9-]+/).filter(Boolean);
    if (words.length < 3 || words.length > 7) continue;
    if (words.some(looksLikeVerb)) continue;
    out.push({
      type: "logic_break",
      severity: "major",
      quote: trimmed,
      verdict: `Оборванное предложение из ${words.length} слов без глагола.`,
      suggested_fix: null,
      source_url: null,
    });
  }
  return out;
}

export function runLayer1Rules(text: string): Finding[] {
  if (!text || typeof text !== "string") return [];
  return [
    ...findAnonExperts(text),
    ...findFaqNoQuestion(text),
    ...findKeywordStuffing(text),
    ...findBrokenSentences(text),
  ];
}