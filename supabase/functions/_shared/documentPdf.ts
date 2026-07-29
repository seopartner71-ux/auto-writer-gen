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
    // Skip horizontal rules (---, ***, ___) — they were leaking into cards/boxes as
    // stray "---" entries (rendered as a gray box with just dashes).
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(t)) { md.push({ kind: "blank", text: "" }); continue; }
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
      // Soft fallback: light tinted square with brand-colored initial (avoids a jarring solid black box).
      page.drawRectangle({ x: avatarX, y: avatarY, width: avatarSize, height: avatarSize, color: brandLight });
      page.drawRectangle({ x: avatarX, y: avatarY, width: avatarSize, height: 2, color: brandColor });
      const initials = (client.expert_name || brandName || "?")
        .split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";
      const iw = bold.widthOfTextAtSize(initials, 26);
      page.drawText(initials, { x: avatarX + (avatarSize - iw) / 2, y: avatarY + avatarSize / 2 - 8, size: 26, font: bold, color: brandColor });
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

  // =========================================================
  //   ЭКСПЕРТНЫЙ PDF (ТЗ): дополнительные блоки
  // =========================================================

  const months = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  const now = new Date();
  const dateStr = `${months[now.getMonth()]} ${now.getFullYear()}`;
  const version = String((cfg as any)?.version || "1.0");

  // Обложка ТЗ: категория, подзаголовок, польза, автор, дата, версия, QR
  const renderCoverExpert = (block: any) => {
    page.drawRectangle({ x: 0, y: pageH - 8, width: pageW, height: 8, color: brandColor });
    skipFooter.add(page);
    y = pageH - 72;
    // Категория / chip
    const category = String(block?.category || input.documentTypeName || "Экспертный документ");
    const chipW = bold.widthOfTextAtSize(category.toUpperCase(), 9) + 18;
    page.drawRectangle({ x: marginX, y: y - 18, width: chipW, height: 18, color: brandLight });
    page.drawText(category.toUpperCase(), { x: marginX + 9, y: y - 13, size: 9, font: bold, color: brandDark });
    y -= 40;
    // Логотип
    if (logoImg) {
      const h = 30;
      const w = Math.min(100, logoImg.width * (h / logoImg.height));
      page.drawImage(logoImg, { x: marginX, y: y - h, width: w, height: logoImg.height * (w / logoImg.width) });
      y -= h + 14;
    } else if (brandName) {
      page.drawText(brandName.slice(0, 40), { x: marginX, y: y - 12, size: 12, font: bold, color: ink });
      y -= 24;
    }
    // H1
    const h1Size = 32;
    for (const ln of wrapText(h1Line, bold, h1Size, contentW)) {
      page.drawText(ln, { x: marginX, y: y - h1Size, size: h1Size, font: bold, color: ink });
      y -= h1Size * 1.15;
    }
    y -= 8;
    // Подзаголовок
    const subtitle = String(block?.subtitle || "Практическое руководство от экспертов");
    for (const ln of wrapText(subtitle, regular, 14, contentW)) {
      page.drawText(ln, { x: marginX, y: y - 14, size: 14, font: regular, color: muted });
      y -= 20;
    }
    // Brand accent bar
    page.drawRectangle({ x: marginX, y: y - 6, width: 64, height: 4, color: brandColor });
    y -= 24;
    // "Польза" — берём meta_description или первый абзац
    const useful = input.article?.meta_description || paragraphs[0] || "";
    if (useful) {
      for (const ln of wrapText(useful.slice(0, 260), regular, 11, contentW).slice(0, 3)) {
        page.drawText(ln, { x: marginX, y: y - 11, size: 11, font: regular, color: ink });
        y -= 16;
      }
      y -= 8;
    }
    // Автор + бренд + дата + версия — карточка снизу
    const footerBoxH = 96;
    const footerBoxY = 130;
    page.drawRectangle({ x: marginX, y: footerBoxY, width: contentW, height: footerBoxH, color: brandLight });
    let fy = footerBoxY + footerBoxH - 20;
    page.drawText("Подготовлено:", { x: marginX + 16, y: fy, size: 9, font: regular, color: muted });
    fy -= 14;
    const brandLine = [brandName, domain].filter(Boolean).join(" • ") || "Экспертная команда";
    page.drawText(brandLine.slice(0, 60), { x: marginX + 16, y: fy, size: 13, font: bold, color: ink });
    fy -= 18;
    if (client.expert_name) {
      page.drawText(`Автор: ${client.expert_name}`, { x: marginX + 16, y: fy, size: 10, font: regular, color: ink });
      fy -= 14;
    }
    page.drawText(`Версия ${version} • ${dateStr}`, { x: marginX + 16, y: fy, size: 10, font: regular, color: muted });

    // QR-код справа
    if (domain) {
      const qrSize = 76;
      const qrX = pageW - marginRight - qrSize - 4;
      const qrY = footerBoxY + (footerBoxH - qrSize) / 2;
      const qrUrl = utm("cover_qr") || `https://${domain}`;
      drawQrCode(page, qrUrl, qrX, qrY, qrSize, ink);
      page.drawText(domain, {
        x: qrX + (qrSize - regular.widthOfTextAtSize(domain, 8)) / 2,
        y: qrY - 12, size: 8, font: regular, color: muted,
      });
    }
    newPage();
  };

  // Блок «Для кого этот материал» — 3 колонки
  const renderAudienceBox = (block: any) => {
    const title = String(block?.title || "Для кого этот материал");
    const body = extractSectionBodyBlocks(title);
    if (!body) return;
    // Разбиваем по H3
    const groups: { title: string; items: string[] }[] = [];
    let cur2: { title: string; items: string[] } | null = null;
    for (const b of body) {
      if (b.kind === "h3") { cur2 = { title: b.text, items: [] }; groups.push(cur2); }
      else if (cur2 && (b.kind === "li" || b.kind === "p")) { if (b.text.trim()) cur2.items.push(b.text); }
    }
    if (groups.length < 2) {
      // fallback: просто отрисуем как обычный раздел
      renderBoxedSection(title, { border: brandColor, bg: brandLight, icon: "→" });
      return;
    }
    ensureRoom(60);
    page.drawText(title, { x: marginX, y: y - 18, size: 18, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 24, width: 40, height: 2, color: brandColor });
    y -= 40;
    const cols = Math.min(3, groups.length);
    const gap = 12;
    const colW = (contentW - gap * (cols - 1)) / cols;
    // Высота колонки
    let maxLines = 0;
    groups.slice(0, cols).forEach((g) => {
      let lines = 2;
      g.items.forEach((it) => { lines += wrapText(it, regular, 10, colW - 20).length; });
      if (lines > maxLines) maxLines = lines;
    });
    const colH = 20 + maxLines * 14;
    ensureRoom(colH + 8);
    const boxY = y - colH;
    for (let ci = 0; ci < cols; ci++) {
      const g = groups[ci];
      const cx = marginX + ci * (colW + gap);
      page.drawRectangle({ x: cx, y: boxY, width: colW, height: colH, color: lightBg });
      page.drawRectangle({ x: cx, y: boxY + colH - 3, width: colW, height: 3, color: brandColor });
      page.drawText(g.title.slice(0, 40), { x: cx + 12, y: boxY + colH - 20, size: 11, font: bold, color: ink });
      let ty = boxY + colH - 36;
      for (const it of g.items) {
        page.drawText("•", { x: cx + 12, y: ty, size: 10, font: bold, color: brandColor });
        for (const ln of wrapText(it, regular, 10, colW - 24)) {
          page.drawText(ln, { x: cx + 22, y: ty, size: 10, font: regular, color: ink });
          ty -= 14;
        }
      }
    }
    y = boxY - 16;
  };

  // Разделы чек-листа: каждый H2 + под ним мини-чекбоксы «☐»
  const renderChecklistSections = (block: any) => {
    const skipTitles = new Set([
      "Для кого этот материал", "Сравнение", "Как выбрать",
      "Типичные ошибки", "FAQ", "Об авторе", "Финальный чек-лист", "Что дальше",
      "Практические выводы",
    ]);
    let n = 0;
    for (const ch of chaptersAll) {
      if (skipTitles.has(ch.title)) continue;
      n++;
      if (n > 1) y -= 4;
      ensureRoom(60);
      page.drawText(`${n}.`, { x: marginX, y: y - 16, size: 16, font: bold, color: brandColor });
      const numW = bold.widthOfTextAtSize(`${n}. `, 16);
      for (const ln of wrapText(ch.title, bold, 16, contentW - numW)) {
        page.drawText(ln, { x: marginX + numW, y: y - 16, size: 16, font: bold, color: ink });
        y -= 20;
      }
      page.drawRectangle({ x: marginX, y: y - 2, width: 28, height: 2, color: brandColor });
      y -= 12;
      for (const b of ch.blocks) {
        if (b.kind === "h3") {
          y -= 2; ensureRoom(16);
          drawRich(b.text, { size: 12, font: bold, leading: 16 });
        } else if (b.kind === "p") {
          drawRich(b.text, { size: bodySize, leading: bodySize * 1.5 });
          y -= 4;
        } else if (b.kind === "li") {
          const isCheckbox = b.text.startsWith("☐ ");
          if (isCheckbox) {
            ensureRoom(bodySize * 1.6);
            drawCheckbox(page, marginX + 2, y - bodySize + 1, bodySize - 1, brandColor);
            drawRich(b.text.slice(2), { size: bodySize, leading: bodySize * 1.5, indent: 18 });
          } else {
            page.drawText("•", { x: marginX + 2, y: y - bodySize, size: bodySize, font: bold, color: brandColor });
            drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: 16 });
          }
        } else if (b.kind === "table" && b.rows) {
          renderInlineTable(b.rows);
        } else if (b.kind === "blank") {
          y -= 4;
        }
      }
    }
  };

  const renderInlineTable = (rows: string[][]) => {
    if (rows.length === 0) return;
    const nCols = Math.max(...rows.map((r) => r.length));
    // pad rows to nCols
    const norm = rows.map((r) => {
      const c = [...r];
      while (c.length < nCols) c.push("");
      return c;
    });
    const colW = new Array(nCols).fill(contentW / nCols);
    const s = nCols > 3 ? 9 : 10;
    const h = measureTableHeight(norm, colW, regular, bold, s, s);
    ensureRoom(h + 16);
    y -= 4;
    y = drawTable(page, norm, { x: marginX, y, colWidths: colW, regular, bold, size: s, headerSize: s });
    y -= 12;
  };

  const renderComparisonTable = (_block: any) => {
    // Собираем все markdown-таблицы из документа
    const tables = md.filter((b) => b.kind === "table" && b.rows && b.rows.length > 1);
    if (tables.length === 0) return;
    ensureRoom(40);
    page.drawText("Сравнения и таблицы", { x: marginX, y: y - 18, size: 18, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 24, width: 40, height: 2, color: brandColor });
    y -= 34;
    for (const t of tables) renderInlineTable(t.rows!);
  };

  // Раздел «Типичные ошибки» — карточки
  const renderMistakesList = (block: any) => {
    const title = String(block?.title || "Типичные ошибки");
    const body = extractSectionBodyBlocks(title);
    if (!body) return;
    ensureRoom(60);
    page.drawText(title, { x: marginX, y: y - 18, size: 18, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 24, width: 40, height: 2, color: brandColor });
    y -= 40;
    // группируем по H3 (заголовок ошибки), собираем «Почему возникает» / «Как избежать» из абзацев
    let idx = 0;
    for (let i = 0; i < body.length; i++) {
      const b = body[i];
      if (b.kind !== "h3") continue;
      idx++;
      // Собираем всё до следующего h3
      const paras: string[] = [];
      for (let j = i + 1; j < body.length; j++) {
        if (body[j].kind === "h3") break;
        if (body[j].kind === "p" || body[j].kind === "li") paras.push(body[j].text);
      }
      const cardH = 44 + paras.reduce((s, p) => s + wrapText(p, regular, bodySize, contentW - 32).length * (bodySize * 1.4), 0);
      ensureRoom(cardH + 10);
      const cy = y - cardH;
      page.drawRectangle({ x: marginX, y: cy, width: contentW, height: cardH, color: lightBg });
      page.drawRectangle({ x: marginX, y: cy, width: 3, height: cardH, color: brandColor });
      page.drawText(`Ошибка ${idx}: ${b.text}`.slice(0, 90), { x: marginX + 16, y: y - 20, size: 12, font: bold, color: ink });
      y -= 32;
      for (const p of paras) {
        drawRich(p, { size: bodySize, leading: bodySize * 1.4, indent: 16 });
        y -= 2;
      }
      y = cy - 12;
    }
  };

  // FAQ
  const renderFaqSection = (block: any) => {
    const title = String(block?.title || "FAQ");
    const body = extractSectionBodyBlocks(title);
    if (!body) return;
    ensureRoom(60);
    page.drawText(title, { x: marginX, y: y - 20, size: 20, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 26, width: 40, height: 2, color: brandColor });
    y -= 40;
    // Каждый H3 — вопрос, дальше абзацы — ответ
    for (let i = 0; i < body.length; i++) {
      const b = body[i];
      if (b.kind !== "h3") continue;
      ensureRoom(40);
      page.drawText("?", { x: marginX, y: y - 12, size: 14, font: bold, color: brandColor });
      drawRich(b.text, { size: 12, font: bold, leading: 16, indent: 16 });
      y -= 4;
      for (let j = i + 1; j < body.length; j++) {
        if (body[j].kind === "h3") break;
        if (body[j].kind === "p") { drawRich(body[j].text, { size: bodySize, leading: bodySize * 1.5, indent: 16 }); y -= 2; }
        else if (body[j].kind === "li") {
          page.drawText("•", { x: marginX + 12, y: y - bodySize, size: bodySize, font: bold, color: brandColor });
          drawRich(body[j].text, { size: bodySize, leading: bodySize * 1.4, indent: 26 });
        }
      }
      y -= 10;
    }
  };

  // Финальный чек-лист «Проверьте перед покупкой» (2 колонки)
  const renderFinalChecklist = (block: any) => {
    const title = String(block?.title || "Финальный чек-лист");
    const body = extractSectionBodyBlocks(title);
    if (!body) return;
    const items = body
      .filter((b) => b.kind === "li")
      .map((b) => b.text.replace(/^☐\s*/, "").trim())
      .filter(Boolean);
    if (items.length === 0) return;
    newPage();
    page.drawText(title, { x: marginX, y: y - 22, size: 22, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 28, width: 48, height: 3, color: brandColor });
    y -= 46;
    const cols = 2;
    const gap = 16;
    const colW = (contentW - gap) / cols;
    const perCol = Math.ceil(items.length / cols);
    const cellH = 22;
    const topY = y;
    for (let ci = 0; ci < cols; ci++) {
      const cx = marginX + ci * (colW + gap);
      for (let ri = 0; ri < perCol; ri++) {
        const idx = ci * perCol + ri;
        if (idx >= items.length) break;
        const iy = topY - ri * cellH;
        drawCheckbox(page, cx, iy - 12, 11, brandColor);
        const txt = items[idx];
        const lines = wrapText(`${idx + 1}. ${txt}`, regular, 10, colW - 20);
        let ty = iy - 10;
        for (const ln of lines.slice(0, 2)) {
          page.drawText(ln, { x: cx + 18, y: ty, size: 10, font: regular, color: ink });
          ty -= 12;
        }
      }
    }
    y = topY - perCol * cellH - 12;
  };

  // Отдельный блок «QR-код»
  const renderQrBlock = (block: any) => {
    if (!domain) return;
    const size = Number(block?.size || 96);
    ensureRoom(size + 40);
    const qrX = (pageW - size) / 2;
    const qrY = y - size - 4;
    const url = utm(String(block?.utm_content || "qr_block")) || `https://${domain}`;
    drawQrCode(page, url, qrX, qrY, size, ink);
    y = qrY - 12;
    const caption = String(block?.caption || `Перейти на ${domain}`);
    const cw = regular.widthOfTextAtSize(caption, 10);
    page.drawText(caption, { x: (pageW - cw) / 2, y: y - 10, size: 10, font: regular, color: muted });
    y -= 24;
  };

  // Блок «Источник / дата обновления»
  const renderSourceBlock = (_block: any) => {
    ensureRoom(40);
    const parts = [
      brandName ? `Источник: ${brandName}` : null,
      domain ? domain : null,
      `Обновлено: ${dateStr}`,
      `Версия ${version}`,
    ].filter(Boolean).join(" • ");
    const w = regular.widthOfTextAtSize(parts, 9);
    page.drawRectangle({ x: marginX, y: y - 2, width: contentW, height: 0.6, color: muted });
    y -= 14;
    page.drawText(parts, { x: (pageW - w) / 2, y: y - 9, size: 9, font: regular, color: muted });
    y -= 22;
  };

  // =========================================================
  //   НОВЫЕ БЛОКИ: FAQ / Case / Whitepaper / Catalog
  // =========================================================

  // ---------- FAQ ----------

  const collectFaqPairs = (): { q: string; answer: MdBlock[] }[] => {
    const pairs: { q: string; answer: MdBlock[] }[] = [];
    const qaChapter = chaptersAll.find((c) => /вопрос/i.test(c.title));
    const scope = qaChapter ? qaChapter.blocks : md;
    let cur: { q: string; answer: MdBlock[] } | null = null;
    for (const b of scope) {
      if (b.kind === "h3" && b.text.trim().endsWith("?")) {
        if (cur) pairs.push(cur);
        cur = { q: b.text.trim(), answer: [] };
      } else if (b.kind === "h2") {
        if (cur) { pairs.push(cur); cur = null; }
      } else if (cur && (b.kind === "p" || b.kind === "li" || b.kind === "blank")) {
        cur.answer.push(b);
      }
    }
    if (cur) pairs.push(cur);
    return pairs;
  };

  const renderFaqToc = (block: any) => {
    const pairs = collectFaqPairs();
    if (pairs.length === 0) return;
    ensureRoom(60);
    const titleText = String(block?.title || "Оглавление вопросов");
    page.drawText(titleText, { x: marginX, y: y - 22, size: 22, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 28, width: 48, height: 3, color: brandColor });
    y -= 44;
    const size = 11;
    for (let i = 0; i < pairs.length; i++) {
      const label = `${i + 1}. ${pairs[i].q}`;
      const lines = wrapText(label, regular, size, contentW - 14);
      ensureRoom(lines.length * size * 1.5 + 4);
      for (let li = 0; li < lines.length; li++) {
        page.drawText(lines[li], { x: marginX + (li === 0 ? 0 : 14), y: y - size, size, font: regular, color: ink });
        y -= size * 1.5;
      }
      y -= 2;
    }
    newPage();
  };

  const renderFaqSections = (_block: any) => {
    const pairs = collectFaqPairs();
    if (pairs.length === 0) return;
    ensureRoom(40);
    page.drawText("Вопросы и ответы", { x: marginX, y: y - 20, size: 20, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 26, width: 40, height: 2, color: brandColor });
    y -= 40;
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      const qLines = wrapText(p.q, bold, 13, contentW - 30);
      const firstAnsText = (p.answer.find((b) => b.kind === "p")?.text || "").slice(0, 200);
      const firstAnsLines = wrapText(firstAnsText, regular, bodySize, contentW).slice(0, 2);
      const need = qLines.length * 16 + firstAnsLines.length * bodySize * 1.5 + 20;
      if (y - need < marginBottom + 40) newPage();
      page.drawRectangle({ x: marginX, y: y - 16, width: 16, height: 16, color: brandColor });
      page.drawText("?", { x: marginX + 5, y: y - 12, size: 11, font: bold, color: white });
      for (let li = 0; li < qLines.length; li++) {
        page.drawText(qLines[li], { x: marginX + 22, y: y - 13, size: 13, font: bold, color: brandDark });
        y -= 16;
      }
      y -= 6;
      for (const ab of p.answer) {
        if (ab.kind === "p") {
          drawRich(ab.text, { size: bodySize, leading: bodySize * 1.55 });
          y -= 4;
        } else if (ab.kind === "li") {
          page.drawText("•", { x: marginX + 4, y: y - bodySize, size: bodySize, font: bold, color: brandColor });
          drawRich(ab.text, { size: bodySize, leading: bodySize * 1.5, indent: 16 });
        } else if (ab.kind === "blank") {
          y -= 4;
        }
      }
      y -= 12;
      if (i < pairs.length - 1) {
        page.drawRectangle({ x: marginX, y: y, width: contentW, height: 0.4, color: muted });
        y -= 10;
      }
    }
  };

  const renderFinalHelpBox = (block: any) => {
    const title = String(block?.title || "Не нашли ответа?");
    const body = extractSectionBodyBlocks(title);
    if (!body) return;
    const paras = body.filter((b) => b.kind === "p").map((b) => b.text);
    const text = paras.join(" ").trim();
    if (!text) return;
    const lines = wrapText(text, regular, 12, contentW - 32);
    const contactLines = [client.contact_email, client.contact_phone, domain].filter(Boolean);
    const boxH = 44 + lines.length * 18 + contactLines.length * 14 + 16;
    ensureRoom(boxH + 20);
    const boxY = y - boxH;
    page.drawRectangle({ x: marginX, y: boxY, width: contentW, height: boxH, color: brandLight });
    page.drawRectangle({ x: marginX, y: boxY, width: 3, height: boxH, color: brandColor });
    page.drawText(title, { x: marginX + 16, y: y - 20, size: 15, font: bold, color: ink });
    y -= 32;
    for (const ln of lines) {
      page.drawText(ln, { x: marginX + 16, y: y - 12, size: 12, font: regular, color: ink });
      y -= 18;
    }
    y -= 4;
    for (const c of contactLines) {
      page.drawText(String(c), { x: marginX + 16, y: y - 10, size: 10, font: bold, color: brandColor });
      y -= 14;
    }
    y = boxY - 18;
  };

  // ---------- Case ----------

  const renderSummaryHeroBox = (block: any) => {
    const src = String(block?.source_section || "Результаты");
    // Ищем метрику по H2 разделу.
    const startIdx = md.findIndex((b) => b.kind === "h2" && b.text.trim() === src);
    let sectionText = "";
    if (startIdx >= 0) {
      for (let i = startIdx + 1; i < md.length; i++) {
        if (md[i].kind === "h2") break;
        if (md[i].kind === "p" || md[i].kind === "li") sectionText += md[i].text + " ";
      }
    }
    const m = sectionText.match(/[+\-]?\d[\d.,\s]*\s*(?:%|₽|руб|раз|раза|тыс|млн|млрд|x|х)\S*/i);
    const heroText = (m ? m[0].trim() : (input.article?.meta_description || paragraphs[0] || "")).slice(0, 140);
    if (!heroText) return;
    const size = m ? 40 : 22;
    const font = bold;
    const lines = wrapText(heroText, font, size, contentW - 40);
    const boxH = lines.length * size * 1.2 + 48;
    ensureRoom(boxH + 20);
    const boxY = y - boxH;
    page.drawRectangle({ x: marginX, y: boxY, width: contentW, height: boxH, color: brandLight });
    page.drawRectangle({ x: marginX, y: boxY, width: 4, height: boxH, color: brandColor });
    y -= 28;
    for (const ln of lines) {
      const w = font.widthOfTextAtSize(ln, size);
      page.drawText(ln, { x: marginX + (contentW - w) / 2, y: y - size, size, font, color: brandDark });
      y -= size * 1.2;
    }
    y = boxY - 24;
  };

  const renderNarrativeSections = (block: any) => {
    const sections: string[] = Array.isArray(block?.sections) ? block.sections : ["Ситуация", "Задача", "Решение", "Результаты"];
    for (const sTitle of sections) {
      const body = extractSectionBodyBlocks(sTitle);
      if (!body) continue;
      ensureRoom(60);
      page.drawText(sTitle, { x: marginX, y: y - 20, size: 20, font: bold, color: brandDark });
      page.drawRectangle({ x: marginX, y: y - 26, width: 48, height: 3, color: brandColor });
      y -= 40;
      for (const b of body) {
        if (b.kind === "h3") {
          y -= 4; ensureRoom(16);
          drawRich(b.text, { size: 13, font: bold, leading: 16 });
          y -= 4;
        } else if (b.kind === "p") {
          drawRich(b.text, { size: bodySize, leading: bodySize * 1.55 });
          y -= 6;
        } else if (b.kind === "li") {
          page.drawText("•", { x: marginX + 2, y: y - bodySize, size: bodySize, font: bold, color: brandColor });
          drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: 16 });
        }
      }
      y -= 6;
      page.drawRectangle({ x: marginX, y: y, width: contentW, height: 0.5, color: muted });
      y -= 16;
    }
  };

  const renderResultsMetricsBox = (block: any) => {
    const title = String(block?.title || "Результаты");
    const body = extractSectionBodyBlocks(title);
    if (!body) return;
    const items = body.filter((b) => b.kind === "li").map((b) => b.text.trim()).filter(Boolean);
    if (items.length === 0) return;
    ensureRoom(60);
    page.drawText(`${title} в цифрах`, { x: marginX, y: y - 18, size: 18, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 24, width: 40, height: 2, color: brandColor });
    y -= 40;
    for (const it of items) {
      const lines = wrapText(it, regular, 12, contentW - 44);
      const h = Math.max(28, lines.length * 18 + 12);
      ensureRoom(h + 6);
      const cy = y - h;
      page.drawRectangle({ x: marginX, y: cy, width: contentW, height: h, color: brandLight });
      page.drawRectangle({ x: marginX, y: cy, width: 3, height: h, color: brandColor });
      page.drawText("✓", { x: marginX + 12, y: y - 14, size: 14, font: bold, color: brandColor });
      let ly = y - 14;
      for (const ln of lines) {
        page.drawText(ln, { x: marginX + 32, y: ly, size: 12, font: bold, color: brandDark });
        ly -= 18;
      }
      y = cy - 8;
    }
    y -= 8;
  };

  const renderFinalCtaSection = (block: any) => {
    const title = String(block?.title || "Хотите такой же результат?");
    const body = extractSectionBodyBlocks(title);
    ensureRoom(80);
    page.drawText(title, { x: marginX, y: y - 22, size: 22, font: bold, color: brandDark });
    page.drawRectangle({ x: marginX, y: y - 28, width: 48, height: 3, color: brandColor });
    y -= 44;
    if (body) {
      for (const b of body) {
        if (b.kind === "p") { drawRich(b.text, { size: 13, leading: 20 }); y -= 4; }
      }
    }
    y -= 10;
    const ctaText = String(block?.cta_text || "Обсудить с экспертом").slice(0, 60);
    if (!domain) return;
    const padX = 28, padY = 16;
    const ctaW = bold.widthOfTextAtSize(ctaText, 14) + padX * 2;
    const ctaH = 14 + padY * 2;
    ensureRoom(ctaH + 20);
    const ctaX = (pageW - ctaW) / 2;
    const ctaY = y - ctaH;
    page.drawRectangle({ x: ctaX, y: ctaY, width: ctaW, height: ctaH, color: brandColor });
    page.drawText(ctaText, { x: ctaX + padX, y: ctaY + padY, size: 14, font: bold, color: white });
    const link = utm(String(block?.utm_content || "cta_case"));
    if (link) annotLinks.push({ page, x: ctaX, y: ctaY, w: ctaW, h: ctaH, url: link });
    y = ctaY - 20;
  };

  // ---------- Whitepaper ----------

  const renderExecutiveSummaryBox = (block: any) => {
    const title = String(block?.title || "Executive Summary");
    const body = extractSectionBodyBlocks(title);
    if (!body) return;
    newPage();
    const paras = body.filter((b) => b.kind === "p").map((b) => b.text);
    page.drawText(title, { x: marginX, y: y - 22, size: 22, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 28, width: 48, height: 3, color: brandColor });
    y -= 46;
    let measured = 20;
    for (const p of paras) measured += wrapText(p, regular, bodySize, contentW - 32).length * bodySize * 1.55 + 6;
    measured += 12;
    const boxH = Math.min(measured, pageH - marginTop - marginBottom - 60);
    const boxY = y - boxH;
    page.drawRectangle({ x: marginX, y: boxY, width: contentW, height: boxH, color: brandLight });
    page.drawRectangle({ x: marginX, y: boxY, width: 4, height: boxH, color: brandColor });
    y -= 16;
    for (const p of paras) {
      drawRich(p, { size: bodySize, leading: bodySize * 1.55, indent: 16 });
      y -= 6;
    }
    y = boxY - 20;
  };

  const renderResearchChapters = (block: any) => {
    const chapterPrefix = String(block?.chapter_prefix || "Глава {n}");
    const h2Size = Number(block?.h2_font_size || 22);
    const h3Size = Number(block?.h3_font_size || 14);
    const skip = new Set(["Executive Summary", "Ключевые выводы", "Рекомендации", "Практические выводы", "Что дальше"]);
    let n = 0;
    // Равномерное распределение тематических фото между главами (кроме первой).
    const renderableCount = chaptersAll.filter((c) => !skip.has(c.title)).length;
    const stride = chapterImgs.length > 0 && renderableCount > 0
      ? Math.max(1, Math.floor(renderableCount / (chapterImgs.length + 1)))
      : 0;
    let imgIdx = 0;
    for (const ch of chaptersAll) {
      if (skip.has(ch.title)) continue;
      n++;
      newPage();
      if (stride > 0 && imgIdx < chapterImgs.length && n > 1 && (n - 1) % stride === 0) {
        drawChapterImage(chapterImgs[imgIdx]);
        imgIdx++;
      }
      page.drawText(chapterPrefix.replace("{n}", String(n)),
        { x: marginX, y: y - 12, size: 11, font: bold, color: brandColor });
      y -= 22;
      for (const ln of wrapText(ch.title, bold, h2Size, contentW)) {
        page.drawText(ln, { x: marginX, y: y - h2Size, size: h2Size, font: bold, color: ink });
        y -= h2Size * 1.2;
      }
      page.drawRectangle({ x: marginX, y: y, width: 48, height: 3, color: brandColor });
      y -= 20;
      for (const b of ch.blocks) {
        if (b.kind === "h3") {
          y -= 4; ensureRoom(h3Size * 1.4);
          for (const ln of wrapText(b.text, bold, h3Size, contentW)) {
            page.drawText(ln, { x: marginX, y: y - h3Size, size: h3Size, font: bold, color: brandDark });
            y -= h3Size * 1.25;
          }
          y -= 4;
        } else if (b.kind === "p") {
          drawRich(b.text, { size: bodySize, leading: bodySize * 1.6 });
          y -= 6;
        } else if (b.kind === "li") {
          page.drawText("•", { x: marginX + 2, y: y - bodySize, size: bodySize, font: bold, color: brandColor });
          drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: 16 });
        } else if (b.kind === "table" && b.rows) {
          renderInlineTable(b.rows);
        }
      }
    }
    // Хвост нераспределённых фото — в конце раздела.
    while (imgIdx < chapterImgs.length) {
      drawChapterImage(chapterImgs[imgIdx]);
      imgIdx++;
    }
  };

  const renderKeyFindingsList = (block: any) => {
    const title = String(block?.title || "Ключевые выводы");
    const body = extractSectionBodyBlocks(title);
    const items = (body || []).filter((b) => b.kind === "li").map((b) => b.text);
    try {
      console.log(`[PDF-RENDER] block=key_findings_list title="${title}" contentBlocks=${body?.length ?? 0} bulletCount=${items.length}`);
    } catch { /* noop */ }
    newPage();
    page.drawText(title, { x: marginX, y: y - 24, size: 24, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 30, width: 48, height: 3, color: brandColor });
    y -= 48;
    if (!body || items.length === 0) {
      ensureRoom(40);
      page.drawText("[Раздел не заполнен — требуется перегенерация]", {
        x: marginX, y: y - bodySize, size: bodySize, font: bold, color: brandColor,
      });
      y -= bodySize * 2;
      return;
    }
    for (const it of items) {
      ensureRoom(bodySize * 2);
      const cy = y - bodySize + 2;
      page.drawRectangle({ x: marginX, y: cy - 2, width: 16, height: 16, color: brandColor });
      page.drawText("✓", { x: marginX + 4, y: cy + 1, size: 11, font: bold, color: white });
      drawRich(it, { size: bodySize + 1, leading: (bodySize + 1) * 1.5, indent: 26 });
      y -= 8;
    }
  };

  const renderRecommendationsBox = (block: any) => {
    const title = String(block?.title || "Рекомендации");
    const body = extractSectionBodyBlocks(title);
    const items = (body || []).filter((b) => b.kind === "li").map((b) => b.text);
    try {
      console.log(`[PDF-RENDER] block=recommendations_box title="${title}" contentBlocks=${body?.length ?? 0} bulletCount=${items.length}`);
    } catch { /* noop */ }
    newPage();
    page.drawText(title, { x: marginX, y: y - 24, size: 24, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 30, width: 48, height: 3, color: brandColor });
    y -= 48;
    if (!body || items.length === 0) {
      ensureRoom(40);
      page.drawText("[Раздел не заполнен — требуется перегенерация]", {
        x: marginX, y: y - bodySize, size: bodySize, font: bold, color: brandColor,
      });
      y -= bodySize * 2;
      return;
    }
    let n = 0;
    for (const it of items) {
      n++;
      const lines = wrapText(it, regular, bodySize + 1, contentW - 48);
      const h = Math.max(36, lines.length * (bodySize + 1) * 1.5 + 16);
      ensureRoom(h + 6);
      const cy = y - h;
      page.drawRectangle({ x: marginX, y: cy, width: contentW, height: h, color: brandLight });
      page.drawRectangle({ x: marginX, y: cy, width: 3, height: h, color: brandColor });
      const num = String(n).padStart(2, "0");
      page.drawText(num, { x: marginX + 12, y: y - 20, size: 18, font: bold, color: brandColor });
      let ly = y - 16;
      for (const ln of lines) {
        page.drawText(ln, { x: marginX + 42, y: ly, size: bodySize + 1, font: regular, color: ink });
        ly -= (bodySize + 1) * 1.5;
      }
      y = cy - 10;
    }
  };

  // ---------- Catalog ----------

  const renderCatalogToc = (block: any) => {
    const title = String(block?.title || "Оглавление категорий");
    const body = extractSectionBodyBlocks(title);
    const items: string[] = body
      ? body.filter((b) => b.kind === "li").map((b) => b.text.trim())
      : chaptersAll.filter((c) => /^категория/i.test(c.title)).map((c) => c.title);
    if (items.length === 0) return;
    ensureRoom(60);
    page.drawText(title, { x: marginX, y: y - 24, size: 24, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 30, width: 48, height: 3, color: brandColor });
    y -= 50;
    const size = 12;
    for (let i = 0; i < items.length; i++) {
      const label = `${i + 1}. ${items[i]}`;
      const labelW = regular.widthOfTextAtSize(label, size);
      ensureRoom(size * 2);
      page.drawText(label, { x: marginX, y: y - size, size, font: regular, color: ink });
      const dotsStart = marginX + Math.min(labelW + 8, contentW - 20);
      const dotsEnd = marginX + contentW - 12;
      let dx = dotsStart;
      while (dx < dotsEnd) {
        page.drawText(".", { x: dx, y: y - size, size, font: regular, color: muted });
        dx += 4;
      }
      y -= size * 1.9;
    }
    newPage();
  };

  const renderCategoryHeaders = (block: any) => {
    const pattern = new RegExp(String(block?.category_pattern || "^Категория"), "i");
    const startNew = block?.start_new_page !== false;
    const categories = chaptersAll.filter((c) => pattern.test(c.title));
    if (categories.length === 0) return;
    let cn = 0;
    for (const ch of categories) {
      cn++;
      if (startNew) newPage();
      page.drawRectangle({ x: 0, y: pageH - marginTop + 4, width: pageW, height: 4, color: brandColor });
      const badgeSize = 32;
      page.drawRectangle({ x: marginX, y: y - badgeSize, width: badgeSize, height: badgeSize, color: brandColor });
      const numTxt = String(cn).padStart(2, "0");
      const nw = bold.widthOfTextAtSize(numTxt, 16);
      page.drawText(numTxt, { x: marginX + (badgeSize - nw) / 2, y: y - badgeSize + 10, size: 16, font: bold, color: white });
      const h2Size = 22;
      for (const ln of wrapText(ch.title, bold, h2Size, contentW - badgeSize - 14)) {
        page.drawText(ln, { x: marginX + badgeSize + 14, y: y - h2Size, size: h2Size, font: bold, color: ink });
        y -= h2Size * 1.2;
      }
      y -= 16;
      let itemN = 0;
      for (const b of ch.blocks) {
        if (b.kind === "h3") {
          itemN++;
          y -= 6; ensureRoom(30);
          const size = 14;
          drawRich(b.text, { size, font: bold, leading: size * 1.3 });
          page.drawRectangle({ x: marginX, y: y + 2, width: 24, height: 1.5, color: brandColor });
          y -= 6;
        } else if (b.kind === "p" && itemN > 0) {
          drawRich(b.text, { size: bodySize, leading: bodySize * 1.55 });
          y -= 4;
        } else if (b.kind === "li" && itemN > 0) {
          page.drawText("•", { x: marginX + 4, y: y - bodySize, size: bodySize + 1, font: bold, color: brandColor });
          drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: 18 });
        } else if (b.kind === "p" && itemN === 0) {
          drawRich(b.text, { size: bodySize, leading: bodySize * 1.55 });
          y -= 4;
        } else if (b.kind === "blank") {
          y -= 4;
        }
      }
    }
  };

  const renderSelectionGuide = (block: any) => {
    const title = String(block?.title || "Как выбрать?");
    const body = extractSectionBodyBlocks(title);
    if (!body) return;
    newPage();
    page.drawText(title, { x: marginX, y: y - 24, size: 24, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - 30, width: 48, height: 3, color: brandColor });
    y -= 48;
    const items = body.filter((b) => b.kind === "li").map((b) => b.text);
    const paras = body.filter((b) => b.kind === "p").map((b) => b.text);
    let measured = 24;
    for (const p of paras) measured += wrapText(p, regular, bodySize, contentW - 32).length * bodySize * 1.55 + 6;
    for (const it of items) measured += wrapText(it, regular, bodySize, contentW - 48).length * bodySize * 1.55 + 6;
    const boxH = Math.min(measured + 20, pageH - marginTop - marginBottom - 40);
    const boxY = y - boxH;
    page.drawRectangle({ x: marginX, y: boxY, width: contentW, height: boxH, color: brandLight });
    page.drawRectangle({ x: marginX, y: boxY, width: 4, height: boxH, color: brandColor });
    y -= 16;
    for (const p of paras) { drawRich(p, { size: bodySize, leading: bodySize * 1.55, indent: 16 }); y -= 4; }
    let n = 0;
    for (const it of items) {
      n++;
      const numTxt = `${n}.`;
      page.drawText(numTxt, { x: marginX + 16, y: y - bodySize, size: bodySize + 1, font: bold, color: brandColor });
      drawRich(it, { size: bodySize, leading: bodySize * 1.55, indent: 34 });
      y -= 4;
    }
    y = boxY - 20;
  };

  // ---- Реестр блоков ----
  const renderers: Record<string, (block: any) => void | Promise<void>> = {
    cover: renderCover,
    cover_expert: renderCoverExpert,
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
    audience_box: renderAudienceBox,
    checklist_sections: renderChecklistSections,
    comparison_table: renderComparisonTable,
    mistakes_list: renderMistakesList,
    faq_section: renderFaqSection,
    final_checklist: renderFinalChecklist,
    qr_code: renderQrBlock,
    source_block: renderSourceBlock,
    // FAQ-специфичные
    faq_toc: renderFaqToc,
    faq_sections: renderFaqSections,
    final_help_box: renderFinalHelpBox,
    // Case-специфичные
    summary_hero_box: renderSummaryHeroBox,
    narrative_sections: renderNarrativeSections,
    results_metrics_box: renderResultsMetricsBox,
    final_cta_section: renderFinalCtaSection,
    // Whitepaper-специфичные
    executive_summary_box: renderExecutiveSummaryBox,
    research_chapters: renderResearchChapters,
    key_findings_list: renderKeyFindingsList,
    recommendations_box: renderRecommendationsBox,
    // Catalog-специфичные
    catalog_toc: renderCatalogToc,
    category_headers: renderCategoryHeaders,
    catalog_items: () => {}, // рендерится внутри category_headers
    selection_guide: renderSelectionGuide,
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