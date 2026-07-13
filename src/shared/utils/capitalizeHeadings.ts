// Capitalize the first letter of every markdown heading (# / ## / ### ...) and
// of a plain title string. Deterministic, safe for RU/EN. No-op if the first
// letter is already uppercase or is a digit/symbol.
//
// Fix for LLMs that echo lowercase seed keywords verbatim into H1/H2.

const HEADING_RE = /^(\s{0,3}#{1,6}\s+)(.*)$/gm;

function capFirst(s: string): string {
  const m = s.match(/^(\s*[*_"'«»„"“(\[]*\s*)(\p{L})(.*)$/u);
  if (!m) return s;
  const [, pre, ch, rest] = m;
  const up = ch.toLocaleUpperCase();
  if (up === ch) return s;
  return pre + up + rest;
}

export function capitalizeHeadings(markdown: string): string {
  if (!markdown) return markdown;
  return markdown.replace(HEADING_RE, (_all, hashes: string, text: string) => hashes + capFirst(text));
}

export function capitalizeTitle(title: string): string {
  if (!title) return title;
  return capFirst(title);
}

// Safety net: convert every em-dash (—, U+2014) and en-dash (–, U+2013) to a
// plain hyphen-minus "-" (U+002D). Prompts already forbid these characters,
// but LLMs occasionally slip. Runs once at save time. Never touches code fences
// or fenced tables (hyphen is compatible with GFM syntax).
export function stripLongDashes(markdown: string): string {
  if (!markdown) return markdown;
  return markdown.replace(/[\u2014\u2013]/g, "-");
}

// ---------------------------------------------------------------------------
// Toponyms & brand normalization
// ---------------------------------------------------------------------------
// LLMs (Opus, Flash) routinely emit "в туле" / "москве" / "google" instead of
// the correctly-capitalized proper noun. Prompts warn against this, but the
// post-processor is the only place that guarantees a clean surface.
//
// NOTE: JavaScript \b does NOT work with Cyrillic letters, so we use explicit
// negative lookbehind / lookahead on the letter classes we care about.

type RuToponymEntry = { root: string; suffixes: string[]; canonical: string };

// Roots + declension suffixes. Root is lowercase; canonical is the same root
// with the first letter uppercased. Suffix "" means the root itself is a full
// word (Санкт-Петербург, Сочи, СПб).
const RU_TOPONYMS: RuToponymEntry[] = [
  { root: "москв", suffixes: ["а", "е", "у", "ы", "ой", "ою"], canonical: "Москв" },
  { root: "тул",   suffixes: ["а", "е", "у", "ы", "ой", "ою"], canonical: "Тул" },
  { root: "калуг", suffixes: ["а", "е", "у", "и", "ой", "ою"], canonical: "Калуг" },
  { root: "рязан", suffixes: ["ь", "и", "ю", "ью"],           canonical: "Рязан" },
  { root: "ярославл", suffixes: ["ь", "я", "е", "ю", "ем"],   canonical: "Ярославл" },
  { root: "казан", suffixes: ["ь", "и", "ю", "ью"],            canonical: "Казан" },
  { root: "новосибирск", suffixes: ["", "а", "е", "у", "ом"],   canonical: "Новосибирск" },
  { root: "екатеринбург", suffixes: ["", "а", "е", "у", "ом"],  canonical: "Екатеринбург" },
  { root: "нижн", suffixes: ["ий новгород", "его новгорода", "ем новгороде", "ему новгороду", "им новгородом"], canonical: "Нижн" },
  { root: "самар", suffixes: ["а", "е", "у", "ы", "ой"],       canonical: "Самар" },
  { root: "уф",    suffixes: ["а", "е", "у", "ы", "ой"],       canonical: "Уф" },
  { root: "омск",  suffixes: ["", "а", "е", "у", "ом"],        canonical: "Омск" },
  { root: "перм",  suffixes: ["ь", "и", "ю", "ью"],            canonical: "Перм" },
  { root: "воронеж", suffixes: ["", "а", "е", "у", "ем"],       canonical: "Воронеж" },
  { root: "волгоград", suffixes: ["", "а", "е", "у", "ом"],     canonical: "Волгоград" },
  { root: "красноярск", suffixes: ["", "а", "е", "у", "ом"],    canonical: "Красноярск" },
  { root: "саратов", suffixes: ["", "а", "е", "у", "ом"],       canonical: "Саратов" },
  { root: "краснодар", suffixes: ["", "а", "е", "у", "ом"],     canonical: "Краснодар" },
  { root: "ростов", suffixes: ["", "а", "е", "у", "ом"],        canonical: "Ростов" },
  { root: "владивосток", suffixes: ["", "а", "е", "у", "ом"],   canonical: "Владивосток" },
  { root: "иркутск", suffixes: ["", "а", "е", "у", "ом"],       canonical: "Иркутск" },
  { root: "хабаровск", suffixes: ["", "а", "е", "у", "ом"],     canonical: "Хабаровск" },
  { root: "тверь", suffixes: [""],                              canonical: "Тверь" },
  { root: "твер",  suffixes: ["и", "ью"],                       canonical: "Твер" },
  { root: "сочи",  suffixes: [""],                              canonical: "Сочи" },
  { root: "санкт-петербург", suffixes: ["", "а", "е", "у", "ом"], canonical: "Санкт-Петербург" },
  { root: "спб",   suffixes: [""],                              canonical: "СПб" },
  { root: "росси", suffixes: ["я", "и", "ю", "ей", "ею"],       canonical: "Росси" },
];

// Case-preserving exact brand replacements. Written the way they should look.
const RU_BRANDS = [
  "Яндекс", "Google", "ChatGPT", "Claude", "Wildberries", "Ozon",
  "Авито", "VK", "ВКонтакте", "Сбер", "Тинькофф", "1С", "Битрикс",
  "Дзен", "Telegram", "YouTube", "Instagram", "Facebook", "WhatsApp",
  "Microsoft", "Apple", "Amazon", "OpenAI",
];

const EN_TOPONYMS = [
  "Phoenix", "Scottsdale", "Mesa", "Tempe", "Gilbert", "Chandler", "Glendale",
  "Arizona", "New York", "Los Angeles", "Chicago", "Miami", "Houston", "Dallas",
  "Seattle", "Boston", "Atlanta", "Denver", "San Francisco", "San Diego",
  "United States", "USA", "UK", "London", "Canada", "Toronto",
];

const EN_BRANDS = [
  "Google", "ChatGPT", "Claude", "YouTube", "Facebook", "Instagram", "Amazon",
  "Microsoft", "Apple", "OpenAI", "Anthropic", "WhatsApp", "TikTok", "LinkedIn",
];

// escape regex metacharacters in dictionary entries (dots, hyphens, digits).
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Split markdown into segments we CAN touch vs segments we must leave alone
// (fenced code blocks, inline code, autolinks, and markdown link URLs).
// Returns array of { text, safe } segments; only safe=true is processed.
type Seg = { text: string; safe: boolean };
function segmentMarkdown(md: string): Seg[] {
  const out: Seg[] = [];
  const re = /(```[\s\S]*?```|`[^`\n]*`|\]\([^)]*\)|<https?:\/\/[^>]+>|https?:\/\/\S+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    if (m.index > last) out.push({ text: md.slice(last, m.index), safe: true });
    out.push({ text: m[0], safe: false });
    last = re.lastIndex;
  }
  if (last < md.length) out.push({ text: md.slice(last), safe: true });
  return out;
}

function replaceRuToponyms(text: string): string {
  let result = text;
  for (const entry of RU_TOPONYMS) {
    for (const suffix of entry.suffixes) {
      const fullWord = entry.root + suffix;
      const canonicalForm = entry.canonical + suffix;
      // No cyrillic/latin letter or hyphen on either side. \b is not safe for Cyrillic.
      const re = new RegExp(
        `(?<![а-яА-ЯёЁa-zA-Z-])${escapeRe(fullWord)}(?![а-яА-ЯёЁa-zA-Z-])`,
        "gi",
      );
      result = result.replace(re, canonicalForm);
    }
  }
  return result;
}

function replaceExactWords(text: string, words: string[]): string {
  let result = text;
  for (const w of words) {
    const re = new RegExp(
      `(?<![а-яА-ЯёЁa-zA-Z0-9-])${escapeRe(w)}(?![а-яА-ЯёЁa-zA-Z0-9-])`,
      "gi",
    );
    result = result.replace(re, w);
  }
  return result;
}

/**
 * Normalize toponyms and brand names in a markdown article without touching
 * code fences, inline code, or URLs. Runs across the whole document (body +
 * headings) — heading-first-letter capitalization is handled separately by
 * capitalizeHeadings().
 */
export function normalizeToponymsAndBrands(markdown: string, lang: "ru" | "en" = "ru"): string {
  if (!markdown) return markdown;
  const segs = segmentMarkdown(markdown);
  return segs
    .map((s) => {
      if (!s.safe) return s.text;
      let t = s.text;
      if (lang === "ru") {
        t = replaceRuToponyms(t);
        t = replaceExactWords(t, RU_BRANDS);
      } else {
        t = replaceExactWords(t, EN_TOPONYMS);
        t = replaceExactWords(t, EN_BRANDS);
      }
      return t;
    })
    .join("");
}

/**
 * One-shot post-processor for saved article content. Order matters:
 *  1) strip em/en dashes,
 *  2) capitalize the first letter of every heading,
 *  3) normalize toponyms & brands (skips code/URLs).
 */
export function postProcessArticle(markdown: string, lang: "ru" | "en" = "ru"): string {
  if (!markdown) return markdown;
  let out = stripLongDashes(markdown);
  out = capitalizeHeadings(out);
  out = normalizeToponymsAndBrands(out, lang);
  return out;
}

/**
 * Post-processor for standalone strings (titles, H1, meta_title). Applies
 * capitalization + toponym/brand normalization, no markdown parsing.
 */
export function postProcessInline(text: string, lang: "ru" | "en" = "ru"): string {
  if (!text) return text;
  let out = stripLongDashes(text);
  out = capFirst(out);
  if (lang === "ru") {
    out = replaceRuToponyms(out);
    out = replaceExactWords(out, RU_BRANDS);
  } else {
    out = replaceExactWords(out, EN_TOPONYMS);
    out = replaceExactWords(out, EN_BRANDS);
  }
  return out;
}