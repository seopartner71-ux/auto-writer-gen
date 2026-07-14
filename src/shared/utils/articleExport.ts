/**
 * Article export helpers used on the QuickStart "aha" screen.
 *
 * We intentionally keep this dependency-free:
 * - plain / markdown / html conversions run in the browser
 * - `.doc` is a Word-compatible HTML wrapper (opens cleanly in Word and Google Docs
 *   via File -> Open). This avoids pulling in a full DOCX generator on the
 *   critical onboarding path.
 */

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&mdash;/gi, "-")
    .replace(/&ndash;/gi, "-");
}

export function htmlToPlain(html: string): string {
  if (!html) return "";
  const withBreaks = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|h[1-6]|li|tr|div|blockquote|section|article|header|footer)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");
  return decodeEntities(stripped)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, i) => `\n\n# ${strip(i)}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, i) => `\n\n## ${strip(i)}\n\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, i) => `\n\n### ${strip(i)}\n\n`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, i) => `\n\n#### ${strip(i)}\n\n`)
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
    .replace(/<i>([\s\S]*?)<\/i>/gi, "*$1*")
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, i) => `- ${strip(i)}\n`)
    .replace(/<\/?ul[^>]*>/gi, "\n")
    .replace(/<\/?ol[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "  \n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "");
  s = decodeEntities(s.replace(/<[^>]+>/g, ""));
  return s.replace(/\n{3,}/g, "\n\n").trim();

  function strip(x: string): string {
    return decodeEntities(x.replace(/<[^>]+>/g, "")).trim();
  }
}

/** Word-compatible HTML wrapper. Extension `.doc`; opens in Word and Google Docs. */
export function buildDocHtml(title: string, bodyHtml: string): string {
  const safeTitle = (title || "Article").replace(/[<>&]/g, "");
  return [
    "<html xmlns:o='urn:schemas-microsoft-com:office:office' ",
    "xmlns:w='urn:schemas-microsoft-com:office:word' ",
    "xmlns='http://www.w3.org/TR/REC-html40'>",
    `<head><meta charset="utf-8"><title>${safeTitle}</title>`,
    "<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5;}",
    "h1{font-size:22pt;}h2{font-size:16pt;}h3{font-size:13pt;}",
    "table{border-collapse:collapse;}td,th{border:1px solid #999;padding:6px;}</style>",
    "</head><body>",
    bodyHtml,
    "</body></html>",
  ].join("");
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

export function slugify(s: string): string {
  return (s || "article")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "article";
}

export async function copyToClipboard(text: string, html?: string): Promise<void> {
  if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      /* fall through to plain */
    }
  }
  await navigator.clipboard.writeText(text);
}