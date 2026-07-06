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
  // Мягкий допуск: не жалуемся, если avg отклоняется от границы <= 1.5 слова.
  // Это убирает пинг-понг между humanize (дробит) и валидатором (жалуется на короткие).
  const AVG_TOLERANCE = 1.5;
  if (sentenceCount === 0) {
    issues.push("Не удалось разобрать ни одного предложения.");
  } else {
    if (avgWords < opts.avgMin - AVG_TOLERANCE) issues.push(`Средняя длина предложения ${avgWords} слов - ниже нормы (${opts.avgMin}-${opts.avgMax}, допуск ${AVG_TOLERANCE}).`);
    if (avgWords > opts.avgMax + AVG_TOLERANCE) issues.push(`Средняя длина предложения ${avgWords} слов - выше нормы (${opts.avgMin}-${opts.avgMax}, допуск ${AVG_TOLERANCE}).`);
    if (shortRatio > opts.maxShortRatio) issues.push(`Доля коротких предложений ${(shortRatio * 100).toFixed(0)}% - выше допустимых ${(opts.maxShortRatio * 100).toFixed(0)}%.`);
    if (maxShortRun > opts.maxShortRun) issues.push(`Найдены серии из ${maxShortRun} коротких предложений подряд (норма не более ${opts.maxShortRun}).`);
  }

  // Fail только при серьёзном отклонении avg (>1.5 слова за границей), либо явных
  // проблемах со структурой (серии коротких/зашкал доли коротких).
  const avgFail = sentenceCount > 0 && (avgWords < opts.avgMin - AVG_TOLERANCE || avgWords > opts.avgMax + AVG_TOLERANCE);
  const fail = maxShortRun >= 4 || shortRatio > opts.maxShortRatio + 0.20 || avgFail;
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

// Структурированная подсказка для Sonnet с жесткими запретами и примерами.
export function buildSentenceStructureFixHint(metrics: SentenceStructureMetrics): string | null {
  if (metrics.verdict === "pass") return null;

  const problems: string[] = [];
  if (metrics.avgWords < 15) {
    problems.push(
      `- Средняя длина предложений слишком короткая: ${metrics.avgWords.toFixed(1)} слов (цель: 18-30).`,
    );
  }
  if (metrics.shortRatio > 0.3) {
    problems.push(
      `- Слишком много коротких предложений: ${Math.round(metrics.shortRatio * 100)}%. Объединяй их в сложные через союзы "при этом", "поэтому", "однако", "а значит".`,
    );
  }
  if (metrics.maxShortRun >= 3) {
    problems.push(
      `- Найдены серии из ${metrics.maxShortRun} коротких предложений подряд. Серии из 3+ коротких подряд запрещены.`,
    );
  }

  if (!problems.length) return null;

  return [
    "ПРОБЛЕМЫ В ТЕКСТЕ:",
    problems.join("\n"),
    "",
    "ЖЕСТКИЕ ЗАПРЕТЫ:",
    "1. Не отрывать придаточные от главного предложения. Если предложение начинается с \"где\", \"что\", \"который\", \"а\", \"но\", \"поэтому\", \"при этом\" - это продолжение предыдущей мысли.",
    "   ПЛОХО: \"Это уместно для маркетплейсов. Где время до листинга решает.\"",
    "   ХОРОШО: \"Это особенно уместно для маркетплейсов, где время до листинга решает все.\"",
    "",
    "2. Не дробить одну мысль на два предложения.",
    "   ПЛОХО: \"P&L тащит не дешевая партия. А оборот и скорость оборачиваемости.\"",
    "   ХОРОШО: \"P&L тащит не дешевая партия, а оборот и скорость оборачиваемости.\"",
    "",
    "3. Не делать три предложения подряд короче 12 слов.",
    "   ПЛОХО: \"Чаще комбинирую. Беру зрелую основу. Получаю быстрый релиз.\"",
    "   ХОРОШО: \"Чаще комбинирую: беру зрелую основу, меняю активы и отдушку - и получаю быстрый релиз без потери характера бренда.\"",
    "",
    "4. Не склеивать несколько мыслей в одно предложение через \"в то время как\", \"поскольку\", \"что\" подряд. Максимум одно придаточное на предложение.",
    "   ПЛОХО: \"Контракт снимает капекс, дает гибкие MOQ, в то время как собственный цех требует вложений, поскольку оборудование дорожает, что создает риски.\"",
    "   ХОРОШО: \"Контракт снимает капекс и дает гибкие MOQ. Собственный цех требует вложений - оборудование дорожает и создает операционные риски.\"",
    "",
    "ЦЕЛЬ:",
    "- Среднее предложение 18-30 слов.",
    "- Короткие предложения до 12 слов допустимы, но не более 2 подряд.",
    "- Придаточные всегда присоединены к главному через запятую или тире.",
    "- Мысль не обрывается на полуслове.",
    "",
    "ВАЖНО: не менять смысл, факты, структуру разделов и HTML-теги - только синтаксис предложений.",
  ].join("\n");
}