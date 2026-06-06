// Гард частотности значимых слов.
// Цель: ловить переспам, который добавляет баллы Баден-Бадену даже когда
// канцеляризмов нет. Считает:
//   - частотность каждого значимого слова на 1000 знаков (норма ≤ 2),
//   - повторяемость seed-ключа внутри H2-блока (норма ≤ 1).
//
// Контракт совпадает с другими валидаторами _shared/validators/.

const RU_STOPWORDS = new Set([
  "и","в","во","не","на","что","с","со","по","а","но","как","к","из","за","для","от","до","или","о","об","у",
  "это","эта","этот","эти","же","ли","бы","то","так","там","тут","вот","еще","уже","при","без","под","над",
  "мы","вы","он","она","они","оно","я","меня","нас","вам","нам","им","ее","его","их","себя","свой",
  "был","была","были","быть","есть","будет","будут","будь","нет","да",
  "если","когда","потому","чтобы","также","ведь","даже","лишь","только","еще","всегда","никогда","всем","все",
  "очень","можно","нужно","надо","может","могут","который","которая","которые","которое",
  "the","a","an","of","in","on","for","to","is","are","was","were","be","by","with","and","or","but","as","at",
]);

const PUNCT_RE = /[^\p{L}\p{N}\-']+/gu;

function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е");
}

function tokenize(text: string): string[] {
  return normalize(text).split(PUNCT_RE).filter(Boolean);
}

function isSignificant(token: string): boolean {
  if (token.length < 5) return false;
  if (RU_STOPWORDS.has(token)) return false;
  if (/^\d+$/.test(token)) return false;
  return true;
}

export interface FrequencyHit {
  word: string;
  count: number;
  per1k: number; // на 1000 знаков
}

export interface KeywordSectionHit {
  heading: string;
  count: number;
}

export interface KeywordFrequencyMetrics {
  charCount: number;
  topOverused: FrequencyHit[];
  seedKeyword: string | null;
  seedTotal: number;
  seedOveruseSections: KeywordSectionHit[];
  verdict: "pass" | "warning" | "fail";
  issues: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Разбивает HTML по H2 на блоки { heading, body }. Для plain-текста — один блок.
function splitByH2(html: string): Array<{ heading: string; body: string }> {
  if (!/<h2[\s>]/i.test(html)) return [{ heading: "", body: html }];
  const parts: Array<{ heading: string; body: string }> = [];
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2[\s>]|$)/gi;
  let m: RegExpExecArray | null;
  let firstIdx: number | null = null;
  while ((m = re.exec(html)) !== null) {
    if (firstIdx === null) firstIdx = m.index;
    parts.push({
      heading: m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 100),
      body: m[2],
    });
  }
  // intro перед первым H2
  if (firstIdx !== null && firstIdx > 0) {
    parts.unshift({ heading: "(intro)", body: html.slice(0, firstIdx) });
  }
  if (!parts.length) parts.push({ heading: "", body: html });
  return parts;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function analyzeKeywordFrequency(
  contentHtmlOrText: string,
  seedKeyword: string | null,
): KeywordFrequencyMetrics {
  const plain = stripTags(contentHtmlOrText);
  const charCount = plain.length;

  // 1. Topword overuse: считаем значимые слова в plain-тексте.
  const tokens = tokenize(plain).filter(isSignificant);
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);

  const per1kThreshold = 2;
  const topOverused: FrequencyHit[] = [];
  for (const [word, count] of freq.entries()) {
    const per1k = charCount ? +((count * 1000) / charCount).toFixed(2) : 0;
    if (per1k > per1kThreshold) {
      topOverused.push({ word, count, per1k });
    }
  }
  topOverused.sort((a, b) => b.per1k - a.per1k);

  // 2. Seed-keyword density per H2-section.
  const seed = (seedKeyword || "").trim();
  let seedTotal = 0;
  const seedOveruseSections: KeywordSectionHit[] = [];
  if (seed) {
    const sections = splitByH2(contentHtmlOrText);
    const re = new RegExp(`\\b${escapeRegExp(normalize(seed))}\\b`, "g");
    for (const sec of sections) {
      const bodyText = normalize(stripTags(sec.body));
      const matches = bodyText.match(re) || [];
      seedTotal += matches.length;
      if (matches.length > 1) {
        seedOveruseSections.push({ heading: sec.heading, count: matches.length });
      }
    }
  }

  const issues: string[] = [];
  if (topOverused.length) {
    const top3 = topOverused.slice(0, 3).map((h) => `${h.word} (${h.per1k}/1k)`).join(", ");
    issues.push(`Сверхчастые слова: ${top3}. Норма ≤ ${per1kThreshold} вхождений на 1000 знаков.`);
  }
  if (seedOveruseSections.length) {
    issues.push(`Seed-ключ "${seed}" повторяется в одном H2-блоке: ${seedOveruseSections.map((s) => `«${s.heading}» x${s.count}`).slice(0, 3).join(", ")}.`);
  }

  const fail = topOverused.length >= 2 || seedOveruseSections.some((s) => s.count >= 3) || topOverused.some((h) => h.per1k >= 3.5);
  const warning = topOverused.length > 0 || seedOveruseSections.length > 0;
  const verdict: "pass" | "warning" | "fail" = fail ? "fail" : warning ? "warning" : "pass";

  return {
    charCount,
    topOverused: topOverused.slice(0, 10),
    seedKeyword: seed || null,
    seedTotal,
    seedOveruseSections,
    verdict,
    issues,
  };
}

export function buildKeywordFrequencyFixHint(m: KeywordFrequencyMetrics): string | null {
  if (m.verdict === "pass") return null;
  const lines: string[] = ["Снизь частотность слов через синонимы, местоимения или перестройку фразы."];
  if (m.topOverused.length) {
    lines.push("Сверхчастые слова (норма ≤ 2 на 1000 знаков):");
    for (const h of m.topOverused.slice(0, 8)) {
      lines.push(`  • ${h.word} — ${h.count} раз (${h.per1k}/1k)`);
    }
  }
  if (m.seedOveruseSections.length && m.seedKeyword) {
    lines.push(`Seed-ключ "${m.seedKeyword}" — максимум 1 раз в каждом H2-блоке:`);
    for (const s of m.seedOveruseSections.slice(0, 6)) {
      lines.push(`  • «${s.heading}» — ${s.count} вхождений`);
    }
  }
  lines.push("Не выкидывай слова механически — переписывай фразы. Сохрани смысл, цифры, факты.");
  return lines.join("\n");
}