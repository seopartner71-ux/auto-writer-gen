// Универсальный PDF-билдер: читает pdf_template_config.structure[] из document_types
// и по каждому блоку вызывает соответствующий рендерер из реестра.
// Не заменяет checklistPdf.ts (тот работает эталонно) — только для новых типов.

import {
  PDFDocument, rgb, hexToRgb, cleanDomain, loadRobotoFonts, embedImage,
  wrapText, parseInlineTokens, measureRichHeight, attachLinkAnnotations,
  setStandardMetadata, LinkAnnot,
  drawTable, measureTableHeight, drawCheckbox, drawQrCode,
} from "./pdfUtils.ts";

export interface DocClient {
  name?: string; brand_color?: string; domain?: string; logo_url?: string;
  expert_name?: string; expert_bio?: string; expert_photo_url?: string;
  contact_email?: string; contact_phone?: string;
}

export interface DocArticle {
  title?: string | null; keyword?: string | null; main_keyword?: string | null;
  meta_description?: string | null; lsi_keywords?: string[] | null;
}

export interface BuildDocInput {
  markdown: string;
  title: string;
  ecosystemId: string;
  client: DocClient | null;
  article: DocArticle | null;
  imageUrls?: string[] | null;
  // pdf_template_config из document_types (со structure[] или без — для «checklist_v1» будет другой билдер).
  pdfConfig: any;
  documentTypeName?: string;
}

export interface BuildDocResult {
  bytes: Uint8Array;
  unrenderedLinks: number;
  pageCount: number;
  metadataOk: boolean;
}

// ---------- Основной рендерер ----------

