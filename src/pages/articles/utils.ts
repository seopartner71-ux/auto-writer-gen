// Pure helpers extracted from ArticlesPage.tsx.
// No React, no Supabase — safe to import anywhere.

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function countSentences(text: string): number {
  return (text.match(/[.!?]+/g) || []).length || 1;
}

export function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-zа-яё]/g, "");
  if (word.length <= 3) return 1;
  const matches = word.match(/[aeiouyаеёиоуыэюя]+/gi);
  return matches ? matches.length : 1;
}

export function fleschScore(text: string): number {
  const words = countWords(text);
  if (words < 10) return 0;
  const sentences = countSentences(text);
  const syllables = text.split(/\s+/).reduce((sum, w) => sum + countSyllables(w), 0);
  const asl = words / sentences;
  const asw = syllables / words;
  const isCyrillic = /[а-яА-Я]/.test(text);
  const score = isCyrillic
    ? 206.835 - 1.3 * asl - 60.1 * asw
    : 206.835 - 1.015 * asl - 84.6 * asw;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function readabilityLabel(
  score: number,
  t: (k: string) => string,
): { label: string; color: string } {
  if (score >= 70) return { label: t("articles.readEasy"), color: "text-success" };
  if (score >= 50) return { label: t("articles.readMedium"), color: "text-warning" };
  return { label: t("articles.readHard"), color: "text-destructive" };
}

export function markdownToPreviewHtml(md: string): string {
  let html = md.replace(
    /(?:^|\n)((?:\|.+\|\s*\n)+)/g,
    (_, tableBlock: string) => {
      const rows = tableBlock.trim().split("\n").filter(Boolean);
      if (rows.length < 2) return tableBlock;
      const headerCells = rows[0].split("|").filter(c => c.trim());
      const isSep = /^[\s|:-]+$/.test(rows[1]);
      const dataRows = isSep ? rows.slice(2) : rows.slice(1);
      let table = '<table class="md-table"><thead><tr>';
      headerCells.forEach(c => { table += `<th>${c.trim()}</th>`; });
      table += "</tr></thead><tbody>";
      dataRows.forEach(row => {
        const cells = row.split("|").filter(c => c.trim());
        table += "<tr>";
        cells.forEach(c => { table += `<td>${c.trim()}</td>`; });
        table += "</tr>";
      });
      table += "</tbody></table>";
      return "\n" + table + "\n";
    },
  );

  html = html
    .replace(/^######\s+(.+)$/gm, '<h6 class="md-h6">$1</h6>')
    .replace(/^#####\s+(.+)$/gm, '<h5 class="md-h5">$1</h5>')
    .replace(/^####\s+(.+)$/gm, '<h4 class="md-h4">$1</h4>')
    .replace(/^###\s+(.+)$/gm, '<h3 class="md-h3">$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2 class="md-h2">$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1 class="md-h1">$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="md-img" style="max-width:100%;height:auto;border-radius:8px;margin:1rem 0" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link">$1</a>')
    .replace(/^[-*]\s+(.+)$/gm, '<li class="md-ul-li">$1</li>')
    .replace(/^\d+\.\s+(.+)$/gm, '<li class="md-ol-li">$1</li>');

  html = html.replace(/((?:<li class="md-ul-li">.*?<\/li>\s*)+)/g, '<ul class="md-ul">$1</ul>');
  html = html.replace(/((?:<li class="md-ol-li">.*?<\/li>\s*)+)/g, '<ol class="md-ol">$1</ol>');

  html = html.replace(/\n{2,}/g, '</p><p class="md-p">');
  html = `<p class="md-p">${html}</p>`;
  html = html.replace(/<p class="md-p">\s*<\/p>/g, "");
  html = html.replace(/<p class="md-p">\s*(<h[1-6]|<ul|<ol|<table)/g, "$1");
  html = html.replace(/(<\/h[1-6]>|<\/ul>|<\/ol>|<\/table>)\s*<\/p>/g, "$1");

  return html;
}

export function highlightHtml(code: string): string {
  const esc = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return esc
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="html-comment">$1</span>')
    .replace(/(&lt;\/?)([\w-]+)/g, '<span class="html-tag">$1$2</span>')
    .replace(/\s([\w-]+)(=)/g, ' <span class="html-attr">$1</span>$2')
    .replace(/(&quot;)(.*?)(&quot;)/g, '<span class="html-val">$1$2$3</span>')
    .replace(/(&gt;)/g, '<span class="html-tag">$1</span>');
}

export function highlightDeviationsInHtml(
  html: string,
  deviations: Array<{ severity: "high" | "medium" | "low"; category: string; rule: string; quote: string }>,
): string {
  if (!deviations || deviations.length === 0) return html;
  let out = html;
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const escRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const indexed = deviations.map((d, i) => ({ d, i }));
  const sorted = [...indexed]
    .filter(({ d }) => d.quote && d.quote.trim().length >= 4)
    .sort((a, b) => b.d.quote.length - a.d.quote.length);

  for (const { d, i } of sorted) {
    let q = d.quote.trim().replace(/^[«"'„]+|[»"'"]+$/g, "").trim();
    if (!q) continue;
    const candidates = [q, q.slice(0, 80)].filter((v, i, arr) => arr.indexOf(v) === i && v.length >= 4);
    let replaced = false;
    for (const cand of candidates) {
      const escCand = escapeHtml(cand);
      const re = new RegExp(escRegex(escCand), "i");
      if (re.test(out)) {
        const sevClass =
          d.severity === "high" ? "dev-high" :
          d.severity === "medium" ? "dev-medium" : "dev-low";
        const titleAttr = escapeHtml(`${d.category}: ${d.rule}`);
        out = out.replace(re, `<mark class="dev-mark ${sevClass}" title="${titleAttr}" data-cat="${escapeHtml(d.category)}" data-dev-idx="${i}">$&</mark>`);
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      const soft = escapeHtml(q).replace(/\s+/g, "\\s+");
      try {
        const re2 = new RegExp(soft, "i");
        if (re2.test(out)) {
          const sevClass =
            d.severity === "high" ? "dev-high" :
            d.severity === "medium" ? "dev-medium" : "dev-low";
          const titleAttr = escapeHtml(`${d.category}: ${d.rule}`);
          out = out.replace(re2, `<mark class="dev-mark ${sevClass}" title="${titleAttr}" data-cat="${escapeHtml(d.category)}" data-dev-idx="${i}">$&</mark>`);
        }
      } catch {}
    }
  }
  return out;
}

export function inlineMd(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;height:auto;" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function markdownToCleanHtml(md: string): string {
  const lines = md.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableRows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        const row = lines[i].trim();
        if (/^[\s|:-]+$/.test(row)) { i++; continue; }
        const cells = row.split("|").slice(1, -1).map(c => c.trim());
        tableRows.push(cells);
        i++;
      }
      if (tableRows.length > 0) {
        let table = '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%"><thead><tr>';
        tableRows[0].forEach(c => { table += `<th style="border:1px solid #ccc;padding:8px;background:#f5f5f5;text-align:left">${inlineMd(c)}</th>`; });
        table += "</tr></thead><tbody>";
        for (let r = 1; r < tableRows.length; r++) {
          table += "<tr>";
          tableRows[r].forEach(c => { table += `<td style="border:1px solid #ccc;padding:8px">${inlineMd(c)}</td>`; });
          table += "</tr>";
        }
        table += "</tbody></table>";
        result.push(table);
      }
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      result.push(`<h${level}>${inlineMd(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inlineMd(lines[i].trim().replace(/^[-*]\s+/, ""))}</li>`);
        i++;
      }
      result.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inlineMd(lines[i].trim().replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      result.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      result.push(`<blockquote style="border-left:3px solid #ccc;padding-left:12px;margin:12px 0;color:#555">${quoteLines.map(l => `<p>${inlineMd(l)}</p>`).join("")}</blockquote>`);
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      result.push("<hr>");
      i++;
      continue;
    }

    result.push(`<p>${inlineMd(trimmed)}</p>`);
    i++;
  }

  return result.join("\n");
}

export function markdownToFullHtml(md: string, title?: string, metaDesc?: string): string {
  const body = markdownToCleanHtml(md);
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || "Article"}</title>
  ${metaDesc ? `<meta name="description" content="${metaDesc.replace(/"/g, "&quot;")}">` : ""}
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.7; color: #1a1a1a; }
    h1 { font-size: 2rem; margin-top: 2rem; }
    h2 { font-size: 1.5rem; margin-top: 1.5rem; border-bottom: 1px solid #e5e5e5; padding-bottom: .3rem; }
    h3 { font-size: 1.25rem; margin-top: 1.2rem; }
    ul { padding-left: 1.5rem; }
    a { color: #2563eb; }
    strong { font-weight: 600; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #e5e5e5; padding: .5rem .75rem; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}