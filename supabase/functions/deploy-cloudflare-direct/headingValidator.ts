// Heading hygiene validator for site-factory templates.
//
// Goal: detect SEO-damaging structural mistakes BEFORE we deploy a generated
// site to Cloudflare Pages. We check every .html file in the deploy bundle
// against three rules:
//
//   1. exactly one <h1> per page (0 or 2+ is bad);
//   2. heading hierarchy never jumps by more than +1 level (h1 -> h3 is bad,
//      but h2 -> h2 -> h3 -> h2 is fine);
//   3. no exact-duplicate heading text within the SAME page (case- and
//      whitespace-normalized). Cross-section duplicates dilute relevance and
//      look like template glitches.
//
// Output is a structured report; the caller decides whether to log,
// surface as a warning, or attempt auto-repair. We do NOT mutate HTML here —
// false positives are cheap, broken markup from regex surgery is not.

export interface HeadingIssue {
  file: string;
  // "no-h1" | "multiple-h1" | "level-jump" | "duplicate-text"
  kind: string;
  detail: string;
}

export interface HeadingReport {
  filesChecked: number;
  issues: HeadingIssue[];
  // Per-file heading skeleton, useful for debugging in cost_log metadata.
  outline: Record<string, { level: number; text: string }[]>;
}

const HEADING_RE = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

function normalizeText(s: string): string {
  return stripTags(s)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractHeadings(html: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADING_RE.exec(html)) !== null) {
    const level = parseInt(m[1], 10);
    const text = normalizeText(m[2]);
    if (text.length > 0) out.push({ level, text });
  }
  return out;
}

export function validateHeadings(files: Record<string, string>): HeadingReport {
  const report: HeadingReport = { filesChecked: 0, issues: [], outline: {} };

  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith(".html")) continue;
    // Skip technical / non-indexable pages — wrong h1 count there doesn't hurt
    // SEO and would just spam the report.
    if (path.endsWith("404.html") || path.endsWith("wp-login.html")) continue;

    report.filesChecked += 1;
    const headings = extractHeadings(content);
    report.outline[path] = headings;

    // Rule 1: exactly one <h1>
    const h1Count = headings.filter((h) => h.level === 1).length;
    if (h1Count === 0) {
      report.issues.push({ file: path, kind: "no-h1", detail: "no <h1> on page" });
    } else if (h1Count > 1) {
      report.issues.push({
        file: path,
        kind: "multiple-h1",
        detail: `found ${h1Count} <h1> tags`,
      });
    }

    // Rule 2: hierarchy — never jump down by more than +1 level
    let prev = 0;
    for (const h of headings) {
      if (prev > 0 && h.level > prev + 1) {
        report.issues.push({
          file: path,
          kind: "level-jump",
          detail: `h${prev} -> h${h.level} ("${h.text.slice(0, 60)}")`,
        });
      }
      prev = h.level;
    }

    // Rule 3: no exact-duplicate heading text on the same page
    const seen = new Map<string, number>();
    for (const h of headings) {
      // Single short generic words (numbers, "1", "2") are not real duplicates
      // — paginated card grids legitimately repeat them.
      if (h.text.length < 4) continue;
      seen.set(h.text, (seen.get(h.text) || 0) + 1);
    }
    for (const [text, count] of seen.entries()) {
      if (count > 1) {
        report.issues.push({
          file: path,
          kind: "duplicate-text",
          detail: `"${text.slice(0, 60)}" repeats ${count}x`,
        });
      }
    }
  }

  return report;
}

// Compact summary suitable for cost_log metadata / console output.
export function summarizeReport(r: HeadingReport): {
  ok: boolean;
  filesChecked: number;
  totalIssues: number;
  byKind: Record<string, number>;
  sample: HeadingIssue[];
} {
  const byKind: Record<string, number> = {};
  for (const i of r.issues) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
  return {
    ok: r.issues.length === 0,
    filesChecked: r.filesChecked,
    totalIssues: r.issues.length,
    byKind,
    sample: r.issues.slice(0, 10),
  };
}
