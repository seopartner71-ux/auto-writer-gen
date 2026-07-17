// Deep Fact Check — Layer 1 (deterministic rules, no LLM).
// Все новые файлы; существующие пайплайны не трогаем.
//
// ВАЖНО: \b в JS-регэкспах не срабатывает на кириллице, поэтому границы
// слов имитируем look-around'ами (?<![а-яёА-ЯЁ]) / (?![а-яёА-ЯЁ]).

export type FindingSeverity = "info" | "warn" | "error";

export interface Finding {
  id: string;               // стабильный id: rule + hash позиции
  ruleId: string;           // "anon_expert" | "faq_no_question" | "keyword_stuffing" | "broken_sentence"
  severity: FindingSeverity;
  message: string;          // человекочитаемое описание
  snippet: string;          // фрагмент текста (до 200 символов)
  offsetStart: number;      // индекс начала в исходном тексте
  offsetEnd: number;        // индекс конца (эксклюзив)
  meta?: Record<string, unknown>;
}

// ---------- helpers ----------

const CYR_LEFT = "(?<![а-яёА-ЯЁa-zA-Z0-9])";
const CYR_RIGHT = "(?![а-яёА-ЯЁa-zA-Z0-9])";

function mkId(ruleId: string, offset: number): string {
  return `${ruleId}_${offset}`;
}

function makeSnippet(text: string, start: number, end: number, pad = 40): string {
  const from = Math.max(0, start - pad);
  const to = Math.min(text.length, end + pad);
  return text.slice(from, to).replace(/\s+/g, " ").trim();
}

// ---------- Rule 1: безымянные эксперты рядом с цитатой ----------

const ANON_EXPERT_PATTERNS = [
  "практика показывает",
  "эксперты отмечают",
  "специалисты рекомендуют",
  "опытные мастера",
  "профессионалы сходятся",
];

// Цитата: «...» либо "..." (в т.ч. кривые кавычки). Мин. 2 символа внутри.
const QUOTE_RE = /«[^«»]{2,}»|"[^"]{2,}"|"[^"]{2,}"|"[^"]{2,}"/g;

function findAnonExperts(text: string): Finding[] {
  const findings: Finding[] = [];
  const quotes: Array<{ start: number; end: number }> = [];
  QUOTE_RE.lastIndex = 0;
  let qm: RegExpExecArray | null;
  while ((qm = QUOTE_RE.exec(text)) !== null) {
    quotes.push({ start: qm.index, end: qm.index + qm[0].length });
  }
  if (quotes.length === 0) return findings;

  for (const phrase of ANON_EXPERT_PATTERNS) {
    const re = new RegExp(CYR_LEFT + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + CYR_RIGHT, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const pStart = m.index;
      const pEnd = m.index + m[0].length;
      // Ищем ближайшую кавычку в пределах 200 символов
      const near = quotes.find((q) => {
        const dist = q.start >= pEnd ? q.start - pEnd : pStart - q.end;
        return dist >= 0 && dist <= 200;
      });
      if (!near) continue;
      findings.push({
        id: mkId("anon_expert", pStart),
        ruleId: "anon_expert",
        severity: "warn",
        message: `Безымянный эксперт рядом с цитатой: «${m[0]}». Укажи имя, должность и источник.`,
        snippet: makeSnippet(text, Math.min(pStart, near.start), Math.max(pEnd, near.end), 20),
        offsetStart: pStart,
        offsetEnd: pEnd,
        meta: { phrase: m[0], quoteStart: near.start, quoteEnd: near.end },
      });
    }
  }
  return findings;
}

// ---------- Rule 2: FAQ-заголовки без "?" ----------

const FAQ_STARTS = ["Как ", "Что ", "Какой ", "Какая ", "Какие ", "Почему ", "Можно ли ", "Стоит ли "];

