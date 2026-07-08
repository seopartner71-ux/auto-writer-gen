// Fake-quote guard.
// Ловит анонимную атрибуцию цитат и «отсылок к авторитету» — маркер
// LLM-текста, который вписывает утверждения от лица безымянных
// «экспертов», «специалистов», «практиков». Пример:
//
//   • «"…правильно подобранный и обслуженный" — практика показывает»
//   • «"…решают 80% проблем" — отмечают практикующие специалисты»
//   • «По наблюдениям специалистов, краски на синтетике капризные»
//   • «Специалисты отрасли отмечают: адсорбент кладут первым»
//
// Только детект + задача автору («назвать источник или удалить»). Автоправок нет.

export interface FakeQuoteHit {
  kind: "in_blockquote" | "inline_attribution" | "narrative_attribution";
  pattern: string;
  preview: string;
}

export interface FakeQuoteMetrics {
  hits: FakeQuoteHit[];
  verdict: "pass" | "warning" | "fail";
  issues: string[];
  task: string | null;
}

// Основной набор шаблонов анонимной атрибуции. Все — регексы по plain-тексту
// (уже нормализованному: lowercase, ё→е). `\b` в JS/Deno не работает на
// кириллице (ASCII-only), поэтому используем Unicode-lookaround boundary.
const B = "(?<![\\p{L}\\p{N}_])"; // left word-char boundary (Unicode)
const E = "(?![\\p{L}\\p{N}_])";  // right word-char boundary (Unicode)
const rx = (body: string) => new RegExp(`${B}${body}${E}`, "u");

const ATTRIBUTION_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "практика/опыт показывает",         re: rx(`(?:практика|опыт)\\s+показывает`) },
  { label: "как показывает практика/опыт",     re: rx(`как\\s+показывает\\s+(?:практика|опыт)`) },
  { label: "по мнению экспертов/специалистов", re: rx(`по\\s+мнению\\s+(?:экспертов|специалистов|практиков|отраслевых\\s+экспертов)`) },
  { label: "по наблюдениям специалистов",      re: rx(`по\\s+наблюдениям\\s+(?:специалистов|экспертов|практиков)`) },
  { label: "по данным/оценкам специалистов",   re: rx(`по\\s+(?:данным|оценкам)\\s+(?:специалистов|экспертов|практиков)`) },
  { label: "специалисты/эксперты (…) отмечают/считают",
    re: rx(`(?:специалисты|эксперты)(?:\\s+[а-яa-z]+){0,3}\\s+(?:отмечают|считают|подч[её]ркивают|указывают|говорят|признают|напоминают)`) },
  { label: "отмечают (…) специалисты/эксперты",
    re: rx(`(?:отмечают|считают|подч[её]ркивают|указывают)\\s+(?:[а-яa-z]+\\s+){0,2}(?:специалисты|эксперты|практики|мастера|монтажники)`) },
  { label: "специалисты отрасли",              re: rx(`специалисты\\s+отрасли`) },
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е");
}

function snippet(s: string, len = 180): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > len ? t.slice(0, len - 1) + "…" : t;
}

function extractBlockquotes(html: string): string[] {
  if (!/<blockquote\b/i.test(html)) return [];
  const out: string[] = [];
  const re = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const txt = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (txt) out.push(txt);
  }
  return out;
}

// Ищет фразу-цитату + анонимную атрибуцию рядом:
//   "…" — практика показывает        (кавычки + тире + фраза)
//   «…» - отмечают эксперты
const INLINE_QUOTE_ATTRIBUTION = /["«"„][^"»"“]{15,}["»"”][\s]*[-—–]+[\s]*([а-яa-z][\s\wа-я]{4,80})/gu;

