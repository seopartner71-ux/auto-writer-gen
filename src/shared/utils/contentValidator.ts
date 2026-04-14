/**
 * Post-generation content validator.
 * Detects fake expert names, pseudo-statistics, and auto-fixes them.
 */

export interface ValidationIssue {
  type: "fake_expert" | "pseudo_stat" | "fake_company";
  original: string;
  replacement: string;
  line: number;
}

export interface ValidationResult {
  status: "clean" | "warning" | "fixed";
  issues: ValidationIssue[];
  fixedContent: string;
}

// ─── Detection Patterns ────────────────────────────────────────────

// Russian full names (Имя Фамилия / Имя Отчество Фамилия)
const RU_EXPERT_NAME = /(?:по (?:словам|мнению|данным|оценкам|наблюдениям)|как (?:отмечает|считает|утверждает|говорит|заявляет|подчеркивает|поясняет)|(?:эксперт|специалист|профессор|доктор|к\.м\.н\.|к\.т\.н\.|д\.м\.н\.|академик|руководитель|директор|глава|основатель|CEO|CTO)\s+)?([А-ЯЁ][а-яё]+\s+(?:[А-ЯЁ][а-яё]+\s+)?[А-ЯЁ][а-яё]+)(?:\s*,\s*(?:эксперт|специалист|руководитель|директор|основатель|профессор|доктор|к\.м\.н\.|к\.т\.н\.|д\.м\.н\.|глава|CEO|CTO|ведущий|старший|главный)[^.;"\n]*)?/g;

// English full names with titles
const EN_EXPERT_NAME = /(?:according to|says|notes|explains|states|argues|believes|(?:Dr\.|Prof\.|Professor|Mr\.|Mrs\.|Ms\.)\s+)?([A-Z][a-z]{2,}\s+(?:[A-Z]\.?\s+)?[A-Z][a-z]{2,})(?:\s*,\s*(?:expert|specialist|professor|doctor|CEO|CTO|founder|director|head|chief|senior|lead|managing)[^.;"\n]*)?/g;

// Pseudo-statistics without source
const PSEUDO_STAT_PATTERNS = [
  // "XX% случаев/пользователей/людей" without source reference
  /(\d{2,3}(?:[.,]\d{1,2})?%)\s+(?:случаев|пользователей|людей|компаний|респондентов|клиентов|покупателей|экспертов|опрошенных|владельцев|потребителей|заказчиков)/gi,
  // "исследование показало" / "по данным исследования" without specific source
  /(?:исследовани[еяю]\s+(?:показал[оиа]|выявил[оиа]|подтвердил[оиа]|установил[оиа]))/gi,
  // "по данным компании X" with fake company
  /по данным (?:компании|агентства|организации|центра|института)\s+(?:«[^»]+»|"[^"]+"|[А-ЯA-Z][а-яa-z]+(?:\s+[А-ЯA-Z][а-яa-z]+)*)/gi,
  // English pseudo-stats
  /(\d{2,3}(?:\.\d{1,2})?%)\s+of\s+(?:users|people|companies|respondents|customers|consumers|businesses)/gi,
  // "study/research shows/found" without citation
  /(?:a\s+)?(?:recent\s+)?(?:study|research|survey|report)\s+(?:shows?|found|reveals?|suggests?|indicates?|confirms?)/gi,
];

// Fake company/org patterns
const FAKE_ORG_PATTERNS = [
  // «Компания» or "Company" in quote context
  /(?:компания|агентство|институт|центр|лаборатория|фонд|ассоциация|бюро)\s+(?:«[^»]+»|"[^"]+")/gi,
  /(?:согласно|по данным)\s+(?:[А-ЯA-Z][а-яa-z]+(?:\s+[А-ЯA-Z][а-яa-z]+){0,2}\s+(?:University|Institute|Lab|Center|Research|Foundation|Agency|Corporation|Inc\.|Ltd\.|GmbH|Corp\.))/gi,
];

// Known safe names (brands, tools etc that are fine to mention)
const SAFE_ENTITIES = new Set([
  "Google", "Yandex", "Яндекс", "Apple", "Microsoft", "Amazon", "Meta", "Facebook",
  "YouTube", "Wikipedia", "WordPress", "Ahrefs", "Semrush", "Moz", "Screaming Frog",
  "ChatGPT", "OpenAI", "Telegram", "WhatsApp", "Instagram", "Twitter",
]);

// ─── Safe Replacements ─────────────────────────────────────────────

const RU_EXPERT_REPLACEMENTS = [
  "по наблюдениям опытных специалистов",
  "практика показывает",
  "специалисты отрасли отмечают",
  "по данным отраслевых опросов",
  "как отмечают практикующие специалисты",
  "опытные мастера рекомендуют",
];

const EN_EXPERT_REPLACEMENTS = [
  "according to experienced practitioners",
  "practice shows",
  "industry specialists note",
  "based on industry surveys",
  "experienced professionals recommend",
];

const RU_STAT_REPLACEMENTS = [
  "большинство проблем возникает из-за",
  "в большинстве случаев",
  "как правило",
  "по наблюдениям специалистов",
  "обычно",
];

const EN_STAT_REPLACEMENTS = [
  "most problems arise from",
  "in most cases",
  "as a rule",
  "according to specialists' observations",
  "typically",
];

// ─── Validator ──────────────────────────────────────────────────────

function isSafeName(name: string): boolean {
  return SAFE_ENTITIES.has(name.trim()) || SAFE_ENTITIES.has(name.split(/\s+/)[0]);
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isInsideMarkdownLink(text: string, matchIndex: number): boolean {
  // Check if match is inside [text](url) or ![alt](url)
  const before = text.slice(Math.max(0, matchIndex - 200), matchIndex);
  const openBracket = before.lastIndexOf("[");
  const closeBracket = before.lastIndexOf("]");
  return openBracket > closeBracket; // inside [...]
}

function getLineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

export function validateContent(content: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  let fixedContent = content;
  const isRussian = /[а-яё]/i.test(content);

  // Safety: skip validation on very large content to prevent freezes
  if (content.length > 100_000) {
    return { status: "clean", issues: [], fixedContent: content };
  }

  // 1. Detect fake expert names (Russian)
  let match: RegExpExecArray | null;
  const ruNamePattern = new RegExp(RU_EXPERT_NAME.source, "g");
  while ((match = ruNamePattern.exec(content)) !== null) {
    const fullMatch = match[0];
    const name = match[1];
    if (!name || isSafeName(name)) continue;
    if (isInsideMarkdownLink(content, match.index)) continue;

    // Check if it looks like a real person name (2-3 capitalized words)
    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length < 2) continue;
    if (!nameParts.every(p => /^[А-ЯЁ]/.test(p))) continue;

    const replacement = pickRandom(RU_EXPERT_REPLACEMENTS);
    issues.push({
      type: "fake_expert",
      original: fullMatch,
      replacement,
      line: getLineNumber(content, match.index),
    });
  }

  // 2. Detect fake expert names (English)
  const enNamePattern = new RegExp(EN_EXPERT_NAME.source, "g");
  while ((match = enNamePattern.exec(content)) !== null) {
    const fullMatch = match[0];
    const name = match[1];
    if (!name || isSafeName(name)) continue;
    if (isInsideMarkdownLink(content, match.index)) continue;

    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length < 2) continue;
    if (!nameParts.every(p => /^[A-Z]/.test(p))) continue;

    // Skip if it's a heading (starts with #)
    const lineStart = content.lastIndexOf("\n", match.index) + 1;
    if (content[lineStart] === "#") continue;

    const replacement = pickRandom(EN_EXPERT_REPLACEMENTS);
    issues.push({
      type: "fake_expert",
      original: fullMatch,
      replacement,
      line: getLineNumber(content, match.index),
    });
  }

  // 3. Detect pseudo-statistics
  for (const pattern of PSEUDO_STAT_PATTERNS) {
    const statPattern = new RegExp(pattern.source, "gi");
    while ((match = statPattern.exec(content)) !== null) {
      const fullMatch = match[0];
      const replacements = isRussian ? RU_STAT_REPLACEMENTS : EN_STAT_REPLACEMENTS;
      issues.push({
        type: "pseudo_stat",
        original: fullMatch,
        replacement: pickRandom(replacements),
        line: getLineNumber(content, match.index),
      });
    }
  }

  // 4. Detect fake organizations
  for (const pattern of FAKE_ORG_PATTERNS) {
    const orgPattern = new RegExp(pattern.source, "gi");
    while ((match = orgPattern.exec(content)) !== null) {
      const fullMatch = match[0];
      // Skip known safe entities
      if (SAFE_ENTITIES.has(fullMatch.split(/\s+/).pop() || "")) continue;

      const replacement = isRussian
        ? pickRandom(["по отраслевым данным", "по наблюдениям специалистов", "практика показывает"])
        : pickRandom(["according to industry data", "based on professional observations", "practice shows"]);
      issues.push({
        type: "fake_company",
        original: fullMatch,
        replacement,
        line: getLineNumber(content, match.index),
      });
    }
  }

  // Apply fixes
  if (issues.length > 0) {
    // Sort by position descending to replace from end to start (preserves indices)
    const sortedIssues = [...issues].sort((a, b) => {
      const idxA = content.indexOf(a.original);
      const idxB = content.indexOf(b.original);
      return idxB - idxA;
    });

    for (const issue of sortedIssues) {
      fixedContent = fixedContent.replace(issue.original, issue.replacement);
    }
  }

  return {
    status: issues.length === 0 ? "clean" : "fixed",
    issues,
    fixedContent,
  };
}

// ─── EN Stealth Post-Processor ─────────────────────────────────────

const EN_BANNED_PHRASES: [RegExp, string][] = [
  [/\bIt is worth noting that\b/gi, "Here's the thing —"],
  [/\bIn conclusion\b/gi, "Bottom line"],
  [/\bFurthermore\b/gi, "And"],
  [/\bIt is important to\b/gi, "You'll want to"],
  [/\bThis is because\b/gi, "That's because"],
  [/\bIn summary\b/gi, "So"],
  [/\bIt should be noted\b/gi, "Worth knowing —"],
  [/\bOne of the key\b/gi, "A big"],
  [/\bIn order to\b/gi, "To"],
  [/\bIt goes without saying\b/gi, "Obviously"],
  [/\bPlays a crucial role\b/gi, "matters a lot"],
  [/\bPlays an important role\b/gi, "really matters"],
  [/\bA wide range of\b/gi, "plenty of"],
  [/\bIt is essential\b/gi, "You need to"],
  [/\bMoreover\b/gi, "Plus"],
  [/\bAdditionally\b/gi, "Also"],
  [/\bUtilize\b/gi, "Use"],
  [/\bLeverage\b/gi, "Use"],
  [/\bStreamline\b/gi, "Simplify"],
  [/\bComprehensive\b/gi, "thorough"],
  [/\bMeticulously\b/gi, "carefully"],
];

const EN_CONTRACTION_FIXES: [RegExp, string][] = [
  [/\bIt is\b/g, "It's"],
  [/\bit is\b/g, "it's"],
  [/\bDo not\b/g, "Don't"],
  [/\bdo not\b/g, "don't"],
  [/\bWill not\b/g, "Won't"],
  [/\bwill not\b/g, "won't"],
  [/\bCan not\b/g, "Can't"],
  [/\bcan not\b/g, "can't"],
  [/\bcannot\b/g, "can't"],
  [/\bCannot\b/g, "Can't"],
  [/\bShould not\b/g, "Shouldn't"],
  [/\bshould not\b/g, "shouldn't"],
  [/\bWould not\b/g, "Wouldn't"],
  [/\bwould not\b/g, "wouldn't"],
  [/\bCould not\b/g, "Couldn't"],
  [/\bcould not\b/g, "couldn't"],
  [/\bDoes not\b/g, "Doesn't"],
  [/\bdoes not\b/g, "doesn't"],
  [/\bDid not\b/g, "Didn't"],
  [/\bdid not\b/g, "didn't"],
  [/\bHave not\b/g, "Haven't"],
  [/\bhave not\b/g, "haven't"],
  [/\bHas not\b/g, "Hasn't"],
  [/\bhas not\b/g, "hasn't"],
  [/\bIs not\b/g, "Isn't"],
  [/\bis not\b/g, "isn't"],
  [/\bAre not\b/g, "Aren't"],
  [/\bare not\b/g, "aren't"],
  [/\bWas not\b/g, "Wasn't"],
  [/\bwas not\b/g, "wasn't"],
  [/\bWere not\b/g, "Weren't"],
  [/\bwere not\b/g, "weren't"],
  [/\bI am\b/g, "I'm"],
  [/\bYou are\b/g, "You're"],
  [/\byou are\b/g, "you're"],
  [/\bThey are\b/g, "They're"],
  [/\bthey are\b/g, "they're"],
  [/\bWe are\b/g, "We're"],
  [/\bwe are\b/g, "we're"],
  [/\bI have\b/g, "I've"],
  [/\bYou will\b/g, "You'll"],
  [/\byou will\b/g, "you'll"],
  [/\bI will\b/g, "I'll"],
  [/\bWe will\b/g, "We'll"],
  [/\bwe will\b/g, "we'll"],
  [/\bThere is\b/g, "There's"],
  [/\bthere is\b/g, "there's"],
];

const EN_INFORMAL_INJECTIONS = [
  "Honestly, ", "Look, ", "Real talk — ", "Here's the deal: ",
  "Spoiler alert — ", "Plot twist: ", "No surprise here — ",
  "I mean, ", "To be fair, ", "Heads up — ",
];

/**
 * EN Stealth Post-Processor: applies contraction fixes, bans AI phrases,
 * shortens every 5th sentence, and injects informal openers.
 */
export function applyEnStealthPostProcessing(content: string): string {
  if (content.length > 100_000) return content;
  const isEnglish = /^[a-zA-Z\s.,!?;:\-'"()\[\]{}0-9#*/]/.test(content.trim().slice(0, 200));
  if (!isEnglish) return content;

  let result = content;

  // 1. Replace banned AI phrases
  for (const [pattern, replacement] of EN_BANNED_PHRASES) {
    result = result.replace(pattern, replacement);
  }

  // 2. Force contractions
  for (const [pattern, replacement] of EN_CONTRACTION_FIXES) {
    result = result.replace(pattern, replacement);
  }

  // 3. Shorten every 5th sentence in body paragraphs
  const lines = result.split("\n");
  let sentenceCounter = 0;
  const processedLines = lines.map(line => {
    if (/^#{1,6}\s|^[-*]\s|^\d+\.\s|^>|^```|^!\[|^\|/.test(line.trim())) return line;
    if (line.trim().length < 20) return line;

    const sentences = line.match(/[^.!?]+[.!?]+/g);
    if (!sentences || sentences.length < 2) {
      sentenceCounter++;
      return line;
    }

    return sentences.map(s => {
      sentenceCounter++;
      if (sentenceCounter % 5 === 0) {
        const words = s.trim().split(/\s+/);
        if (words.length > 10) {
          return words.slice(0, 6).join(" ").replace(/[,;:\-]$/, "") + ".";
        }
      }
      return s;
    }).join(" ");
  });
  result = processedLines.join("\n");

  // 4. Inject 2-3 informal openers per ~1000 words
  const wordCount = result.split(/\s+/).length;
  const injectCount = Math.min(3, Math.max(2, Math.floor(wordCount / 1000) * 2));
  const paragraphs = result.split("\n\n");
  
  if (paragraphs.length > 4 && injectCount > 0) {
    const step = Math.max(2, Math.floor(paragraphs.length / (injectCount + 1)));
    let injected = 0;
    for (let i = step; i < paragraphs.length - 1 && injected < injectCount; i += step) {
      const p = paragraphs[i];
      if (p && !p.startsWith("#") && !p.startsWith("-") && !p.startsWith(">") && !p.startsWith("|") && !p.startsWith("!") && p.length > 30) {
        const phrase = EN_INFORMAL_INJECTIONS[injected % EN_INFORMAL_INJECTIONS.length];
        const firstChar = p.charAt(0);
        if (/[A-Z]/.test(firstChar)) {
          paragraphs[i] = phrase + firstChar.toLowerCase() + p.slice(1);
        } else {
          paragraphs[i] = phrase + p;
        }
        injected++;
      }
    }
    result = paragraphs.join("\n\n");
  }

  return result;
}

/** Quick check without fixes - returns just the status */
export function quickFactCheck(content: string): "verified" | "warning" {
  const result = validateContent(content);
  return result.issues.length === 0 ? "verified" : "warning";
}
