// Канцеляризм-гард: ищет в тексте запрещённые обороты из BANLIST.
// Используется на выходе генерации как часть пост-валидации.
//
// Контракт совпадает с sentenceStructure.ts:
//   analyzeCancellary(text) -> metrics
//   buildCancellaryFixHint(metrics) -> string | null

const BANNED_PHRASES = [
  // канцеляризмы
  "является", "осуществляет", "производится", "в целях", "в рамках", "в связи с",
  "на сегодняшний день", "в настоящее время", "данный", "вышеуказанный",
  "вышеперечисленный", "ввиду того что", "по причине того что",
  // вода
  "стоит отметить", "следует отметить", "стоит сказать", "стоит подчеркнуть",
  "как известно", "не секрет что", "ни для кого не секрет", "хотелось бы сказать",
  "хочется отметить", "необходимо понимать", "важно понимать", "в современном мире",
  // штампы
  "играет важную роль", "имеет большое значение", "оказывает влияние",
  "представляет собой", "пользуется популярностью", "набирает обороты",
  "не теряет актуальности",
  // клише и заглушки
  "контент правит миром", "средняя температура по больнице",
  "бегите от таких специалистов", "не все так однозначно",
  "прямой ответ таков", "разберемся подробнее", "рассмотрим детальнее",
  "поговорим об этом",
  // анонимные ссылки на «экспертов» и «опыт» — маркер fake-authority
  "практика показывает", "опыт показывает", "как показывает практика",
  "как показывает опыт", "по мнению экспертов", "отмечают специалисты",
  "специалисты отрасли отмечают", "по наблюдениям специалистов",
];

// English starter banlist. Kept intentionally small: only the most obvious
// LLM/blog clichés and vague hedges. Extend as we ship more en content.
//
// Exported so the EN writer/humanize prompts pull the SAME list (single
// source of truth: new phrase here = enforced at prompt time AND at
// post-generation validation time).
export const BANNED_PHRASES_EN = [
  "here's the kicker", "let that sink in", "real talk", "game-changer",
  "game changer", "let's dive in", "let's dive into", "in today's fast-paced world",
  "it's worth noting", "at the end of the day",
  // anonymous-authority tells
  "studies show", "experts say", "experts recommend", "specialists note",
  "industry insiders", "research suggests", "it is widely known",
  // LLM connective tissue
  "furthermore", "moreover", "in conclusion", "in summary", "essentially",
  "delve into", "leverage", "utilize", "plays a crucial role",
  "comprehensive guide", "it should be noted", "it is important to note",
];

export interface CancellaryHit {
  phrase: string;
  count: number;
  samples: string[];
}

export interface CancellaryMetrics {
  totalHits: number;
  uniqueHits: number;
  hits: CancellaryHit[];
  verdict: "pass" | "warning" | "fail";
  issues: string[];
}

export interface CancellaryOptions {
  /** "soft" — пороги fail повышаются в 2 раза (blogger/provocateur). */
  strictness?: "soft" | "hard";
  /** Язык статьи — переключает набор запрещённых фраз. По умолчанию "ru". */
  language?: "ru" | "en";
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function snippetAround(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + len + 40);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

export function analyzeCancellary(text: string, options: CancellaryOptions = {}): CancellaryMetrics {
  const soft = options.strictness === "soft";
  const isEn = options.language === "en";
  const phrases = isEn ? BANNED_PHRASES_EN : BANNED_PHRASES;
  const lower = normalize(text);
  const hits: CancellaryHit[] = [];
  let total = 0;

  for (const phrase of phrases) {
    // JS `\b` is ASCII-only and does NOT match Cyrillic word boundaries — a
    // regex like /\bпрактика\b/ never fires on russian text. Use explicit
    // Unicode word-char lookarounds so the banlist actually works in RU.
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}_])`, "gu");
    const samples: string[] = [];
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = re.exec(lower)) !== null) {
      count++;
      if (samples.length < 2) samples.push(snippetAround(text, m.index, phrase.length));
      if (count > 50) break;
    }
    if (count > 0) {
      hits.push({ phrase, count, samples });
      total += count;
    }
  }

  const uniqueHits = hits.length;
  const maxSingle = hits.reduce((a, h) => Math.max(a, h.count), 0);

  const issues: string[] = [];
  if (uniqueHits > 0) issues.push(`Найдено ${uniqueHits} уникальных запрещённых оборотов (всего вхождений ${total}).`);
  const repeatLimit = soft ? 5 : 3;
  if (maxSingle >= repeatLimit) issues.push(`Один и тот же оборот повторяется ${maxSingle} раз — переформулируй.`);

  const failUnique = soft ? 6 : 3;
  const fail = uniqueHits > failUnique || maxSingle >= repeatLimit;
  const warning = uniqueHits > 0;
  const verdict: "pass" | "warning" | "fail" = fail ? "fail" : warning ? "warning" : "pass";

  // sort: сначала самые частые
  hits.sort((a, b) => b.count - a.count);

  return { totalHits: total, uniqueHits, hits, verdict, issues };
}

export function buildCancellaryFixHint(m: CancellaryMetrics): string | null {
  if (m.verdict === "pass") return null;
  const lines: string[] = ["Убери из текста запрещённые канцеляризмы и штампы. Перепиши фразы целиком, не заменяй слово в слово."];
  for (const h of m.hits.slice(0, 10)) {
    lines.push(`  • "${h.phrase}" — ${h.count} раз. Пример: ${h.samples[0] || ""}`);
  }
  lines.push("Замени конкретикой, фактом, действием. Если нечем заменить — выкидывай фразу целиком.");
  return lines.join("\n");
}