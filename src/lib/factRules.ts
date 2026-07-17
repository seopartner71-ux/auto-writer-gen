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

// ---------- HTML cleaner (all rules run on plain text) ----------

function cleanHtml(text: string): string {
  return text
    .replace(
      /<\/(?:p|div|h[1-6]|li|ul|ol|tr|td|th|table|section|article|header|footer|blockquote)\s*>/gi,
      "\n",
    )
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

function stripInlineTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

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

// ---------- Rule 2: FAQ-заголовки без "?" (только h3 внутри FAQ-секции) ----------

const FAQ_STARTS = ["Как ", "Что ", "Какой ", "Какая ", "Какие ", "Почему ", "Можно ли ", "Стоит ли "];
const FAQ_SECTION_RE = /(?:вопросы\s+и\s+ответы|FAQ)/i;

function findFaqNoQuestion(rawText: string): Finding[] {
  const out: Finding[] = [];
  let inFaq = false;
  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let level = 0;
    let inner = "";
    const mdM = line.match(/^(#{1,6})\s+(.*)$/);
    const htmlM = line.match(/^<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>\s*$/i);
    if (mdM) {
      level = mdM[1].length;
      inner = mdM[2];
    } else if (htmlM) {
      level = parseInt(htmlM[1], 10);
      inner = htmlM[2];
    } else {
      continue;
    }
    inner = stripInlineTags(inner);
    if (!inner) continue;

    const isFaqHeader = FAQ_SECTION_RE.test(inner);

    // h1/h2 всегда переопределяют FAQ-контекст.
    if (level <= 2) {
      inFaq = isFaqHeader;
      continue;
    }
    // h3 с "FAQ" в тексте тоже открывает секцию, но сам не проверяется.
    if (level === 3 && isFaqHeader) {
      inFaq = true;
      continue;
    }
    // Проверяем только h3 внутри активной FAQ-секции.
    if (level !== 3 || !inFaq) continue;

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

// ---------- Rule 4: оборванные предложения (три жёстких паттерна) ----------

const VERB_HINTS = [
  /(?:ть|ться|тся|ит|ат|ят|ет|ют|ут|им|ем|ешь|ишь|ал|ял|ил|ел|ала|яла|ила|ела|ало|яло|ило|ело|йте|ьте)$/i,
];
// Краткие причастия / прилагательные: оформлен, получена, запрещены, разрешено (4+ букв).
const SHORT_PARTICIPLE_RE = /^[а-яa-z]{4,}(?:но|на|ны|ен)$/i;
const VERB_WHITELIST = new Set([
  "есть","нет","был","была","было","были","будет","будут","стал","стала","стало","стали",
  "может","могут","нужно","надо","можно","стоит","решает","показывает","отмечают","рекомендуют",
  "работает","подходит","годится","делает","делают",
  // Предикативы и модальные слова.
  "необходимо","нельзя","важно","следует","обязательно","достаточно","желательно","возможно",
  "запрещено","разрешено",
  // Краткие повелительные / формы, часто теряющие суффикс.
  "бери","берите","храни","храните","нажми","нажмите","проверь","проверьте","понюхай","понюхайте",
]);

function looksLikeVerb(word: string): boolean {
  const w = word.toLowerCase().replace(/ё/g, "е");
  if (VERB_WHITELIST.has(w)) return true;
  if (SHORT_PARTICIPLE_RE.test(w)) return true;
  return VERB_HINTS.some((re) => re.test(w));
}

const SUBORDINATORS_ONE = new Set(["если","когда","хотя","пока","чтобы"]);
const SUBORDINATORS_TWO = ["потому что","так как"];

const END_PREPOSITIONS = new Set([
  "в","во","на","за","от","до","по","из","к","ко","у","с","со","о","об","обо",
  "для","при","про","через","между","над","под","перед","без","около","среди","ради","вокруг",
]);
const END_CONJUNCTIONS = new Set(["и","а","но","или","что","как","же","ли","то","чтобы","если","когда"]);

const START_PREPOSITIONS = new Set(["по","в","во","на","для","при","из","от","с","со","у","к","ко","о","об"]);

function findBrokenSentences(text: string): Finding[] {
  const out: Finding[] = [];
  const sentRe = /[^.!?…]+[.!?…]+/g;
  let m: RegExpExecArray | null;
  while ((m = sentRe.exec(text)) !== null) {
    const raw = m[0].trim();
    if (!raw) continue;
    if (!/\.$/.test(raw)) continue; // только точка
    // Тире-связка ("X - это Y", назывные, эллиптические) — пропускаем.
    if (/\s[-—–]\s/.test(raw)) continue;

    const body = raw.replace(/[.!?…]+$/g, "").trim();
    const tokens = body.split(/[^а-яёА-ЯЁa-zA-Z0-9]+/).filter(Boolean);
    if (tokens.length < 2) continue;

    // Повелительное наклонение — пропускаем.
    if (tokens.some((t) => /(?:йте|ьте|ите)$/i.test(t) && looksLikeVerb(t))) continue;

    const first = tokens[0].toLowerCase().replace(/ё/g, "е");
    const firstTwo = (tokens[0] + " " + (tokens[1] ?? "")).toLowerCase().replace(/ё/g, "е");
    const last = tokens[tokens.length - 1].toLowerCase().replace(/ё/g, "е");
    const hasComma = /,/.test(body);

    // (а) Придаточное без главной части.
    const startsSub = SUBORDINATORS_ONE.has(first) || SUBORDINATORS_TWO.some((s) => firstTwo.startsWith(s));
    if (startsSub && !hasComma) {
      out.push({
        type: "seam",
        severity: "minor",
        quote: raw,
        verdict: "Придаточное без главной части — нет второй клаузы.",
        suggested_fix: null,
        source_url: null,
      });
      continue;
    }

    // (б) Оканчивается на предлог / союз / число с точкой.
    if (END_PREPOSITIONS.has(last) || END_CONJUNCTIONS.has(last) || /^\d+$/.test(last)) {
      out.push({
        type: "seam",
        severity: "major",
        quote: raw,
        verdict: "Предложение обрывается на предлоге, союзе или числе.",
        suggested_fix: null,
        source_url: null,
      });
      continue;
    }

    // (в) Начинается с предлога и не содержит сказуемого / предикатива.
    if (START_PREPOSITIONS.has(first)) {
      const hasPredicate = tokens.some((t) => looksLikeVerb(t));
      if (!hasPredicate) {
        out.push({
          type: "seam",
          severity: "minor",
          quote: raw,
          verdict: "Начинается с предлога, нет сказуемого — обрыв мысли.",
          suggested_fix: null,
          source_url: null,
        });
      }
    }
  }
  return out;
}

export function runLayer1Rules(text: string): Finding[] {
  if (!text || typeof text !== "string") return [];
  const cleaned = cleanHtml(text);
  return [
    ...findAnonExperts(cleaned),
    ...findFaqNoQuestion(text), // нужен исходник для уровня заголовков
    ...findKeywordStuffing(cleaned),
    ...findBrokenSentences(cleaned),
  ];
}