// ============================================================================
// SEMANTIC NORMALIZATION
//
// Free-form input ("Завод занимается производством РВД 20 лет, лучшая цена")
// must never reach titles, schema.org "name"/"about" fields or generated
// questions. This module derives a single MARKET_CATEGORY noun phrase and
// strips first-person pronouns from the assembled text files.
//
// Deterministic and identity-blind: no model call, same input -> same output.
// ============================================================================

/** Words that only carry marketing or corporate framing, never ontology. */
const NOISE = new Set(
  [
    "лучший", "лучшая", "лучшие", "лучшее", "лучших", "недорого", "дешево", "дешевые", "дешёвые",
    "качественные", "качественный", "надежные", "надёжные", "надежный", "выгодно", "выгодные",
    "профессиональный", "профессиональные", "ведущий", "ведущая", "крупнейший", "официальный",
    "официальные", "быстро", "срочно", "оптом", "розница", "акция", "скидки", "гарантия",
    "производим", "производство", "производством", "продаем", "продаём", "продажа", "продажи",
    "изготовление", "изготавливаем", "поставляем", "поставка", "поставки", "предлагаем",
    "занимается", "занимаемся", "работаем", "работает", "компания", "фирма", "завод", "магазин",
    "купить", "заказать", "цена", "цены", "лет", "года", "год", "опыта", "опыт", "рынке", "рынка",
    "экосистема", "решения", "услуги", "сервис", "клиентов", "клиентам", "наши", "наша", "наше",
    "наш", "мы", "нас", "нам", "нами", "я", "меня", "мне", "это", "для", "все", "уже", "более",
  ].map((w) => w.toLowerCase()),
);

/** Units that keep a preceding number meaningful ("24 л.с.", "12 мм"). */
const UNIT = /^(л\.?с\.?|мм|см|м|кв|квт|кВт|вт|т|кг|бар|атм|дюйм[а-я]*|гц)$/i;

function isMeaningful(token: string, prevKept: string | undefined): boolean {
  const t = token.toLowerCase();
  if (!t) return false;
  if (NOISE.has(t)) return false;
  if (/^\d+([.,]\d+)?$/.test(t)) return true; // decided by the next token
  if (t.length < 2 && !/^[а-яёa-z]$/i.test(t)) return false;
  void prevKept;
  return true;
}

/**
 * Derives the base product ontology: 2-5 nouns, no marketing, no verbs.
 * "Продаем лучшие минитракторы 24 л.с. недорого" -> "Минитракторы 24 л.с."
 */
export function extractMarketCategory(topics: string[], fallback: string): string {
  const source = topics.map((t) => String(t ?? "").trim()).filter(Boolean).join(", ");
  const firstClause = source.split(/[.!?|;]/)[0] || "";
  const rawTokens = firstClause
    .replace(/[«»"']/g, "")
    .split(/[\s,]+/)
    .map((t) => t.replace(/^[-–—]+|[-–—]+$/g, "").trim())
    .filter(Boolean);

  const kept: string[] = [];
  rawTokens.forEach((token, i) => {
    const next = rawTokens[i + 1] ?? "";
    if (/^\d+([.,]\d+)?$/.test(token)) {
      // A bare number survives only next to a unit: "24 л.с." stays, "20 лет" goes.
      if (UNIT.test(next.replace(/[.,]$/, ""))) kept.push(token);
      return;
    }
    if (UNIT.test(token.replace(/[.,]$/, "")) && kept.length && /^\d/.test(kept[kept.length - 1])) {
      kept.push(token);
      return;
    }
    if (isMeaningful(token, kept[kept.length - 1])) kept.push(token);
  });

  const phrase = kept.slice(0, 5).join(" ").replace(/\s+/g, " ").trim();
  const result = phrase || String(topics[0] ?? "").trim() || fallback;
  return result.charAt(0).toUpperCase() + result.slice(1);
}

const FIRST_PERSON =
  /(?<![\p{L}\p{N}_])(мы|нас|нам|нами|наш|наша|наше|наши|нашего|нашей|нашему|нашим|наших|нашими|нашу|нашем|нашём|я|меня|мне|мной|мною|мой|моя|моё|мое|мои|моего|моей|моему|моим|моих|моими|мою|моем|моём)(?![\p{L}\p{N}_])/giu;

/** A token that must never be rewritten: URL, path, e-mail, code id. */
function isProtected(token: string): boolean {
  return /https?:|www\.|[@/\\]|\.(?:ru|com|org|net|pro|io|dev|json|csv|md|py|txt|html)\b/i.test(token);
}

/**
 * Third-party tone guard: removes first-person pronouns from generated prose.
 * URLs, file names and code identifiers are left untouched.
 */
export function stripFirstPerson(text: string): string {
  if (!text) return text;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s{4,}\S/.test(line) || line.trim().startsWith("```")) return line;
      const cleaned = line
        .split(/(\s+)/)
        .map((token) => (/\s/.test(token) || isProtected(token) ? token : token.replace(FIRST_PERSON, "")))
        .join("");
      return cleaned
        .replace(/[ \t]{2,}/g, " ")
        .replace(/ +([,.;:!?])/g, "$1")
        .replace(/\(\s+/g, "(")
        .replace(/\s+\)/g, ")")
        .replace(/[ \t]+$/g, "");
    })
    .join("\n");
}
