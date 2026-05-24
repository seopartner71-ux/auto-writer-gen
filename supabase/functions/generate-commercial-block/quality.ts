// Pure helpers extracted from index.ts for unit-testability.
// No Deno-specific or network imports — safe to import from tests.

export interface BriefLike {
  [k: string]: unknown;
}

export function countWords(text: string): number {
  return text.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

export function keywordDensity(html: string, keyword: string): { count: number; density: number; total: number } {
  const plain = html.replace(/<[^>]+>/g, " ").toLowerCase();
  const total = plain.trim().split(/\s+/).filter(Boolean).length || 1;
  const kw = (keyword || "").trim().toLowerCase();
  if (!kw) return { count: 0, density: 0, total };
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "gi");
  const count = (plain.match(re) || []).length;
  return { count, density: count / total, total };
}

export function stripFences(s: string): string {
  return s.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

export function applyAntiFakeGuard(html: string, brief: BriefLike): { content: string; flagged: string[] } {
  const flagged: string[] = [];
  let out = html;
  const briefBlob = JSON.stringify(brief).toLowerCase();

  out = out.replace(/(\+?7|8)[\s\-(]*\d{3}[\s\-)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/g, (m) => {
    if (briefBlob.includes(m.replace(/\D/g, "").slice(-10))) return m;
    flagged.push(`phone:${m}`);
    return "по телефону на сайте";
  });

  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => {
    if (briefBlob.includes(m.toLowerCase())) return m;
    flagged.push(`email:${m}`);
    return "по e-mail на сайте";
  });

  out = out.replace(/(по данным|согласно (?:исследованию|опросу|статистике)[^.]{0,40})\s*[^.<]{0,80}?\d{1,3}\s?%/gi, (m) => {
    flagged.push(`fake_stat:${m.slice(0, 60)}`);
    return "практика показывает";
  });

  out = out.replace(/[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+,\s*(эксперт|директор|руководитель|основатель|CEO|CTO|маркетолог|консультант)[^.<]{0,80}/g, (m) => {
    flagged.push(`fake_expert:${m.slice(0, 60)}`);
    return "эксперты отрасли отмечают";
  });

  out = out.replace(/(исследование|опрос|отчет|рейтинг)\s+(?:от\s+)?\d{4}\s*(?:года|г\.)/gi, (m) => {
    flagged.push(`fake_year:${m}`);
    return "по наблюдениям из практики";
  });

  return { content: out, flagged };
}