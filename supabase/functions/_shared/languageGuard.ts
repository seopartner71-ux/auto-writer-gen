// Language contamination guard for writer/humanize outputs.
//
// Motivation: Gemini Flash (and any generic LLM) starts code-switching on
// long EN generations (>5k tokens). The model may return whole English body
// with occasional Russian phrases baked into paragraphs and headings.
// Symmetrically, RU articles may drift with English mid-sentence tokens.
//
// This module is intentionally cheap: pure counting, no network. It is
// consumed by generate-article, bulk-generate and the humanize/improve
// orchestrator to decide when a single silent retry is worth spending.

export type ArticleLang = "ru" | "en";

function stripHtmlMd(s: string): string {
  return String(s || "")
    // strip HTML tags
    .replace(/<[^>]+>/g, " ")
    // strip fenced code blocks
    .replace(/```[\s\S]*?```/g, " ")
    // strip inline code
    .replace(/`[^`]+`/g, " ")
    // strip URLs (letters inside URLs are legit)
    .replace(/https?:\/\/\S+/gi, " ")
    // strip markdown links [text](url) — keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function countCyrillic(text: string): number {
  const m = String(text || "").match(/[А-Яа-яЁё]/g);
  return m ? m.length : 0;
}

export function countLatin(text: string): number {
  const m = String(text || "").match(/[A-Za-z]/g);
  return m ? m.length : 0;
}

export interface ContaminationReport {
  contaminated: boolean;
  ratio: number;        // foreign letters / total letters
  foreignChars: number; // raw count of contaminating letters
  totalLetters: number;
  sample: string;       // up to 240 chars around the first hit (for logs)
}

/**
 * Detect language contamination.
 * - For EN articles: ANY cyrillic letter counts as contamination.
 * - For RU articles: latin letters are common (brand/tech terms), so we
 *   flag only if the latin-letter ratio exceeds `ruLatinRatioThreshold`
 *   (default 8%) — well above the typical 1-3% background noise.
 */
export function detectContamination(
  content: string,
  lang: ArticleLang,
  opts: { ruLatinRatioThreshold?: number } = {},
): ContaminationReport {
  const clean = stripHtmlMd(content);
  if (!clean) {
    return { contaminated: false, ratio: 0, foreignChars: 0, totalLetters: 0, sample: "" };
  }
  if (lang === "en") {
    const foreign = countCyrillic(clean);
    const latin = countLatin(clean);
    const total = foreign + latin;
    const ratio = total ? foreign / total : 0;
    const idx = clean.search(/[А-Яа-яЁё]/);
    const sample = idx >= 0 ? clean.slice(Math.max(0, idx - 100), idx + 140) : "";
    return { contaminated: foreign > 0, ratio, foreignChars: foreign, totalLetters: total, sample };
  }
  // RU direction
  const foreign = countLatin(clean);
  const cyr = countCyrillic(clean);
  const total = foreign + cyr;
  const ratio = total ? foreign / total : 0;
  const threshold = opts.ruLatinRatioThreshold ?? 0.08;
  const contaminated = ratio >= threshold && foreign >= 40;
  const idx = clean.search(/[A-Za-z]{6,}/);
  const sample = idx >= 0 ? clean.slice(Math.max(0, idx - 100), idx + 140) : "";
  return { contaminated, ratio, foreignChars: foreign, totalLetters: total, sample };
}

/**
 * Strong language-lock directive appended to the SYSTEM prompt on retry.
 * Deliberately verbose and repetitive — Gemini needs the reinforcement to
 * suppress code-switching on long generations.
 */
export function buildLanguageEnforcementDirective(lang: ArticleLang): string {
  if (lang === "en") {
    return [
      "",
      "════════════════════════════════════════════════════════════",
      "LANGUAGE LOCK — ABSOLUTE, NON-NEGOTIABLE",
      "════════════════════════════════════════════════════════════",
      "OUTPUT MUST BE 100% ENGLISH. NO CYRILLIC CHARACTERS ANYWHERE.",
      "Every word, every heading, every table cell, every list item,",
      "every FAQ question and answer, every image caption — English only.",
      "Do NOT include a single Russian letter (а, б, в, г, д, е, ё, ж…).",
      "If a Russian brand or place name comes up, use the ROMAN spelling",
      "(e.g. \"Yandex\", not \"Яндекс\"; \"Moscow\", not \"Москва\").",
      "Before you emit each paragraph, scan it: if you see a Cyrillic",
      "letter, rewrite that paragraph in English before continuing.",
      "════════════════════════════════════════════════════════════",
    ].join("\n");
  }
  return [
    "",
    "════════════════════════════════════════════════════════════",
    "ЯЗЫКОВОЙ ЗАМОК — АБСОЛЮТНЫЙ, НЕ ОБСУЖДАЕТСЯ",
    "════════════════════════════════════════════════════════════",
    "Пиши на РУССКОМ. Латиница допустима ТОЛЬКО для имён брендов,",
    "моделей, доменов и стандартных технических терминов (CRM, SEO,",
    "GPT, HTTPS). Все обычные слова, заголовки, ячейки таблиц, вопросы",
    "FAQ — только кириллицей. Если поймал себя на английской фразе,",
    "перепиши абзац по-русски.",
    "════════════════════════════════════════════════════════════",
  ].join("\n");
}
