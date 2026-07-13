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