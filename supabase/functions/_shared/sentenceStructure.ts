// Анализатор структуры предложений.
// Считает: среднюю длину, долю коротких, серии "3+ коротких подряд".
// Используется на выходе генерации (generate-article, bulk-generate),
// чтобы поймать "телеграфный" AI-стиль и при необходимости запустить переписывание.
//
// Пороги соответствуют antiTurgenevAddon:
//   - короткое предложение: < 8 слов
//   - длинное: > 25 слов
//   - целевая средняя длина: 18-30 слов
//   - запрещены серии из 3+ коротких подряд
//   - доля коротких в норме <= 25%

export interface SentenceStructureMetrics {
  sentenceCount: number;
  wordCount: number;
  avgWords: number;
  shortCount: number;     // < SHORT_MAX слов
  longCount: number;      // > LONG_MIN слов
  shortRatio: number;     // 0..1
  longRatio: number;      // 0..1
  maxShortRun: number;    // макс. длина серии коротких подряд
  shortRuns3Plus: Array<{ start: number; length: number; preview: string }>;
  verdict: "pass" | "warning" | "fail";
  issues: string[];       // человекочитаемые замечания
}

export interface SentenceStructureOptions {
  shortMax?: number;      // строго меньше -> короткое
  longMin?: number;       // строго больше -> длинное
  avgMin?: number;
  avgMax?: number;
  maxShortRatio?: number; // допустимая доля коротких
  maxShortRun?: number;   // допустимая длина серии коротких подряд (включительно)
}

const DEFAULTS: Required<SentenceStructureOptions> = {
  shortMax: 8,
  longMin: 25,
  avgMin: 18,
  avgMax: 30,
  maxShortRatio: 0.25,
  maxShortRun: 2,
};

