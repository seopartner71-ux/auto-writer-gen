// Shared PDF builder for the checklist format — premium multi-page layout with
// cover banner, brand-colored items, final reminders block, author card and CTA.
// Used by generate-checklist and retry-checklist-pdf so PDF re-render does not
// require another LLM call.

import { PDFDocument, PDFString, PDFName, rgb } from "npm:pdf-lib@1.17.1";
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
  expert_bio?: string;
  expert_photo_url?: string;
  contact_email?: string;
  contact_phone?: string;
  domain?: string;
  logo_url?: string;
}

export interface BuildChecklistInput {
  title: string;
  markdown: string;
  ecosystemId: string;
  client: ChecklistClient | null;
  imageUrls?: string[] | null;
}

function hexToRgb(hex: string | undefined | null): { r: number; g: number; b: number } {
  const h = (hex || "#6E56CF").replace("#", "").padEnd(6, "0").slice(0, 6);
  const num = parseInt(h, 16);
  return { r: ((num >> 16) & 255) / 255, g: ((num >> 8) & 255) / 255, b: (num & 255) / 255 };
}

function cleanDomain(raw?: string | null): string {
  return (raw || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "").split("/")[0];
}

async function fetchImageBytes(url: string | undefined | null): Promise<{ bytes: Uint8Array; kind: "jpg" | "png" } | null> {
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
  } catch (e) {
    console.warn("[CHECKLIST-PDF] image fetch failed", (e as Error).message);
    return null;
  }
}

// deno-lint-ignore no-explicit-any
async function embedImage(pdf: PDFDocument, url?: string | null): Promise<any | null> {
  const raw = await fetchImageBytes(url);
  if (!raw) return null;
  try {
    return raw.kind === "png" ? await pdf.embedPng(raw.bytes) : await pdf.embedJpg(raw.bytes);
  } catch {
    try {
      return raw.kind === "png" ? await pdf.embedJpg(raw.bytes) : await pdf.embedPng(raw.bytes);
    } catch (e) {
      console.warn("[CHECKLIST-PDF] embed image failed", (e as Error).message);
      return null;
    }
  }
}

