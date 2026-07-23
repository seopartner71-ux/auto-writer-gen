// Shared PDF builder for checklist format.
// Used by generate-checklist and retry-checklist-pdf so a re-render does not
// require calling the LLM again.

import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import {
  ROBOTO_REGULAR_BASE64,
  ROBOTO_BOLD_BASE64,
  decodeBase64ToUint8Array,
} from "./fonts/robotoBase64.ts";

// Fonts are inlined as base64 in robotoBase64.ts because Supabase edge runtime
// bundles only .ts/.js from _shared/ — binary .ttf files never reach runtime.

export interface ChecklistClient {
  name?: string;
  brand_color?: string;
  expert_name?: string;
  domain?: string;
}

function hexToRgb(hex: string | undefined | null): { r: number; g: number; b: number } {
  const h = (hex || "#6E56CF").replace("#", "").padEnd(6, "0").slice(0, 6);
  const num = parseInt(h, 16);
  return { r: ((num >> 16) & 255) / 255, g: ((num >> 8) & 255) / 255, b: (num & 255) / 255 };
}

export async function buildChecklistPdf(input: {
  title: string;
  markdown: string;
  client: ChecklistClient | null;
}): Promise<Uint8Array> {
  console.log("[CHECKLIST-PDF] step:fonts:load");
  const regularBytes = decodeBase64ToUint8Array(ROBOTO_REGULAR_BASE64);
  const boldBytes = decodeBase64ToUint8Array(ROBOTO_BOLD_BASE64);
  console.log(
    `[CHECKLIST-PDF] fonts:decoded regular=${regularBytes.byteLength} bold=${boldBytes.byteLength}`,
  );

  console.log("[CHECKLIST-PDF] step:pdf:create");
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit as any);
  console.log("[CHECKLIST-PDF] step:pdf:embedFonts");
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  console.log("[CHECKLIST-PDF] step:pdf:draw");

  const brand = hexToRgb(input.client?.brand_color);
  const brandColor = rgb(brand.r, brand.g, brand.b);
  const inkColor = rgb(0.09, 0.09, 0.12);
  const mutedColor = rgb(0.42, 0.42, 0.48);

  const pageW = 595.28;
  const pageH = 841.89;
  const marginX = 56;
  const marginTop = 64;
  const marginBottom = 56;
  const contentW = pageW - marginX * 2;

  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - marginTop;

  const drawHeader = () => {
    page.drawRectangle({ x: 0, y: pageH - 8, width: pageW, height: 8, color: brandColor });
    if (input.client?.name) {
      page.drawText(input.client.name, { x: marginX, y: pageH - 32, size: 10, font: bold, color: mutedColor });
    }
  };
  const drawFooter = () => {
    const label = input.client?.domain
      ? `${input.client.name || ""} · ${input.client.domain}`.trim()
      : (input.client?.name || "СЕО-Модуль");
    page.drawText(label, { x: marginX, y: 28, size: 9, font: regular, color: mutedColor });
  };
  const newPage = () => {
    drawFooter();
    page = pdf.addPage([pageW, pageH]);
    y = pageH - marginTop;
    drawHeader();
  };
  drawHeader();

  const wrap = (text: string, font: any, size: number, maxW: number): string[] => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) <= maxW) cur = trial;
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const drawLines = (
    text: string,
    opts: { font: any; size: number; color?: any; leading?: number; indent?: number },
  ) => {
    const leading = opts.leading ?? opts.size * 1.35;
    const indent = opts.indent ?? 0;
    const maxW = contentW - indent;
    const lines = wrap(text, opts.font, opts.size, maxW);
    for (const line of lines) {
      if (y - leading < marginBottom) newPage();
      page.drawText(line, {
        x: marginX + indent,
        y: y - opts.size,
        size: opts.size,
        font: opts.font,
        color: opts.color ?? inkColor,
      });
      y -= leading;
    }
  };

  const md = input.markdown.replace(/\r\n/g, "\n").split("\n");
  let titleLine = input.title;
  const startIdx = md.findIndex((l) => l.trim().startsWith("# "));
  if (startIdx >= 0) {
    titleLine = md[startIdx].replace(/^#\s+/, "").trim();
    md.splice(startIdx, 1);
  }
  drawLines(titleLine, { font: bold, size: 22, leading: 28 });
  y -= 6;
  drawLines("Практический чек-лист", { font: regular, size: 11, color: mutedColor, leading: 16 });
  y -= 14;

  for (const raw of md) {
    const line = raw.replace(/\r/g, "");
    if (!line.trim()) { y -= 8; continue; }
    if (line.startsWith("## ")) {
      y -= 6;
      drawLines(line.replace(/^##\s+/, ""), { font: bold, size: 14, leading: 20 });
      y -= 4;
      continue;
    }
    const check = line.match(/^-\s*\[\s?\]\s*(.+)$/);
    if (check) {
      if (y - 18 < marginBottom) newPage();
      const boxY = y - 14;
      page.drawRectangle({ x: marginX, y: boxY, width: 11, height: 11, borderColor: brandColor, borderWidth: 1.2 });
      drawLines(check[1], { font: regular, size: 11, leading: 16, indent: 20 });
      y -= 4;
      continue;
    }
    if (line.startsWith("- ")) {
      drawLines("• " + line.slice(2), { font: regular, size: 11, leading: 16, indent: 12 });
      continue;
    }
    drawLines(line, { font: regular, size: 11, leading: 16 });
  }

  drawFooter();
  return await pdf.save();
}

export interface UploadResult {
  path: string;
  signedUrl: string | null;
}

export async function uploadChecklistPdf(
  // deno-lint-ignore no-explicit-any
  admin: any,
  path: string,
  bytes: Uint8Array,
): Promise<UploadResult> {
  const { error: upErr } = await admin.storage
    .from("ecosystem-formats")
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (upErr) throw upErr;
  const { data: signed } = await admin.storage
    .from("ecosystem-formats")
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  return { path, signedUrl: signed?.signedUrl || null };
}