export async function buildDocumentUniversalPdf(input: BuildDocInput): Promise<BuildDocResult> {
  const pdf = await PDFDocument.create();
  const { regular, bold } = await loadRobotoFonts(pdf);
  const client = input.client || {};
  const brand = hexToRgb(client.brand_color);
  const brandColor = rgb(brand.r, brand.g, brand.b);
  const brandLight = rgb(
    Math.min(1, brand.r + (1 - brand.r) * 0.88),
    Math.min(1, brand.g + (1 - brand.g) * 0.88),
    Math.min(1, brand.b + (1 - brand.b) * 0.88),
  );
  const brandDark = rgb(brand.r * 0.4, brand.g * 0.4, brand.b * 0.4);
  const ink = rgb(0.09, 0.09, 0.12);
  const muted = rgb(0.42, 0.42, 0.48);
  const lightBg = rgb(0.96, 0.96, 0.98);
  const white = rgb(1, 1, 1);

  const domain = cleanDomain(client.domain);
  const brandName = client.name || "";
  const pageW = 595.28;
  const pageH = 841.89;
  const cfg = input.pdfConfig || {};
  const mmToPt = (mm: number) => mm * 2.83465;
  const marginX = mmToPt(Number(cfg.margin_left_mm || 20));
  const marginRight = mmToPt(Number(cfg.margin_right_mm || 20));
  const marginTop = mmToPt(Number(cfg.margin_top_mm || 24));
  const marginBottom = mmToPt(Number(cfg.margin_bottom_mm || 22));
  const contentW = pageW - marginX - marginRight;
  const bodySize = Number(cfg.font_size_body || 11);

  const images = (input.imageUrls || []).filter(Boolean);
  const bannerImg = images[0] ? await embedImage(pdf, images[0]) : null;
  const logoImg = client.logo_url ? await embedImage(pdf, client.logo_url) : null;
  const expertImg = client.expert_photo_url ? await embedImage(pdf, client.expert_photo_url) : null;
  // Изображения для распределения между главами (все кроме баннера).
  const chapterImgs: any[] = [];
  for (let i = 1; i < images.length; i++) {
    const img = await embedImage(pdf, images[i]);
    if (img) chapterImgs.push(img);
  }

  const utm = (content: string): string | null =>
    domain
      ? `https://${domain}/?utm_source=document&utm_medium=ecosystem&utm_campaign=ecosystem_${input.ecosystemId}&utm_content=${content}`
      : null;

  // deno-lint-ignore no-explicit-any
  const pages: any[] = [];
  const annotLinks: LinkAnnot[] = [];
  // Метка страниц, которые НЕ должны получать нижний колонтитул (обложка, back_cover).
  const skipFooter = new Set<any>();

  let unrenderedLinks = 0;
  const hasMdLink = (s: string) => /\[[^\]]+\]\(https?:\/\/[^\s)]+\)/.test(s);

  // ---- Парсинг markdown в блоки ----
  const raw = input.markdown.replace(/\r\n/g, "\n").split("\n");
  let h1Line = input.title;
  const idxH1 = raw.findIndex((l) => l.trim().startsWith("# "));
  if (idxH1 >= 0) { h1Line = raw[idxH1].replace(/^#\s+/, "").trim(); raw.splice(idxH1, 1); }

  interface MdBlock { kind: "h2" | "h3" | "p" | "li" | "blank" | "table"; text: string; rows?: string[][] }
  const md: MdBlock[] = [];
  for (let li = 0; li < raw.length; li++) {
    const line = raw[li];
    const t = line.trim();
    if (!t) { md.push({ kind: "blank", text: "" }); continue; }
    // Markdown table: header row + separator (---) + body rows
    if (/^\|.+\|\s*$/.test(t) && li + 1 < raw.length && /^\|[\s\-:|]+\|\s*$/.test(raw[li + 1].trim())) {
      const rows: string[][] = [];
      const parseRow = (s: string) => s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      rows.push(parseRow(t));
      li += 2; // skip separator
      while (li < raw.length && /^\|.+\|\s*$/.test(raw[li].trim())) {
        rows.push(parseRow(raw[li].trim()));
        li++;
      }
      li--;
      md.push({ kind: "table", text: "", rows });
      continue;
    }
    if (t.startsWith("## ")) md.push({ kind: "h2", text: t.slice(3).trim() });
    else if (t.startsWith("### ")) md.push({ kind: "h3", text: t.slice(4).trim() });
    else if (/^[-*]\s+\[\s?\]\s+/.test(t)) md.push({ kind: "li", text: t.replace(/^[-*]\s+\[\s?\]\s+/, "☐ ") });
    else if (/^[-*]\s+/.test(t)) md.push({ kind: "li", text: t.replace(/^[-*]\s+/, "") });
    else md.push({ kind: "p", text: t });
  }

  const paragraphs = md.filter((b) => b.kind === "p").map((b) => b.text);
  const bullets = md.filter((b) => b.kind === "li").map((b) => b.text);

  interface Chapter { title: string; blocks: MdBlock[] }
  const chaptersAll: Chapter[] = [];
  let cur: Chapter | null = null;
  for (const b of md) {
    if (b.kind === "h2") { cur = { title: b.text, blocks: [] }; chaptersAll.push(cur); }
    else if (cur) cur.blocks.push(b);
  }
  const introBeforeH2 = md.slice(0, md.findIndex((b) => b.kind === "h2") >= 0 ? md.findIndex((b) => b.kind === "h2") : md.length)
    .filter((b) => b.kind === "p" || b.kind === "li");

  // ---- state ----
  let page = pdf.addPage([pageW, pageH]);
  pages.push(page);
  let y = pageH - marginTop;

  const ensureRoom = (needed: number) => {
    if (y - needed < marginBottom + 20) newPage();
  };
  const newPage = () => {
    page = pdf.addPage([pageW, pageH]);
    pages.push(page);
    y = pageH - marginTop;
  };

  const drawRich = (
    text: string,
    opts: { font?: any; size?: number; color?: any; leading?: number; indent?: number },
  ) => {
    const size = opts.size ?? bodySize;
    const leading = opts.leading ?? size * 1.5;
    const indent = opts.indent ?? 0;
    const font = opts.font || regular;
    const color = opts.color || ink;
    const maxW = contentW - indent;
    if (hasMdLink(text) && !/\[[^\]]+\]\(https?:\/\/[^\s)]+\)/.test(text)) unrenderedLinks++;
    const tokens = parseInlineTokens(text);
    if (tokens.length === 0) return;
    const spaceW = font.widthOfTextAtSize(" ", size);
    let line: typeof tokens = [];
    let lineW = 0;
    const flush = () => {
      if (line.length === 0) return;
      ensureRoom(leading);
      let x = marginX + indent;
      for (let i = 0; i < line.length; i++) {
        const t = line[i];
        const f = t.bold ? bold : font;
        const wW = f.widthOfTextAtSize(t.word, size);
        const c = t.url ? brandColor : color;
        page.drawText(t.word, { x, y: y - size, size, font: f, color: c });
        if (t.url) {
          page.drawLine({ start: { x, y: y - size - 1.5 }, end: { x: x + wW, y: y - size - 1.5 }, thickness: 0.6, color: brandColor });
          annotLinks.push({ page, x: x - 1, y: y - size - 3, w: wW + 2, h: size + 4, url: t.url });
        }
        x += wW + (i < line.length - 1 ? spaceW : 0);
      }
      y -= leading;
      line = []; lineW = 0;
    };
    for (const t of tokens) {
      const f = t.bold ? bold : font;
      const wW = f.widthOfTextAtSize(t.word, size);
      const need = lineW + (lineW ? spaceW : 0) + wW;
      if (need > maxW && line.length > 0) { flush(); line.push(t); lineW = wW; }
      else { line.push(t); lineW = need; }
    }
    flush();
  };

  const drawParagraphs = (paras: string[], size = bodySize) => {
    for (const p of paras) { drawRich(p, { size, leading: size * 1.55 }); y -= 4; }
  };

  // ---- Рендерер обложки (cover) ----
  const renderCover = (block: any) => {
    // Полностраничная обложка: акцент-полоса сверху, лого, крупный H1, подзаголовок, баннер.
    page.drawRectangle({ x: 0, y: pageH - 6, width: pageW, height: 6, color: brandColor });
    skipFooter.add(page);
    y = pageH - 90;
    // Логотип клиента (top-left)
    if (logoImg) {
      const h = 28;
      const w = Math.min(90, logoImg.width * (h / logoImg.height));
      page.drawImage(logoImg, { x: marginX, y: y - h, width: w, height: logoImg.height * (w / logoImg.width) });
      y -= h + 20;
    } else if (brandName) {
      page.drawText(brandName.slice(0, 40), { x: marginX, y: y - 14, size: 12, font: bold, color: ink });
      y -= 28;
    }
    // H1
    const h1Size = 30;
    const h1Lines = wrapText(h1Line, bold, h1Size, contentW);
    for (const ln of h1Lines) {
      page.drawText(ln, { x: marginX, y: y - h1Size, size: h1Size, font: bold, color: ink });
      y -= h1Size * 1.15;
    }
    y -= 6;
    // Подзаголовок = тип документа
    if (input.documentTypeName) {
      page.drawText(input.documentTypeName, { x: marginX, y: y - 12, size: 12, font: regular, color: muted });
      y -= 24;
    }
    // Brand accent bar
    page.drawRectangle({ x: marginX, y: y - 4, width: 64, height: 4, color: brandColor });
    y -= 24;
    // Author line
    if (client.expert_name) {
      page.drawText(`${client.expert_name}${brandName ? `, ${brandName}` : ""}`,
        { x: marginX, y: y - 11, size: 11, font: regular, color: muted });
      y -= 22;
    }
    // Версия и дата документа (важно для GEO — E-E-A-T freshness signal)
    {
      const now = new Date();
      const months = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
      const version = String((cfg as any)?.version || "1.0");
      const dateStr = `${months[now.getMonth()]} ${now.getFullYear()}`;
      page.drawText(`Версия ${version}`, { x: marginX, y: y - 10, size: 10, font: regular, color: muted });
      y -= 14;
      page.drawText(dateStr, { x: marginX, y: y - 10, size: 10, font: regular, color: muted });
      y -= 20;
      if (domain) {
        page.drawText(`Подготовлено экспертами ${domain}`, { x: marginX, y: y - 10, size: 10, font: regular, color: muted });
        y -= 20;
      }
    }
    // Banner image
    if (bannerImg && Array.isArray(block?.elements) && block.elements.includes("banner_from_unsplash") || bannerImg && cfg.banner_image) {
      const targetH = 260;
      const scale = contentW / bannerImg.width;
      const drawH = Math.min(targetH, bannerImg.height * scale);
      const yImg = Math.max(marginBottom + 40, y - drawH - 10);
      page.drawImage(bannerImg, { x: marginX, y: yImg, width: contentW, height: drawH });
    }
    // Cover — конец страницы.
    newPage();
  };

  const renderHeaderWithLogo = () => {
    page.drawRectangle({ x: 0, y: pageH - 4, width: pageW, height: 4, color: brandColor });
    let hx = marginX;
    const hy = pageH - marginTop + 6;
    if (logoImg) {
      const h = 20;
      const w = Math.min(60, logoImg.width * (h / logoImg.height));
      page.drawImage(logoImg, { x: hx, y: hy - h, width: w, height: logoImg.height * (w / logoImg.width) });
      hx += w + 10;
    }
    if (brandName) {
      page.drawText(brandName.slice(0, 40), { x: hx, y: hy - 10, size: 10, font: bold, color: ink });
    }
    y = pageH - marginTop - 12;
  };

  const renderH1Title = () => {
    const size = 22;
    ensureRoom(size * 1.3 * wrapText(h1Line, bold, size, contentW).length);
    for (const ln of wrapText(h1Line, bold, size, contentW)) {
      page.drawText(ln, { x: marginX, y: y - size, size, font: bold, color: ink });
      y -= size * 1.25;
    }
    page.drawRectangle({ x: marginX, y: y - 2, width: 48, height: 3, color: brandColor });
    y -= 20;
  };

  const renderCompactList = (block: any) => {
    const bulletStyle = String(block?.bullet_style || "dot");
    const marker = bulletStyle === "arrow" ? "→" : bulletStyle === "check" ? "✓" : "•";
    for (const li of bullets) {
      const size = bodySize;
      ensureRoom(size * 1.5 * 2);
      page.drawText(marker, { x: marginX, y: y - size, size: size + 1, font: bold, color: brandColor });
      drawRich(li, { size, leading: size * 1.5, indent: 18 });
      y -= 4;
    }
  };

  const renderIntroParagraph = () => {
    drawParagraphs(introBeforeH2.filter((b) => b.kind === "p").map((b) => b.text).slice(0, 2));
    y -= 6;
  };

  const renderIntroduction = () => {
    const paras = introBeforeH2.filter((b) => b.kind === "p").map((b) => b.text);
    drawParagraphs(paras, bodySize + 1);
  };

  const renderNumberedSteps = (block: any) => {
    const stepPrefix = String(block?.step_prefix || "Шаг {n}:");
    // Ищем H3 вида "### 1. ..." или обычные H3 внутри разделов, кроме "## Подводные камни".
    let n = 0;
    for (const b of md) {
      if (b.kind === "h2" && /подводн|final|итог/i.test(b.text)) break;
      if (b.kind === "h3") {
        n++;
        const clean = b.text.replace(/^\d+\.\s*/, "");
        const label = stepPrefix.replace("{n}", String(n));
        const size = 14;
        ensureRoom(size * 1.4 * 2);
        page.drawText(label, { x: marginX, y: y - size, size, font: bold, color: brandColor });
        const labelW = bold.widthOfTextAtSize(label + " ", size);
        drawRich(clean, { size, font: bold, indent: labelW });
        y -= 4;
      } else if (b.kind === "p" && n > 0) {
        drawRich(b.text, { size: bodySize, leading: bodySize * 1.55 });
        y -= 4;
      } else if (b.kind === "li" && n > 0) {
        page.drawText("•", { x: marginX + 4, y: y - bodySize, size: bodySize, font: bold, color: brandColor });
        drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: 18 });
      }
    }
    y -= 8;
  };

  const renderChapters = (block: any) => {
    const chapterPrefix = String(block?.chapter_prefix || "Глава {n}");
    const startNew = block?.chapter_start_new_page !== false;
    const h2Size = Number(block?.h2_font_size || 20);
    const h3Size = Number(block?.h3_font_size || 14);
    const txtSize = Number(block?.text_font_size || bodySize);
    const lh = Number(block?.line_height || 1.55);
    let n = 0;
    const skipTitles = new Set(["Практические выводы", "Что дальше"]);
    // Считаем количество глав, которые пойдут в рендер (без skip), чтобы
    // равномерно распределить chapterImgs между ними.
    const renderableCount = chaptersAll.filter((c) => !skipTitles.has(c.title)).length;
    const stride = chapterImgs.length > 0 && renderableCount > 0
      ? Math.max(1, Math.floor(renderableCount / (chapterImgs.length + 1)))
      : 0;
    let imgIdx = 0;
    for (const ch of chaptersAll) {
      if (skipTitles.has(ch.title)) continue;
      n++;
      if (n > 1 && startNew) newPage();
      // Вставка тематического фото перед каждой N-й главой (кроме первой).
      if (stride > 0 && imgIdx < chapterImgs.length && n > 1 && (n - 1) % stride === 0) {
        drawChapterImage(chapterImgs[imgIdx]);
        imgIdx++;
      }
      ensureRoom(h2Size * 2.5);
      page.drawText(chapterPrefix.replace("{n}", String(n)),
        { x: marginX, y: y - 10, size: 10, font: bold, color: brandColor });
      y -= 18;
      for (const ln of wrapText(ch.title, bold, h2Size, contentW)) {
        page.drawText(ln, { x: marginX, y: y - h2Size, size: h2Size, font: bold, color: ink });
        y -= h2Size * 1.2;
      }
      page.drawRectangle({ x: marginX, y: y, width: 40, height: 2, color: brandColor });
      y -= 16;
      for (const b of ch.blocks) {
        if (b.kind === "h3") {
          y -= 4; ensureRoom(h3Size * 1.4);
          for (const ln of wrapText(b.text, bold, h3Size, contentW)) {
            page.drawText(ln, { x: marginX, y: y - h3Size, size: h3Size, font: bold, color: ink });
            y -= h3Size * 1.2;
          }
          y -= 2;
        } else if (b.kind === "p") {
          drawRich(b.text, { size: txtSize, leading: txtSize * lh });
          y -= 6;
        } else if (b.kind === "li") {
          page.drawText("•", { x: marginX + 2, y: y - txtSize, size: txtSize, font: bold, color: brandColor });
          drawRich(b.text, { size: txtSize, leading: txtSize * (lh - 0.05), indent: 16 });
        } else if (b.kind === "blank") {
          y -= 4;
        }
      }
    }
    // Если остались нераспределённые фото — размещаем их подряд в конце.
    while (imgIdx < chapterImgs.length) {
      drawChapterImage(chapterImgs[imgIdx]);
      imgIdx++;
    }
  };

  // Рисует одно тематическое фото на всю ширину контента.
  const drawChapterImage = (img: any) => {
    if (!img) return;
    const maxH = 210;
    const scale = contentW / img.width;
    const drawH = Math.min(maxH, img.height * scale);
    ensureRoom(drawH + 18);
    const yImg = y - drawH;
    page.drawImage(img, { x: marginX, y: yImg, width: contentW, height: drawH });
    y = yImg - 12;
  };

  const renderBoxedSection = (title: string, opts: { border?: any; bg?: any; startNew?: boolean; icon?: string }) => {
    const body = extractSectionBodyBlocks(title);
    if (!body || body.length === 0) return;
    if (opts.startNew) newPage();
    // измеряем
    const measure = () => {
      let h = 40;
      for (const b of body) {
        if (b.kind === "p") h += (wrapText(b.text, regular, bodySize, contentW - 32).length) * bodySize * 1.5 + 6;
        else if (b.kind === "li") h += (wrapText(b.text, regular, bodySize, contentW - 48).length) * bodySize * 1.5 + 4;
        else if (b.kind === "h3") h += bodySize * 1.8;
      }
      return h + 20;
    };
    const boxH = Math.min(measure(), pageH - marginTop - marginBottom - 40);
    ensureRoom(boxH);
    const boxY = y - boxH;
    page.drawRectangle({ x: marginX, y: boxY, width: contentW, height: boxH, color: opts.bg || brandLight });
    page.drawRectangle({ x: marginX, y: boxY, width: 3, height: boxH, color: opts.border || brandColor });
    // header
    y -= 20;
    page.drawText(`${opts.icon ? opts.icon + " " : ""}${title}`, { x: marginX + 16, y: y - 14, size: 14, font: bold, color: ink });
    y -= 26;
    for (const b of body) {
      if (b.kind === "p") { drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: 16 }); y -= 4; }
      else if (b.kind === "li") {
        page.drawText(opts.icon || "•", { x: marginX + 16, y: y - bodySize, size: bodySize, font: bold, color: opts.border || brandColor });
        drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: 32 });
      } else if (b.kind === "h3") {
        drawRich(b.text, { size: bodySize + 1, font: bold, leading: bodySize * 1.6, indent: 16 });
      }
    }
    y = boxY - 18;
  };

  const extractSectionBodyBlocks = (title: string): MdBlock[] | null => {
    const startIdx = md.findIndex((b) => b.kind === "h2" && b.text.trim() === title.trim());
    if (startIdx < 0) return null;
    const out: MdBlock[] = [];
    for (let i = startIdx + 1; i < md.length; i++) {
      if (md[i].kind === "h2") break;
      out.push(md[i]);
    }
    return out;
  };

  const renderWarningsBox = (block: any) => renderBoxedSection(String(block?.title || "Подводные камни"),
    { border: brandColor, bg: brandLight, icon: "!" });
  const renderPracticalConclusions = (block: any) => renderBoxedSection(String(block?.title || "Практические выводы"),
    { border: brandColor, bg: brandLight, icon: "✓" });

  const renderFinalPrinciple = () => {
    // Последний абзац или блок "## ..." финального типа
    const lastP = paragraphs[paragraphs.length - 1];
    if (!lastP) return;
    const h = wrapText(lastP, bold, 12, contentW - 32).length * 20 + 32;
    ensureRoom(h);
    const boxY = y - h;
    page.drawRectangle({ x: marginX, y: boxY, width: contentW, height: h, color: brandLight });
    page.drawRectangle({ x: marginX, y: boxY, width: 3, height: h, color: brandColor });
    y -= 16;
    drawRich(lastP, { size: 12, font: bold, leading: 20, indent: 16 });
    y = boxY - 16;
  };

  const renderFinalTip = () => renderFinalPrinciple();

  const renderNextSteps = (block: any) => {
    const title = String(block?.title || "Что дальше");
    if (block?.start_new_page) newPage();
    const body = extractSectionBodyBlocks(title);
    if (!body) return;
    ensureRoom(60);
    page.drawText(title, { x: marginX, y: y - 18, size: 18, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 24, width: 40, height: 2, color: brandColor });
    y -= 40;
    for (const b of body) {
      if (b.kind === "p") { drawRich(b.text, { leading: bodySize * 1.55 }); y -= 4; }
      else if (b.kind === "li") {
        page.drawText("•", { x: marginX, y: y - bodySize, size: bodySize, font: bold, color: brandColor });
        drawRich(b.text, { leading: bodySize * 1.5, indent: 16 });
      }
    }
  };

  const renderTableOfContents = (block: any) => {
    const size = Number(block?.font_size || 12);
    const titleText = String(block?.title || "Содержание");
    ensureRoom(60);
    page.drawText(titleText, { x: marginX, y: y - 24, size: 24, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 30, width: 48, height: 3, color: brandColor });
    y -= 60;
    let n = 0;
    const skip = new Set(["Практические выводы", "Что дальше"]);
    for (const ch of chaptersAll) {
      if (skip.has(ch.title)) continue;
      n++;
      ensureRoom(size * 2);
      const label = `${n}. ${ch.title}`;
      const labelW = regular.widthOfTextAtSize(label, size);
      page.drawText(label, { x: marginX, y: y - size, size, font: regular, color: ink });
      // dotted leader
      const dotsStart = marginX + labelW + 8;
      const dotsEnd = marginX + contentW - 12;
      let dx = dotsStart;
      while (dx < dotsEnd) {
        page.drawText(".", { x: dx, y: y - size, size, font: regular, color: muted });
        dx += 4;
      }
      y -= size * 1.8;
    }
    newPage();
  };

  const renderAuthorCardFull = (block: any) => {
    if (!client.expert_name && !brandName) return;
    const bg = block?.background === "light_tint" ? lightBg : lightBg;
    const bioLines = client.expert_bio ? wrapText(client.expert_bio, regular, 11, contentW - 108).slice(0, 3).length : 0;
    const contactRows = (client.contact_email ? 1 : 0) + (client.contact_phone ? 1 : 0) + (domain ? 1 : 0);
    const blockH = Math.max(108, 40 + 18 + bioLines * 14 + contactRows * 14 + 16);
    ensureRoom(blockH + 80);
    const blockY = y - blockH;
    page.drawRectangle({ x: marginX, y: blockY, width: contentW, height: blockH, color: bg });
    const avatarSize = 72;
    const avatarX = marginX + 18;
    const avatarY = blockY + (blockH - avatarSize) / 2;
    if (expertImg) {
      page.drawImage(expertImg, { x: avatarX, y: avatarY, width: avatarSize, height: avatarSize });
    } else {
      page.drawRectangle({ x: avatarX, y: avatarY, width: avatarSize, height: avatarSize, color: brandColor });
      const initials = (client.expert_name || brandName || "?")
        .split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";
      const iw = bold.widthOfTextAtSize(initials, 26);
      page.drawText(initials, { x: avatarX + (avatarSize - iw) / 2, y: avatarY + avatarSize / 2 - 8, size: 26, font: bold, color: white });
    }
    const tx = avatarX + avatarSize + 18;
    const twMax = contentW - (tx - marginX) - 16;
    let ty = blockY + blockH - 22;
    if (client.expert_name) { page.drawText(client.expert_name.slice(0, 60), { x: tx, y: ty, size: 14, font: bold, color: ink }); ty -= 17; }
    if (client.expert_bio) {
      for (const l of wrapText(client.expert_bio, regular, 11, twMax).slice(0, 3)) {
        page.drawText(l, { x: tx, y: ty, size: 11, font: regular, color: muted });
        ty -= 14;
      }
    }
    if (domain) {
      page.drawText(domain, { x: tx, y: ty, size: 10, font: bold, color: brandColor });
      const dW = bold.widthOfTextAtSize(domain, 10);
      const link = utm("author_domain");
      if (link) annotLinks.push({ page, x: tx - 2, y: ty - 3, w: dW + 4, h: 13, url: link });
      ty -= 14;
    }
    if (client.contact_email) {
      const label = `Email: ${client.contact_email}`;
      page.drawText(label, { x: tx, y: ty, size: 10, font: regular, color: brandColor });
      const lw = regular.widthOfTextAtSize(label, 10);
      annotLinks.push({ page, x: tx - 2, y: ty - 3, w: lw + 4, h: 13, url: `mailto:${client.contact_email}` });
      ty -= 14;
    }
    if (client.contact_phone) {
      const digits = String(client.contact_phone).replace(/[^\d+]/g, "");
      const label = `Тел.: ${client.contact_phone}`;
      page.drawText(label, { x: tx, y: ty, size: 10, font: regular, color: brandColor });
      const lw = regular.widthOfTextAtSize(label, 10);
      annotLinks.push({ page, x: tx - 2, y: ty - 3, w: lw + 4, h: 13, url: `tel:${digits}` });
    }
    y = blockY - 18;
  };

  const renderAuthorCardMini = () => {
    if (!client.expert_name && !brandName) return;
    ensureRoom(40);
    const line = `${client.expert_name || brandName}${brandName && client.expert_name ? `, ${brandName}` : ""}`;
    page.drawText(line.slice(0, 80), { x: marginX, y: y - 11, size: 11, font: bold, color: ink });
    y -= 16;
    if (domain) {
      page.drawText(domain, { x: marginX, y: y - 10, size: 10, font: regular, color: brandColor });
      const dW = regular.widthOfTextAtSize(domain, 10);
      const link = utm("author_mini");
      if (link) annotLinks.push({ page, x: marginX - 2, y: y - 13, w: dW + 4, h: 13, url: link });
      y -= 14;
    }
  };

  const renderCtaButton = (block: any) => {
    if (!domain) return;
    const keyword = input.article?.keyword || input.article?.main_keyword || "";
    const tpl = String(block?.text || "Обсудить с экспертом");
    const ctaText = tpl.replace(/\{\{\s*article\.keyword\s*\}\}/g, keyword).slice(0, 80);
    const padX = 22, padY = 14;
    const ctaW = bold.widthOfTextAtSize(ctaText, 12) + padX * 2;
    const ctaH = 12 + padY * 2;
    ensureRoom(ctaH + 20);
    const ctaX = (pageW - ctaW) / 2;
    const ctaY = y - ctaH;
    page.drawRectangle({ x: ctaX, y: ctaY, width: ctaW, height: ctaH, color: brandColor });
    page.drawText(ctaText, { x: ctaX + padX, y: ctaY + padY, size: 12, font: bold, color: white });
    const link = utm(String(block?.utm_content || "cta_expert"));
    if (link) annotLinks.push({ page, x: ctaX, y: ctaY, w: ctaW, h: ctaH, url: link });
    y -= ctaH + 20;
  };

  const renderBackCover = () => {
    newPage();
    skipFooter.add(page);
    page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: brandDark });
    let by = pageH - 100;
    if (logoImg) {
      const h = 60;
      const w = Math.min(200, logoImg.width * (h / logoImg.height));
      page.drawImage(logoImg, { x: (pageW - w) / 2, y: by - h, width: w, height: logoImg.height * (w / logoImg.width) });
      by -= h + 20;
    } else if (brandName) {
      const size = 26;
      const w = bold.widthOfTextAtSize(brandName, size);
      page.drawText(brandName, { x: (pageW - w) / 2, y: by - size, size, font: bold, color: white });
      by -= size + 24;
    }
    if (domain) {
      const size = 14;
      const w = regular.widthOfTextAtSize(domain, size);
      page.drawText(domain, { x: (pageW - w) / 2, y: by - size, size, font: regular, color: white });
      const link = utm("back_cover");
      if (link) annotLinks.push({ page, x: (pageW - w) / 2 - 2, y: by - size - 3, w: w + 4, h: size + 6, url: link });
      by -= size + 24;
    }
    if (client.expert_name) {
      const line = `${client.expert_name}${client.expert_bio ? ` — ${client.expert_bio.slice(0, 60)}` : ""}`;
      const w = regular.widthOfTextAtSize(line, 11);
      page.drawText(line, { x: (pageW - w) / 2, y: by - 11, size: 11, font: regular, color: white });
      by -= 26;
    }
    if (client.contact_email) {
      const line = `Email: ${client.contact_email}`;
      const w = regular.widthOfTextAtSize(line, 11);
      page.drawText(line, { x: (pageW - w) / 2, y: by - 11, size: 11, font: regular, color: white });
      annotLinks.push({ page, x: (pageW - w) / 2 - 2, y: by - 14, w: w + 4, h: 14, url: `mailto:${client.contact_email}` });
      by -= 20;
    }
    if (client.contact_phone) {
      const digits = String(client.contact_phone).replace(/[^\d+]/g, "");
      const line = `Тел.: ${client.contact_phone}`;
      const w = regular.widthOfTextAtSize(line, 11);
      page.drawText(line, { x: (pageW - w) / 2, y: by - 11, size: 11, font: regular, color: white });
      annotLinks.push({ page, x: (pageW - w) / 2 - 2, y: by - 14, w: w + 4, h: 14, url: `tel:${digits}` });
      by -= 20;
    }
    const cr = `© ${new Date().getFullYear()} ${brandName || "СЕО-Модуль"}`;
    const cw = regular.widthOfTextAtSize(cr, 10);
    page.drawText(cr, { x: (pageW - cw) / 2, y: 60, size: 10, font: regular, color: white });
  };

  const renderFooterPagination = (leftTpl: string, rightTpl: string) => {
    const total = pages.length;
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      if (skipFooter.has(p)) continue;
      const pageNo = i + 1;
      const left = leftTpl
        .replace("{{expert_name}}", client.expert_name || "")
        .replace("{{brand_name}}", brandName || "")
        .slice(0, 70);
      const right = rightTpl.replace("{{domain}}", domain || "").slice(0, 60);
      const centerLabel = `${pageNo} / ${total}`;
      const yF = 30;
      if (left) p.drawText(left, { x: marginX, y: yF, size: 8, font: regular, color: muted });
      const cw = regular.widthOfTextAtSize(centerLabel, 8);
      p.drawText(centerLabel, { x: (pageW - cw) / 2, y: yF, size: 8, font: regular, color: muted });
      if (right) {
        const rw = regular.widthOfTextAtSize(right, 8);
        p.drawText(right, { x: pageW - marginRight - rw, y: yF, size: 8, font: regular, color: brandColor });
      }
    }
  };

  const renderFooterWithDomain = () => {
    for (const p of pages) {
      if (skipFooter.has(p)) continue;
      const yF = 24;
      const line = [brandName, domain].filter(Boolean).join(" — ");
      if (line) {
        const w = regular.widthOfTextAtSize(line, 9);
        p.drawText(line, { x: (pageW - w) / 2, y: yF, size: 9, font: regular, color: muted });
      }
    }
  };

  // ---- Реестр блоков ----
  const renderers: Record<string, (block: any) => void | Promise<void>> = {
    cover: renderCover,
    header_with_logo: renderHeaderWithLogo,
    h1_title: renderH1Title,
    table_of_contents: renderTableOfContents,
    introduction: renderIntroduction,
    intro_paragraph: renderIntroParagraph,
    compact_list: renderCompactList,
    numbered_steps: renderNumberedSteps,
    chapters: renderChapters,
    warnings_box: renderWarningsBox,
    practical_conclusions_box: renderPracticalConclusions,
    final_principle: renderFinalPrinciple,
    final_tip: renderFinalTip,
    next_steps: renderNextSteps,
    author_card_full: renderAuthorCardFull,
    author_card_mini: renderAuthorCardMini,
    cta_button: renderCtaButton,
    back_cover: renderBackCover,
    // footer blocks обрабатываются в самом конце (проход по всем страницам)
    brand_footer_pagination: () => {},
    footer_pagination: () => {},
    footer_with_domain: () => {},
  };

  const structure: any[] = Array.isArray(cfg.structure) ? cfg.structure : [];
  // Fallback structure если нет structure[]
  const effectiveStructure = structure.length > 0 ? structure : [
    { block: "h1_title" }, { block: "introduction" }, { block: "chapters" },
    { block: "author_card_full" }, { block: "footer_with_domain" },
  ];

  let hasHeader = false;
  for (const b of effectiveStructure) {
    const name = String(b?.block || "");
    const fn = renderers[name];
    if (!fn) { console.warn("[documentPdf] unknown block:", name); continue; }
    if (name === "header_with_logo") hasHeader = true;
    await Promise.resolve(fn(b || {}));
  }

  // Финальные проходы для футеров
  const hasBrandFooter = effectiveStructure.some((b) => b?.block === "brand_footer_pagination" || b?.block === "footer_pagination");
  const hasDomainFooter = effectiveStructure.some((b) => b?.block === "footer_with_domain");
  if (hasBrandFooter) {
    const footerBlock = effectiveStructure.find((b) => b?.block === "brand_footer_pagination" || b?.block === "footer_pagination") || {};
    renderFooterPagination(
      String(footerBlock.left_content || "{{expert_name}}, {{brand_name}}"),
      String(footerBlock.right_content || "{{domain}}"),
    );
  } else if (hasDomainFooter) {
    renderFooterWithDomain();
  }

  // Аннотации
  attachLinkAnnotations(pdf, annotLinks);

  // Метаданные
  const meta = input.article || {};
  const firstPara = (input.markdown.split(/\n\s*\n/).map((s) => s.trim()).find((s) => s && !s.startsWith("#") && !s.startsWith("-")) || input.title).slice(0, 400);
  const keywordsRaw = Array.isArray(meta.lsi_keywords) && meta.lsi_keywords.length > 0
    ? meta.lsi_keywords
    : (meta.main_keyword ? [meta.main_keyword] : [input.title]);
  setStandardMetadata(pdf, {
    title: `${meta.title || input.title || "Документ"}${input.documentTypeName ? ` — ${input.documentTypeName}` : ""}`,
    author: client.expert_name || brandName || "СЕО-Модуль",
    subject: meta.meta_description || firstPara,
    keywords: keywordsRaw.map(String),
  });

  const bytes = await pdf.save();

  let metadataOk = true;
  try {
    const check = await PDFDocument.load(bytes, { updateMetadata: false });
    if (!check.getTitle() || !check.getAuthor() || !check.getSubject() || !check.getProducer() || !check.getCreator() || !check.getCreationDate()) {
      metadataOk = false;
    }
  } catch { metadataOk = false; }

  return { bytes, unrenderedLinks, pageCount: pages.length, metadataOk };
}