export async function buildChecklistPdf(input: BuildChecklistInput): Promise<Uint8Array> {
  console.log("[CHECKLIST-PDF] step:fonts:load");
  const regularBytes = decodeBase64ToUint8Array(ROBOTO_REGULAR_BASE64);
  const boldBytes = decodeBase64ToUint8Array(ROBOTO_BOLD_BASE64);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit as any);
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });

  const client = input.client || {};
  const brand = hexToRgb(client.brand_color);
  const brandColor = rgb(brand.r, brand.g, brand.b);
  const inkColor = rgb(0.09, 0.09, 0.12);
  const mutedColor = rgb(0.42, 0.42, 0.48);
  const lightBg = rgb(0.96, 0.96, 0.98);
  const white = rgb(1, 1, 1);

  const images = (input.imageUrls || []).filter(Boolean);
  const bannerImg = images[0] ? await embedImage(pdf, images[0]) : null;
  const finalImg = images[1] ? await embedImage(pdf, images[1]) : null;
  const logoImg = client.logo_url ? await embedImage(pdf, client.logo_url) : null;
  const expertImg = client.expert_photo_url ? await embedImage(pdf, client.expert_photo_url) : null;
  console.log("[CHECKLIST-PDF] images", {
    banner: !!bannerImg, final: !!finalImg, logo: !!logoImg, expert: !!expertImg,
  });

  const pageW = 595.28;
  const pageH = 841.89;
  const marginX = 56;
  const marginTop = 78;
  const marginBottom = 64;
  const contentW = pageW - marginX * 2;

  const domain = cleanDomain(client.domain);
  const utm = (content: string): string | null =>
    domain
      ? `https://${domain}/?utm_source=checklist&utm_medium=ecosystem&utm_campaign=ecosystem_${input.ecosystemId}&utm_content=${content}`
      : null;

  // deno-lint-ignore no-explicit-any
  const pages: any[] = [];
  const annotLinks: Array<{ page: any; x: number; y: number; w: number; h: number; url: string }> = [];

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

  const drawHeader = (p: any) => {
    p.drawRectangle({ x: 0, y: pageH - 6, width: pageW, height: 6, color: brandColor });
    const headerY = pageH - 44;
    let leftX = marginX;
    let leftW = 0;
    if (logoImg) {
      const targetH = 22;
      const scale = targetH / logoImg.height;
      const w = Math.min(70, logoImg.width * scale);
      const h = logoImg.height * (w / logoImg.width);
      p.drawImage(logoImg, { x: leftX, y: headerY - 4, width: w, height: h });
      leftX += w + 10;
      leftW += w + 10;
    }
    if (client.name) {
      const label = client.name.slice(0, 50);
      p.drawText(label, { x: leftX, y: headerY, size: 10, font: bold, color: inkColor });
      leftW += bold.widthOfTextAtSize(label, 10);
    }
    const linkUrl = utm("header_logo");
    if (linkUrl && leftW > 0) {
      annotLinks.push({ page: p, x: marginX - 2, y: headerY - 10, w: leftW + 4, h: 30, url: linkUrl });
    }
  };

  const drawFooter = (p: any, pageNo: number, totalPages: number) => {
    const yF = 30;
    const leftLabel = [client.expert_name, client.name].filter(Boolean).join(", ").slice(0, 70);
    if (leftLabel) {
      p.drawText(leftLabel, { x: marginX, y: yF, size: 8, font: regular, color: mutedColor });
    }
    const pageLabel = `${pageNo} / ${totalPages}`;
    const plW = regular.widthOfTextAtSize(pageLabel, 8);
    p.drawText(pageLabel, { x: (pageW - plW) / 2, y: yF, size: 8, font: regular, color: mutedColor });
    if (domain) {
      const dW = regular.widthOfTextAtSize(domain, 8);
      const dX = pageW - marginX - dW;
      p.drawText(domain, { x: dX, y: yF, size: 8, font: regular, color: brandColor });
      const linkUrl = utm("footer");
      if (linkUrl) annotLinks.push({ page: p, x: dX - 2, y: yF - 3, w: dW + 4, h: 12, url: linkUrl });
    }
  };

  let page = pdf.addPage([pageW, pageH]);
  pages.push(page);
  let y = pageH - marginTop;
  drawHeader(page);

  const newPage = () => {
    page = pdf.addPage([pageW, pageH]);
    pages.push(page);
    y = pageH - marginTop;
    drawHeader(page);
  };

  const drawLines = (
    text: string,
    opts: { font: any; size: number; color?: any; leading?: number; indent?: number },
  ) => {
    const leading = opts.leading ?? opts.size * 1.4;
    const indent = opts.indent ?? 0;
    const maxW = contentW - indent;
    const lines = wrap(text, opts.font, opts.size, maxW);
    for (const line of lines) {
      if (y - leading < marginBottom + 20) newPage();
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

  // ============ COVER ============
  const mdSource = input.markdown.replace(/\r\n/g, "\n").split("\n");
  let titleLine = input.title;
  const startIdx = mdSource.findIndex((l) => l.trim().startsWith("# "));
  if (startIdx >= 0) {
    titleLine = mdSource[startIdx].replace(/^#\s+/, "").trim();
    mdSource.splice(startIdx, 1);
  }
  y = pageH - 110;
  drawLines(titleLine, { font: bold, size: 26, leading: 32 });
  y -= 8;
  drawLines("Практический чек-лист", { font: regular, size: 12, color: mutedColor, leading: 18 });
  y -= 18;

  if (bannerImg) {
    const targetH = 240;
    const scale = contentW / bannerImg.width;
    const drawH = Math.min(targetH, bannerImg.height * scale);
    const yImg = y - drawH;
    if (yImg > marginBottom + 120) {
      page.drawImage(bannerImg, { x: marginX, y: yImg, width: contentW, height: drawH });
      y = yImg - 18;
    }
  }

  // Intro paragraphs (before first checkbox / heading)
  let iCursor = 0;
  const introParts: string[] = [];
  for (; iCursor < mdSource.length; iCursor++) {
    const line = mdSource[iCursor].trim();
    if (!line) { if (introParts.length > 0) { iCursor++; break; } continue; }
    if (line.startsWith("- [") || line.startsWith("## ") || line.startsWith("- ")) break;
    introParts.push(line);
  }
  const intro = introParts.join(" ").slice(0, 900);
  if (intro) {
    drawLines(intro, { font: regular, size: 11, leading: 17 });
    y -= 8;
  }

  // ============ ITEMS ============
  const finalHeadingRegex = /^##\s+Что важно помнить\s*$/;
  const finalBlockLines: string[] = [];
  let inFinalBlock = false;

  for (let i = iCursor; i < mdSource.length; i++) {
    const line = mdSource[i].replace(/\r/g, "");
    if (finalHeadingRegex.test(line.trim())) { inFinalBlock = true; continue; }
    if (inFinalBlock) {
      if (line.trim()) finalBlockLines.push(line.trim());
      continue;
    }
    if (!line.trim()) { y -= 6; continue; }
    if (line.startsWith("## ")) {
      y -= 6;
      drawLines(line.replace(/^##\s+/, ""), { font: bold, size: 15, leading: 22 });
      y -= 4;
      continue;
    }
    const check = line.match(/^-\s*\[\s?\]\s*(.+)$/);
    if (check) {
      const raw = check[1].trim();
      // Split "Heading — description" — accept en/em dash, hyphen, colon.
      const m = raw.match(/^([^—–\-:]{3,120}?)\s*[—–\-:]\s+(.+)$/);
      const head = (m ? m[1] : raw).trim();
      const desc = m ? m[2].trim() : "";
      if (y - 46 < marginBottom + 20) newPage();
      const boxY = y - 14;
      page.drawRectangle({ x: marginX, y: boxY, width: 12, height: 12, color: brandColor });
      drawLines(head, { font: bold, size: 12, leading: 17, indent: 22 });
      if (desc) drawLines(desc, { font: regular, size: 10.5, leading: 15, indent: 22, color: mutedColor });
      y -= 8;
      continue;
    }
    if (line.startsWith("- ")) {
      drawLines("• " + line.slice(2), { font: regular, size: 11, leading: 16, indent: 14 });
      continue;
    }
    drawLines(line, { font: regular, size: 11, leading: 16 });
  }

  // ============ FINAL PAGE ============
  newPage();

  if (finalImg) {
    const targetH = 200;
    const scale = Math.min(contentW / finalImg.width, targetH / finalImg.height);
    const drawW = finalImg.width * scale;
    const drawH = finalImg.height * scale;
    const xImg = (pageW - drawW) / 2;
    y -= 4;
    if (y - drawH < marginBottom + 200) newPage();
    page.drawImage(finalImg, { x: xImg, y: y - drawH, width: drawW, height: drawH });
    y -= drawH + 18;
  }

  page.drawRectangle({ x: marginX, y: y, width: 56, height: 3, color: brandColor });
  y -= 16;
  drawLines("Что важно помнить", { font: bold, size: 20, leading: 26 });
  y -= 4;

  const reminders = finalBlockLines.length > 0
    ? finalBlockLines.slice(0, 5)
    : ["Возвращайтесь к чек-листу перед каждым проектом и отмечайте пройденные пункты."];
  for (const r of reminders) {
    const clean = r.replace(/^[-•]\s*/, "").replace(/^\d+\.\s*/, "");
    drawLines("— " + clean, { font: regular, size: 11, leading: 17, indent: 6 });
    y -= 2;
  }
  y -= 18;

  // ---- Author block ----
  if (client.expert_name || client.name) {
    const blockH = 108;
    if (y - blockH - 90 < marginBottom + 20) newPage();
    const blockY = y - blockH;
    page.drawRectangle({ x: marginX, y: blockY, width: contentW, height: blockH, color: lightBg });
    const avatarSize = 72;
    const avatarX = marginX + 18;
    const avatarY = blockY + (blockH - avatarSize) / 2;
    if (expertImg) {
      page.drawImage(expertImg, { x: avatarX, y: avatarY, width: avatarSize, height: avatarSize });
    } else {
      page.drawRectangle({ x: avatarX, y: avatarY, width: avatarSize, height: avatarSize, color: brandColor });
      const initials = (client.expert_name || client.name || "?")
        .split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";
      const initialsSize = 26;
      const iw = bold.widthOfTextAtSize(initials, initialsSize);
      page.drawText(initials, {
        x: avatarX + (avatarSize - iw) / 2,
        y: avatarY + (avatarSize - initialsSize) / 2 + 2,
        size: initialsSize, font: bold, color: white,
      });
    }
    const textX = avatarX + avatarSize + 18;
    const textMaxW = contentW - (textX - marginX) - 16;
    let ty = blockY + blockH - 22;
    if (client.expert_name) {
      page.drawText(client.expert_name.slice(0, 60), { x: textX, y: ty, size: 14, font: bold, color: inkColor });
      ty -= 17;
    }
    if (client.expert_bio) {
      const bioLines = wrap(client.expert_bio, regular, 10, textMaxW);
      for (const l of bioLines.slice(0, 2)) {
        page.drawText(l, { x: textX, y: ty, size: 10, font: regular, color: mutedColor });
        ty -= 13;
      }
    }
    if (domain) {
      page.drawText(domain, { x: textX, y: ty, size: 10, font: bold, color: brandColor });
      const dW = bold.widthOfTextAtSize(domain, 10);
      const linkUrl = utm("author_domain");
      if (linkUrl) annotLinks.push({ page, x: textX - 2, y: ty - 3, w: dW + 4, h: 13, url: linkUrl });
      ty -= 15;
    }
    const contacts: string[] = [];
    if (client.contact_email) contacts.push(`E-mail: ${client.contact_email}`);
    if (client.contact_phone) contacts.push(`Тел.: ${client.contact_phone}`);
    if (contacts.length > 0) {
      page.drawText(contacts.join("    "), { x: textX, y: ty, size: 9, font: regular, color: mutedColor });
    }
    y = blockY - 20;
  }

  // ---- CTA button ----
  if (domain) {
    const ctaText = "Обсудить подбор с экспертом";
    const padX = 22, padY = 14;
    const ctaTextW = bold.widthOfTextAtSize(ctaText, 12);
    const ctaW = ctaTextW + padX * 2;
    const ctaH = 12 + padY * 2;
    if (y - ctaH < marginBottom + 20) newPage();
    const ctaX = (pageW - ctaW) / 2;
    const ctaY = y - ctaH;
    page.drawRectangle({ x: ctaX, y: ctaY, width: ctaW, height: ctaH, color: brandColor });
    page.drawText(ctaText, { x: ctaX + padX, y: ctaY + padY, size: 12, font: bold, color: white });
    const linkUrl = utm("cta_expert");
    if (linkUrl) annotLinks.push({ page, x: ctaX, y: ctaY, w: ctaW, h: ctaH, url: linkUrl });
    y -= ctaH + 14;
  }

  // ---- Footers + link annotations ----
  const totalPages = pages.length;
  for (let i = 0; i < pages.length; i++) drawFooter(pages[i], i + 1, totalPages);

  for (const link of annotLinks) {
    try {
      const annotDict = pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [link.x, link.y, link.x + link.w, link.y + link.h],
        Border: [0, 0, 0],
        A: pdf.context.obj({
          Type: "Action",
          S: "URI",
          URI: PDFString.of(link.url),
        }),
      });
      const ref = pdf.context.register(annotDict);
      const key = PDFName.of("Annots");
      const existing = link.page.node.get(key);
      if (existing && typeof (existing as any).push === "function") {
        (existing as any).push(ref);
      } else {
        link.page.node.set(key, pdf.context.obj([ref]));
      }
    } catch (e) {
      console.warn("[CHECKLIST-PDF] link annotation failed", (e as Error).message);
    }
  }

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