export function analyzeFakeQuotes(contentHtmlOrText: string): FakeQuoteMetrics {
  const html = contentHtmlOrText || "";
  const plainRaw = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const plain = normalize(plainRaw);
  const hits: FakeQuoteHit[] = [];
  const seen = new Set<string>();

  // 1. Явные <blockquote> с анонимной атрибуцией внутри или сразу после.
  for (const bq of extractBlockquotes(html)) {
    const bqLower = normalize(bq);
    for (const { label, re } of ATTRIBUTION_PATTERNS) {
      const m = bqLower.match(re);
      if (m) {
        const key = `bq:${label}:${bq.slice(0, 60)}`;
        if (!seen.has(key)) {
          seen.add(key);
          hits.push({ kind: "in_blockquote", pattern: label, preview: snippet(bq) });
        }
      }
    }
  }

  // 2. Inline-цитата «"…" — <анонимная атрибуция>» в plain-тексте.
  INLINE_QUOTE_ATTRIBUTION.lastIndex = 0;
  let mm: RegExpExecArray | null;
  while ((mm = INLINE_QUOTE_ATTRIBUTION.exec(plain)) !== null) {
    const tail = mm[1] || "";
    for (const { label, re } of ATTRIBUTION_PATTERNS) {
      if (re.test(tail)) {
        const around = plain.slice(Math.max(0, mm.index - 20), Math.min(plain.length, mm.index + mm[0].length + 20));
        const key = `inline:${label}:${around.slice(0, 60)}`;
        if (!seen.has(key)) {
          seen.add(key);
          hits.push({ kind: "inline_attribution", pattern: label, preview: snippet(around) });
        }
        break;
      }
    }
  }

  // 3. Narrative-предложения, целиком построенные вокруг анонимной атрибуции.
  const sents = plain.split(/(?<=[.!?…])\s+/);
  for (const s of sents) {
    for (const { label, re } of ATTRIBUTION_PATTERNS) {
      if (re.test(s)) {
        const key = `narr:${label}:${s.slice(0, 60)}`;
        if (seen.has(key)) continue;
        // Не дублируем: если это же предложение уже прошло как blockquote/inline
        const alreadyReported = hits.some((h) => normalize(h.preview).includes(s.slice(0, Math.min(50, s.length))));
        if (alreadyReported) continue;
        seen.add(key);
        hits.push({ kind: "narrative_attribution", pattern: label, preview: snippet(s) });
      }
    }
  }

  const issues: string[] = [];
  const inBq = hits.filter((h) => h.kind === "in_blockquote").length;
  const inline = hits.filter((h) => h.kind === "inline_attribution").length;
  const narr = hits.filter((h) => h.kind === "narrative_attribution").length;
  if (inBq) issues.push(`В цитатных блоках ${inBq} безымянных атрибуций (blockquote без указания автора).`);
  if (inline) issues.push(`Найдено ${inline} строк вида "цитата" - анонимная атрибуция.`);
  if (narr) issues.push(`Найдено ${narr} предложений с отсылкой к безымянным экспертам ("по мнению...", "отмечают специалисты" и т.п.).`);

  const total = hits.length;
  const verdict: "pass" | "warning" | "fail" =
    total === 0 ? "pass" : (inBq > 0 || total >= 3 ? "fail" : "warning");

  const task = total === 0 ? null :
    "Назови источник каждой цитаты (имя, должность, компания или конкретное исследование) или удали её. Фразы «практика показывает», «отмечают специалисты», «по мнению экспертов», «по наблюдениям специалистов» без атрибуции — это шаблон LLM-текста и маркер fake authority для судей.";

  return { hits, verdict, issues, task };
}

export function buildFakeQuoteReport(m: FakeQuoteMetrics, max = 8): string | null {
  if (m.verdict === "pass") return null;
  const lines: string[] = ["Убрать безымянные ссылки на «экспертов» и «практику»:"];
  for (const h of m.hits.slice(0, max)) {
    const tag = h.kind === "in_blockquote" ? "blockquote" : h.kind === "inline_attribution" ? "inline-цитата" : "narrative";
    lines.push(`  • [${tag}] «${h.pattern}»: ${h.preview}`);
  }
  if (m.task) lines.push(m.task);
  return lines.join("\n");
}