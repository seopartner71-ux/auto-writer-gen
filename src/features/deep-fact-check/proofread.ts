// Proofread mode helpers. Pure display layer — never mutate stored article text.

import { type FactFinding } from "./utils";

export type HlKind = "green" | "red" | "yellow";

export interface IndexedFinding {
  finding: FactFinding;
  idx: number;
  kind: HlKind | null;
  needle: string; // string to highlight in the current article content
}

/**
 * Classify a finding for proofread highlighting.
 *  - green : applied fix — highlight the NEW fragment currently in the text
 *  - red   : outdated / invented, no applied fix — highlight the quote
 *  - yellow: unverifiable / needs manual review — highlight the quote
 *  - null  : nothing to show in the proofread layer
 */
export function classify(
  f: FactFinding,
  applied: boolean,
  appliedNewFragment: string | null,
): { kind: HlKind | null; needle: string } {
  if (applied && appliedNewFragment) {
    return { kind: "green", needle: appliedNewFragment };
  }
  const v = f.verification;
  const isRed = v === "OUTDATED" || f.type === "invented_fact";
  if (isRed) return { kind: "red", needle: f.quote };
  const isYellow = v === "UNVERIFIABLE" || !!f.needs_manual_review;
  if (isYellow) return { kind: "yellow", needle: f.quote };
  return { kind: null, needle: f.quote };
}

interface Range {
  start: number;
  end: number;
  idx: number;
  kind: HlKind;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function overlaps(a: Range, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function placeRanges(content: string, items: IndexedFinding[]): Range[] {
  const used: Range[] = [];
  const sorted = items.slice().sort((a, b) => b.needle.length - a.needle.length);
  for (const it of sorted) {
    if (!it.kind || !it.needle || it.needle.length < 3) continue;
    let from = 0;
    while (from <= content.length) {
      const p = content.indexOf(it.needle, from);
      if (p === -1) break;
      const cand = { start: p, end: p + it.needle.length };
      if (used.some((r) => overlaps(r, cand))) {
        from = cand.end;
        continue;
      }
      used.push({ ...cand, idx: it.idx, kind: it.kind });
      break;
    }
  }
  return used.sort((a, b) => a.start - b.start);
}

/**
 * Build an HTML string with span-wrapped highlights around the raw article
 * content (which may already be HTML). The original substrings are preserved
 * verbatim — we only inject wrapper tags around them.
 */
export function buildHighlightedHtml(
  content: string,
  items: IndexedFinding[],
): string {
  const ranges = placeRanges(content, items);
  if (ranges.length === 0) return content;
  let out = "";
  let pos = 0;
  for (const r of ranges) {
    out += content.slice(pos, r.start);
    const inner = content.slice(r.start, r.end);
    out += `<span data-fc-idx="${r.idx}" id="fc-hl-${r.idx}" class="fc-hl fc-hl-${r.kind}">${inner}</span>`;
    pos = r.end;
  }
  out += content.slice(pos);
  return out;
}

/** How many quotes were actually placed as spans (for counters). */
export function countPlaced(content: string, items: IndexedFinding[]): Record<HlKind, number> {
  const ranges = placeRanges(content, items);
  const counts: Record<HlKind, number> = { green: 0, red: 0, yellow: 0 };
  for (const r of ranges) counts[r.kind]++;
  return counts;
}

function recommendationOf(f: FactFinding): string {
  const parts: string[] = [];
  if (f.verdict) parts.push(f.verdict);
  if (f.verification_summary) parts.push(f.verification_summary);
  if (f.suggested_fix) parts.push(`Предлагаемая замена: «${f.suggested_fix}»`);
  if (parts.length === 0) parts.push("Проверьте вручную.");
  return parts.join(" — ");
}

/** Standalone printable HTML draft with highlights, footnotes and watermark. */
export function buildExportHtml(
  articleTitle: string,
  content: string,
  items: IndexedFinding[],
): string {
  const ranges = placeRanges(content, items);
  const refNumber = new Map<number, number>();
  ranges.forEach((r, i) => refNumber.set(r.idx, i + 1));

  let body = "";
  let pos = 0;
  for (const r of ranges) {
    body += content.slice(pos, r.start);
    const inner = content.slice(r.start, r.end);
    const n = refNumber.get(r.idx);
    body += `<span class="fc-hl fc-hl-${r.kind}">${inner}<sup class="fc-ref">[${n}]</sup></span>`;
    pos = r.end;
  }
  body += content.slice(pos);

  const notes = ranges
    .map((r, i) => {
      const item = items.find((x) => x.idx === r.idx);
      const rec = item ? recommendationOf(item.finding) : "";
      return `<li id="fn-${i + 1}"><b>[${i + 1}]</b> ${escapeHtml(rec)}</li>`;
    })
    .join("");

  const safeTitle = escapeHtml(articleTitle || "Черновик для вычитки");

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>${safeTitle} — черновик для вычитки</title>
<style>
  html,body{margin:0;padding:0;background:#fff;color:#111;}
  body{font-family: Georgia, "Times New Roman", serif; line-height:1.65; font-size:16px;}
  .page{max-width:820px; margin:40px auto; padding:0 24px; position:relative; z-index:1;}
  .head{border-bottom:2px solid #ddd; padding-bottom:12px; margin-bottom:24px;}
  .head h1{font-size:22px; margin:0 0 6px;}
  .head p{margin:0; color:#666; font-size:13px;}
  .fc-hl{border-radius:3px; padding:0 2px;}
  .fc-hl-yellow{background:#fef3c7;}
  .fc-hl-red{background:#fecaca;}
  .fc-hl-green{background:#d1fae5;}
  sup.fc-ref{color:#dc2626; font-weight:700; margin-left:2px; font-size:11px;}
  .footnotes{margin-top:60px; padding-top:16px; border-top:2px solid #ddd; font-size:14px; color:#333;}
  .footnotes h2{font-size:16px; margin:0 0 10px;}
  .footnotes ol{padding-left:24px;}
  .footnotes li{margin-bottom:8px;}
  .wm{position:fixed; inset:0; pointer-events:none; z-index:0;
    background-image: repeating-linear-gradient(-30deg, transparent 0 220px, rgba(220,38,38,0.05) 220px 260px);}
  .wm-text{position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg);
    font-family: Arial, sans-serif; font-weight:800; font-size:58px; letter-spacing:2px;
    color:rgba(220,38,38,0.14); pointer-events:none; z-index:0; white-space:nowrap;}
  @media print { .wm-text{position:fixed;} }
  img{max-width:100%; height:auto;}
  table{border-collapse:collapse; width:100%;}
  table th, table td{border:1px solid #ddd; padding:6px 8px;}
</style></head>
<body>
<div class="wm"></div>
<div class="wm-text">ЧЕРНОВИК ДЛЯ ВЫЧИТКИ — НЕ ПУБЛИКОВАТЬ</div>
<div class="page">
  <div class="head">
    <h1>${safeTitle}</h1>
    <p>Черновик для вычитки. Не публиковать. Жёлтая заливка - проверьте вручную, красная - опровергнутый или выдуманный факт, зелёная - применённое исправление.</p>
  </div>
  <div class="article">${body}</div>
  ${notes ? `<div class="footnotes"><h2>Сноски и рекомендации</h2><ol>${notes}</ol></div>` : ""}
</div>
</body></html>`;
}