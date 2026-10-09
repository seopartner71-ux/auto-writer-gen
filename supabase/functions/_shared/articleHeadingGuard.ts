// Repair paragraph-sized H1s without discarding their content. Shared by the
// writer and polish pass; valid headings are left untouched.
export function repairArticleH1(content: string, expectedH1?: string | null): string {
  const repair = (text: string): { title: string; intro: string } | null => {
    const plain = text.replace(/<[^>]+>/g, "").trim();
    if (plain.length <= 180 && plain.split(/\s+/).length <= 25) return null;
    const expected = String(expectedH1 || "").replace(/^#\s+/, "").trim();
    if (expected) return { title: expected, intro: text.trim() };
    const boundary = /[.!?]\s+(?=[А-ЯA-Z])/u.exec(plain);
    if (!boundary) return null;
    return { title: plain.slice(0, boundary.index).trim(), intro: plain.slice(boundary.index + 1).trim() };
  };
  if (/<h1\b/i.test(content)) {
    return content.replace(/(<h1\b[^>]*>)([\s\S]*?)<\/h1>/i, (all, open, text) => {
      const fixed = repair(text);
      return fixed ? `${open}${fixed.title}</h1>\n<p>${fixed.intro}</p>` : all;
    });
  }
  return content.replace(/^(#\s+)([^\n]+)$/m, (all, prefix, text) => {
    const fixed = repair(text);
    return fixed ? `${prefix}${fixed.title}\n\n${fixed.intro}` : all;
  });
}