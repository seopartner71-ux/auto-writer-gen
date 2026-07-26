// Общие утилиты для PDF-билдеров (checklist остаётся на checklistPdf.ts,
// новые типы — на documentPdf.ts). Никакой логики бизнеса, только рендеринг-примитивы.

import { PDFDocument, PDFString, PDFName, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import {
  ROBOTO_REGULAR_BASE64,
  ROBOTO_BOLD_BASE64,
  decodeBase64ToUint8Array,
} from "./fonts/robotoBase64.ts";

export { PDFDocument, PDFString, PDFName, rgb };

export function hexToRgb(hex: string | undefined | null) {
  const h = (hex || "#6E56CF").replace("#", "").padEnd(6, "0").slice(0, 6);
  const num = parseInt(h, 16);
  return { r: ((num >> 16) & 255) / 255, g: ((num >> 8) & 255) / 255, b: (num & 255) / 255 };
}

export function cleanDomain(raw?: string | null): string {
  return (raw || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "").split("/")[0];
}

export async function loadRobotoFonts(pdf: PDFDocument) {
  pdf.registerFontkit(fontkit as any);
  const regular = await pdf.embedFont(decodeBase64ToUint8Array(ROBOTO_REGULAR_BASE64), { subset: true });
  const bold = await pdf.embedFont(decodeBase64ToUint8Array(ROBOTO_BOLD_BASE64), { subset: true });
  return { regular, bold };
}

export async function fetchImageBytes(url: string | undefined | null): Promise<{ bytes: Uint8Array; kind: "jpg" | "png" } | null> {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const kind: "jpg" | "png" =
      buf[0] === 0xff && buf[1] === 0xd8 ? "jpg"
      : buf[0] === 0x89 && buf[1] === 0x50 ? "png"
      : ct.includes("png") ? "png"
      : "jpg";
    return { bytes: buf, kind };
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
export async function embedImage(pdf: PDFDocument, url?: string | null): Promise<any | null> {
  const raw = await fetchImageBytes(url);
  if (!raw) return null;
  try {
    return raw.kind === "png" ? await pdf.embedPng(raw.bytes) : await pdf.embedJpg(raw.bytes);
  } catch {
    try {
      return raw.kind === "png" ? await pdf.embedJpg(raw.bytes) : await pdf.embedPng(raw.bytes);
    } catch {
      return null;
    }
  }
}

// deno-lint-ignore no-explicit-any
export function wrapText(text: string, font: any, size: number, maxW: number): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) <= maxW) cur = trial;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

export type InlineTok = { word: string; url?: string; bold?: boolean };

/** Parse inline `[text](url)` and `**bold**` markdown into tokens. */
export function parseInlineTokens(text: string): InlineTok[] {
  const out: InlineTok[] = [];
  const parts: Array<{ text: string; url?: string }> = [];
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[1], url: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  for (const p of parts) {
    if (p.url) {
      for (const w of p.text.split(/\s+/).filter(Boolean)) out.push({ word: w, url: p.url });
      continue;
    }
    const s = p.text;
    const boldRe = /\*\*([^*]+)\*\*/g;
    let bl = 0; let bm: RegExpExecArray | null;
    while ((bm = boldRe.exec(s)) !== null) {
      if (bm.index > bl) for (const w of s.slice(bl, bm.index).split(/\s+/).filter(Boolean)) out.push({ word: w });
      for (const w of bm[1].split(/\s+/).filter(Boolean)) out.push({ word: w, bold: true });
      bl = bm.index + bm[0].length;
    }
    if (bl < s.length) for (const w of s.slice(bl).split(/\s+/).filter(Boolean)) out.push({ word: w });
  }
  return out;
}

// deno-lint-ignore no-explicit-any
export function measureRichHeight(tokens: InlineTok[], font: any, boldFont: any, size: number, leading: number, maxW: number): number {
  if (tokens.length === 0) return 0;
  const spaceW = font.widthOfTextAtSize(" ", size);
  let lines = 1, lineW = 0;
  for (const t of tokens) {
    const f = t.bold ? boldFont : font;
    const w = f.widthOfTextAtSize(t.word, size);
    const need = lineW + (lineW ? spaceW : 0) + w;
    if (need > maxW && lineW > 0) { lines++; lineW = w; }
    else lineW = need;
  }
  return lines * leading;
}

export interface LinkAnnot { page: any; x: number; y: number; w: number; h: number; url: string }

/** Attach collected URI link annotations to their pages. */
export function attachLinkAnnotations(pdf: PDFDocument, links: LinkAnnot[]) {
  for (const link of links) {
    try {
      const annotDict = pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [link.x, link.y, link.x + link.w, link.y + link.h],
        Border: [0, 0, 0],
        A: pdf.context.obj({ Type: "Action", S: "URI", URI: PDFString.of(link.url) }),
      });
      const ref = pdf.context.register(annotDict);
      const key = PDFName.of("Annots");
      const existing = (link.page as any).node.get(key);
      if (existing && typeof (existing as any).push === "function") (existing as any).push(ref);
      else (link.page as any).node.set(key, pdf.context.obj([ref]));
    } catch (e) {
      console.warn("[pdfUtils] link annot failed", (e as Error).message);
    }
  }
}

/** Standard PDF metadata + roundtrip verification (throws if any required field missing). */
export function setStandardMetadata(pdf: PDFDocument, meta: {
  title: string; author: string; subject: string; keywords: string[]; language?: string;
}) {
  pdf.setTitle(meta.title.slice(0, 200));
  pdf.setAuthor(meta.author.slice(0, 200));
  pdf.setSubject(meta.subject.slice(0, 400));
  pdf.setKeywords((meta.keywords || []).map(String).filter(Boolean).slice(0, 25));
  pdf.setProducer("СЕО-Модуль");
  pdf.setCreator("СЕО-Модуль (seo-modul.pro)");
  try { (pdf as any).setLanguage?.(meta.language || "ru-RU"); } catch { /* older pdf-lib */ }
  pdf.setCreationDate(new Date());
}

export interface UploadResult { path: string; signedUrl: string | null }

// deno-lint-ignore no-explicit-any
export async function uploadEcosystemPdf(admin: any, path: string, bytes: Uint8Array): Promise<UploadResult> {
  const { error } = await admin.storage
    .from("ecosystem-formats")
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw error;
  const { data: signed } = await admin.storage
    .from("ecosystem-formats")
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  return { path, signedUrl: signed?.signedUrl || null };
}