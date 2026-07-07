// Guarantees the article body is HTML. If the input already contains block-level
// HTML tags (h1-6, p, ul, ol, table, li) we return it unchanged. Otherwise, when
// Markdown markers are detected (# headings, - / * bullets, numbered lists,
// pipe-tables), we convert with a lightweight, tag-safe transformer. Used at the
// entry of humanize-article / improve-article / quality-check so the rest of the
// pipeline (metricsOf, htmlIntegrityOk, validators) never silently no-ops on
// pure-Markdown content.

const HAS_HTML_BLOCK = /<(?:h[1-6]|p|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|figure|img|div)[\s>]/i;
const HAS_MD_MARKERS = /(^|\n)\s{0,3}#{1,6}\s+\S|(^|\n)\s{0,3}[-*]\s+\S|(^|\n)\s{0,3}\d+\.\s+\S|\|.+\|/;

function inline(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

// Pragmatic Markdown → HTML converter tuned for the article shapes we generate
// (H1-H4, paragraphs, ul/ol lists, GFM pipe tables, blockquotes). Deliberately
// NOT a full CommonMark parser — it only needs to produce structure our
// validators (countTags, analyzeSentenceStructure, htmlIntegrityOk) can read.
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }

    // Pipe table
    if (t.startsWith("|") && t.endsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        const r = lines[i].trim();
        if (/^[\s|:\-]+$/.test(r)) { i++; continue; }
        rows.push(r.split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      if (rows.length) {
        let tbl = "<table><thead><tr>";
        rows[0].forEach((c) => { tbl += `<th>${inline(c)}</th>`; });
        tbl += "</tr></thead><tbody>";
        for (let r = 1; r < rows.length; r++) {
          tbl += "<tr>";
          rows[r].forEach((c) => { tbl += `<td>${inline(c)}</td>`; });
          tbl += "</tr>";
        }
        tbl += "</tbody></table>";
        out.push(tbl);
      }
      continue;
    }

    // Headings
    const h = t.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2].trim())}</h${lvl}>`);
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].trim().replace(/^[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].trim().replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Blockquote
    if (t.startsWith("> ")) {
      const qs: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        qs.push(lines[i].trim().slice(2));
        i++;
      }
      out.push(`<blockquote>${qs.map((q) => `<p>${inline(q)}</p>`).join("")}</blockquote>`);
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(t)) { out.push("<hr>"); i++; continue; }

    // Paragraph — collect until blank line
    const buf: string[] = [t];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s+|[-*]\s+|\d+\.\s+|>\s+|\|)/.test(lines[i].trim())) {
      buf.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

// Returns HTML representation of the input content. If it already looks like
// HTML, returns as-is. If it looks like Markdown, converts. Otherwise wraps in
// a single <p>. Never throws.
export function ensureHtml(content: string): { html: string; converted: boolean; reason: "already_html" | "markdown_converted" | "plain_wrapped" | "empty" } {
  const s = String(content || "");
  if (!s.trim()) return { html: s, converted: false, reason: "empty" };
  if (HAS_HTML_BLOCK.test(s)) return { html: s, converted: false, reason: "already_html" };
  if (HAS_MD_MARKERS.test(s)) {
    try {
      return { html: markdownToHtml(s), converted: true, reason: "markdown_converted" };
    } catch {
      return { html: `<p>${s}</p>`, converted: true, reason: "plain_wrapped" };
    }
  }
  // Plain text — wrap so validators have at least one paragraph.
  return { html: `<p>${s.replace(/\n{2,}/g, "</p><p>")}</p>`, converted: true, reason: "plain_wrapped" };
}

// Timing helper: was the article recently touched by the pipeline? Used by
// stale-status auto-reset. Returns true when updated_at is older than `minAgeMs`
// and no matching pipeline_events exist in that window.
export async function isStaleStatus(
  admin: any, articleId: string, minAgeMs = 10 * 60 * 1000,
): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - minAgeMs).toISOString();
    const { data: ev } = await admin
      .from("pipeline_events")
      .select("id")
      .eq("article_id", articleId)
      .gt("created_at", cutoff)
      .limit(1);
    if (Array.isArray(ev) && ev.length > 0) return false;
    return true;
  } catch { return false; }
}