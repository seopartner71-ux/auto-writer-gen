// Post-generation quality guard for vc-writer.
// Runs DETERMINISTIC structural checks on the generated markdown BEFORE we
// persist it to vc_writer_history. Three classes of defects are caught:
//
//   1. broken_h3       — text from the previous card bleeds into an H3 line
//                        ("...предлагают ### 5. Название"). Auto-repairable
//                        by splitting at the heading marker.
//   2. duplicate_lead  — the conclusion paragraph is almost a copy of the
//                        lead (jaccard on word sets ≥ 0.55). Flagged only,
//                        no auto-rewrite.
//   3. template_bullets — across rating cards, the same opener phrase
//                        ("в среднем по рынку", "используют проверенные",
//                        "конкурентная цена", …) repeats in 3+ cards.
//                        Flagged only.
//
// The guard is intentionally conservative: false positives are cheap (we
// only attach a report), broken markup that ships is not.

export interface QualityIssue {
  kind: "broken_h3" | "duplicate_lead" | "template_bullets";
  severity: "critical" | "warning";
  detail: string;
}

export interface QualityReport {
  ok: boolean;
  repaired: boolean;
  issues: QualityIssue[];
}

export interface GuardResult {
  markdown: string;
  report: QualityReport;
}

// Regex: any non-space char followed by something, then "### " (or ## / #)
// with a digit on the SAME line. Real H3s always start at column 0.
const BROKEN_HEADING_RE = /([^\n])[ \t]+(#{2,3})[ \t]+(\d+\.?\s)/g;

function repairBrokenHeadings(md: string): { md: string; count: number } {
  let count = 0;
  const fixed = md.replace(BROKEN_HEADING_RE, (_m, tail, hashes, num) => {
    count++;
    return `${tail}\n\n${hashes} ${num}`;
  });
  return { md: fixed, count };
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Extract the lead (everything before the first H2) and the conclusion
 *  (last block under a heading containing "Заключение" / "Вывод" / "Итог"). */
function extractLeadAndConclusion(md: string): { lead: string; conclusion: string } {
  const lines = md.split("\n");
  const leadLines: string[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    leadLines.push(lines[i]);
  }
  const lead = leadLines.join("\n").replace(/^#\s+.*$/m, "").trim();

  let concIdx = -1;
  for (let j = lines.length - 1; j >= 0; j--) {
    if (/^##\s+.*(заключени|вывод|итог)/i.test(lines[j])) { concIdx = j; break; }
  }
  const conclusion = concIdx === -1 ? "" : lines.slice(concIdx + 1).join("\n").trim();
  return { lead, conclusion };
}

/** Detect cards whose bullets all start with the same opener phrase. */
function detectTemplateBullets(md: string): string[] {
  // Grab all bullet lines, group by their first 4 meaningful words.
  const bullets = md.split("\n").filter((l) => /^[\s>]*[-*]\s+\S/.test(l));
  if (bullets.length < 8) return [];
  const openers = new Map<string, number>();
  for (const b of bullets) {
    const text = b.replace(/^[\s>]*[-*]\s+/, "").toLowerCase();
    // Strip leading "поле:" / "поле -" labels so we compare actual content.
    const body = text.replace(/^[^:–-]{1,30}[:–-]\s*/, "");
    const head = body.split(/[\s,.]+/).slice(0, 4).join(" ").trim();
    if (head.length < 8) continue;
    openers.set(head, (openers.get(head) || 0) + 1);
  }
  const offenders: string[] = [];
  for (const [head, n] of openers) {
    if (n >= 3) offenders.push(`"${head}" повторяется ${n}x`);
  }
  return offenders;
}

export function validateVcArticle(markdown: string, format: string): GuardResult {
  const issues: QualityIssue[] = [];
  let md = markdown;
  let repaired = false;

  // 1. Broken H3 — repair deterministically.
  const heads = repairBrokenHeadings(md);
  if (heads.count > 0) {
    md = heads.md;
    repaired = true;
    issues.push({
      kind: "broken_h3",
      severity: "critical",
      detail: `Склеенных заголовков: ${heads.count}. Автопочинено.`,
    });
  }

  // 2. Duplicate lead vs conclusion.
  const { lead, conclusion } = extractLeadAndConclusion(md);
  if (lead.length > 200 && conclusion.length > 200) {
    const sim = jaccard(tokens(lead), tokens(conclusion));
    if (sim >= 0.55) {
      issues.push({
        kind: "duplicate_lead",
        severity: "warning",
        detail: `Заключение повторяет лид (jaccard=${sim.toFixed(2)}).`,
      });
    }
  }

  // 3. Template bullets — only meaningful for rating-style content.
  if (format === "rating" || format === "review") {
    const offenders = detectTemplateBullets(md);
    if (offenders.length) {
      issues.push({
        kind: "template_bullets",
        severity: "warning",
        detail: `Шаблонные буллеты: ${offenders.slice(0, 5).join("; ")}.`,
      });
    }
  }

  return {
    markdown: md,
    report: {
      ok: issues.filter((i) => i.severity === "critical").length === 0,
      repaired,
      issues,
    },
  };
}
