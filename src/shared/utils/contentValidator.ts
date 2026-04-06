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

/** Quick check without fixes - returns just the status */
export function quickFactCheck(content: string): "verified" | "warning" {
  const result = validateContent(content);
  return result.issues.length === 0 ? "verified" : "warning";
}