// Грубая очистка markdown/html, чтобы заголовки/код/списки не искажали статистику.
function stripMarkup(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ")          // fenced code
    .replace(/`[^`]*`/g, " ")                  // inline code
    .replace(/<[^>]+>/g, " ")                  // html tags
    .replace(/^\s{0,3}#{1,6}\s.*$/gm, " ")     // markdown headings
    .replace(/^\s{0,3}[-*+]\s+/gm, " ")        // list markers
    .replace(/^\s{0,3}\d+\.\s+/gm, " ")        // ordered list markers
    .replace(/\|/g, " ")                       // table pipes
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")     // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // links -> текст
    .replace(/[*_~]+/g, "")                    // emphasis
    .replace(/\s+/g, " ")
    .trim();
}

// Сегментация по конечным знакам с защитой от частых сокращений и инициалов.
const ABBR = new Set([
  "г","гг","т","тт","см","напр","и.т.д","и.т.п","т.д","т.п","т.е","т.к",
  "стр","рис","табл","ст","руб","коп","ул","пр","пер","им",
  "mr","mrs","ms","dr","prof","vs","etc","inc","ltd","corp",
]);

function splitSentences(text: string): string[] {
  const clean = stripMarkup(text);
  if (!clean) return [];
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    buf += ch;
    if (ch === "." || ch === "!" || ch === "?" || ch === "…") {
      // не дробим многоточие . . .
      const next = clean[i + 1] || "";
      if (ch === "." && (clean[i + 1] === "." || clean[i - 1] === ".")) continue;
      // сокращение перед точкой
      if (ch === ".") {
        const tail = buf.slice(0, -1).split(/\s+/).pop()?.toLowerCase().replace(/[^a-zа-яё.]/gi, "") || "";
        if (tail && ABBR.has(tail)) continue;
        // инициал (одна буква + точка)
        if (/^[A-ZА-ЯЁ]$/.test(buf.slice(-2, -1))) continue;
      }
      // должен идти пробел/конец и след. символ - заглавная или конец
      if (!next || /\s/.test(next)) {
        const s = buf.trim();
        if (s) out.push(s);
        buf = "";
      }
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

function countWords(sentence: string): number {
  const stripped = sentence.replace(/[^\p{L}\p{N}\-']+/gu, " ").trim();
  if (!stripped) return 0;
  return stripped.split(/\s+/).length;
}

export function analyzeSentenceStructure(
  text: string,
  options: SentenceStructureOptions = {},
): SentenceStructureMetrics {
  const opts = { ...DEFAULTS, ...options };
  const sentences = splitSentences(text);
  const lengths = sentences.map(countWords).filter((n) => n > 0);
  const sentenceCount = lengths.length;
  const wordCount = lengths.reduce((a, b) => a + b, 0);
  const avgWords = sentenceCount ? +(wordCount / sentenceCount).toFixed(2) : 0;

  const shortFlags = lengths.map((n) => n < opts.shortMax);
  const shortCount = shortFlags.filter(Boolean).length;
  const longCount = lengths.filter((n) => n > opts.longMin).length;
  const shortRatio = sentenceCount ? +(shortCount / sentenceCount).toFixed(3) : 0;
  const longRatio = sentenceCount ? +(longCount / sentenceCount).toFixed(3) : 0;

  // Серии коротких подряд
  const runs: Array<{ start: number; length: number; preview: string }> = [];
  let runStart = -1;
  let runLen = 0;
  let maxShortRun = 0;
  const finalize = (endExclusive: number) => {
    if (runLen > maxShortRun) maxShortRun = runLen;
    if (runLen >= 3) {
      const slice = sentences.slice(runStart, endExclusive).join(" ");
      runs.push({
        start: runStart,
        length: runLen,
        preview: slice.length > 220 ? slice.slice(0, 217) + "…" : slice,
      });
    }
    runStart = -1;
    runLen = 0;
  };
  for (let i = 0; i < shortFlags.length; i++) {
    if (shortFlags[i]) {
      if (runStart === -1) runStart = i;
      runLen++;
    } else if (runStart !== -1) {
      finalize(i);
    }
  }
  if (runStart !== -1) finalize(shortFlags.length);

  const issues: string[] = [];
  if (sentenceCount === 0) {
    issues.push("Не удалось разобрать ни одного предложения.");
  } else {
    if (avgWords < opts.avgMin) issues.push(`Средняя длина предложения ${avgWords} слов - ниже нормы (${opts.avgMin}-${opts.avgMax}).`);
    if (avgWords > opts.avgMax) issues.push(`Средняя длина предложения ${avgWords} слов - выше нормы (${opts.avgMin}-${opts.avgMax}).`);
    if (shortRatio > opts.maxShortRatio) issues.push(`Доля коротких предложений ${(shortRatio * 100).toFixed(0)}% - выше допустимых ${(opts.maxShortRatio * 100).toFixed(0)}%.`);
    if (maxShortRun > opts.maxShortRun) issues.push(`Найдены серии из ${maxShortRun} коротких предложений подряд (норма не более ${opts.maxShortRun}).`);
  }

  const fail = maxShortRun >= 3 || shortRatio > opts.maxShortRatio + 0.15 || avgWords < opts.avgMin - 4;
  const warning = issues.length > 0;
  const verdict: "pass" | "warning" | "fail" = fail ? "fail" : warning ? "warning" : "pass";

  return {
    sentenceCount,
    wordCount,
    avgWords,
    shortCount,
    longCount,
    shortRatio,
    longRatio,
    maxShortRun,
    shortRuns3Plus: runs,
    verdict,
    issues,
  };
}

// Короткая текстовая инструкция для модели-переписчика, основанная на метриках.
export function buildSentenceStructureFixHint(m: SentenceStructureMetrics): string | null {
  if (m.verdict === "pass") return null;
  const lines: string[] = ["Перепиши абзацы, нарушающие структуру предложений:"];
  for (const issue of m.issues) lines.push(`- ${issue}`);
  if (m.shortRuns3Plus.length) {
    lines.push("Примеры серий рубленых фраз (объедини в сложные предложения через 'поскольку', 'при этом', 'хотя', 'однако'):");
    for (const r of m.shortRuns3Plus.slice(0, 5)) {
      lines.push(`  • ${r.preview}`);
    }
  }
  lines.push("Цель: средняя длина 18-30 слов, доля коротких не более 25%, без серий из 3+ коротких подряд.");
  return lines.join("\n");
}