function findFaqNoQuestion(text: string): Finding[] {
  const findings: Finding[] = [];
  // Идем построчно, сохраняем оффсеты
  const lines = text.split(/\r?\n/);
  let offset = 0;
  for (const rawLine of lines) {
    const lineStart = offset;
    offset += rawLine.length + 1; // +1 за \n

    // Убираем markdown/html-префиксы заголовков: #, ##, <h2>, <h3>
    let line = rawLine.trim();
    if (!line) continue;
    const isMdHeading = /^#{1,6}\s+/.test(line);
    const htmlHeadingMatch = line.match(/^<h[1-6][^>]*>(.*?)<\/h[1-6]>\s*$/i);
    let inner = line;
    if (isMdHeading) inner = line.replace(/^#{1,6}\s+/, "");
    else if (htmlHeadingMatch) inner = htmlHeadingMatch[1];
    else if (rawLine.startsWith(" ") || rawLine.startsWith("\t")) {
      // не-заголовок с ведущими пробелами — пропуск
      continue;
    }

    // Заголовком считаем: markdown/html-заголовок ИЛИ короткая строка (<=100)
    // без терминатора в конце, окружённая пустыми строками (или в начале/конце).
    const isHeading = isMdHeading || !!htmlHeadingMatch || (inner.length <= 100 && !/[.!?…:;]$/.test(inner.replace(/\s+$/, "")));
    if (!isHeading) continue;

    const startsAsQuestion = FAQ_STARTS.some((p) => inner.startsWith(p));
    if (!startsAsQuestion) continue;
    if (inner.includes("?")) continue;

    findings.push({
      id: mkId("faq_no_question", lineStart),
      ruleId: "faq_no_question",
      severity: "warn",
      message: `FAQ-заголовок без знака вопроса: "${inner}".`,
      snippet: inner,
      offsetStart: lineStart,
      offsetEnd: lineStart + rawLine.length,
    });
  }
  return findings;
}

// ---------- Rule 3: keyword-stuffing (фраза 3+ слов, 3+ повторов в абзаце) ----------

function findKeywordStuffing(text: string): Finding[] {
  const findings: Finding[] = [];
  const paragraphs = text.split(/\n{2,}/);
  let base = 0;
  for (const p of paragraphs) {
    const paraStart = text.indexOf(p, base);
    base = paraStart + p.length;

    const norm = p.toLowerCase().replace(/ё/g, "е");
    const words = norm.split(/[^а-яa-z0-9]+/i).filter((w) => w.length > 2);
    if (words.length < 9) continue;

    const counts = new Map<string, number>();
    for (let n = 3; n <= 5; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n).join(" ");
        counts.set(gram, (counts.get(gram) || 0) + 1);
      }
    }
    const reported = new Set<string>();
    for (const [gram, count] of counts.entries()) {
      if (count < 3) continue;
      // отсекаем супер-фразы, если её подстрока уже дала алерт с той же частотой
      let redundant = false;
      for (const r of reported) {
        if (gram.includes(r)) { redundant = true; break; }
      }
      if (redundant) continue;
      reported.add(gram);
      findings.push({
        id: mkId("keyword_stuffing", paraStart) + "_" + gram.replace(/\s+/g, "_"),
        ruleId: "keyword_stuffing",
        severity: "warn",
        message: `Фраза «${gram}» повторена ${count} раз в одном абзаце.`,
        snippet: makeSnippet(text, paraStart, paraStart + Math.min(200, p.length), 0),
        offsetStart: paraStart,
        offsetEnd: paraStart + p.length,
        meta: { phrase: gram, count },
      });
    }
  }
  return findings;
}

// ---------- Rule 4: оборванные предложения (3–7 слов без глагола) ----------

// Грубый признак глагола: русские глагольные окончания + список частых форм.
// Достаточно эвристики: если хоть одно слово подпадает — считаем «глагол есть».
const VERB_HINTS = [
  /(?:ть|ться|тся|л|ла|ло|ли|ит|ат|ят|ет|ют|ут|им|ем|ешь|ишь|ал|ял|ил|ел|ала|яла|ила|ела|ало|яло|ило|ело)$/i,
];
const VERB_WHITELIST = new Set([
  "есть","нет","был","была","было","были","будет","будут","стал","стала","стало","стали",
  "может","могут","нужно","надо","можно","стоит","решает","показывает","отмечают","рекомендуют",
  "работает","подходит","годится","делает","делают",
]);

function looksLikeVerb(word: string): boolean {
  const w = word.toLowerCase().replace(/ё/g, "е");
  if (VERB_WHITELIST.has(w)) return true;
  return VERB_HINTS.some((re) => re.test(w));
}

function findBrokenSentences(text: string): Finding[] {
  const findings: Finding[] = [];
  // Разбиваем по предложениям, сохраняя позицию
  const sentRe = /[^.!?…]+[.!?…]+/g;
  let m: RegExpExecArray | null;
  while ((m = sentRe.exec(text)) !== null) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    const trimmed = raw.trim();
    if (!/\.$/.test(trimmed)) continue; // только точка (не ! ? …)
    const words = trimmed.replace(/[.!?…]+$/g, "").split(/[^а-яёА-ЯЁa-zA-Z0-9-]+/).filter(Boolean);
    if (words.length < 3 || words.length > 7) continue;
    if (words.some(looksLikeVerb)) continue;
    findings.push({
      id: mkId("broken_sentence", start),
      ruleId: "broken_sentence",
      severity: "warn",
      message: `Предложение из ${words.length} слов без глагола: "${trimmed}".`,
      snippet: trimmed,
      offsetStart: start,
      offsetEnd: end,
      meta: { wordCount: words.length },
    });
  }
  return findings;
}

// ---------- entrypoint ----------

export function runLayer1Rules(text: string): Finding[] {
  if (!text || typeof text !== "string") return [];
  const out: Finding[] = [];
  out.push(...findAnonExperts(text));
  out.push(...findFaqNoQuestion(text));
  out.push(...findKeywordStuffing(text));
  out.push(...findBrokenSentences(text));
  out.sort((a, b) => a.offsetStart - b.offsetStart);
  return out;
}