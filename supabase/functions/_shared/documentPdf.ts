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
  /** Фото, извлечённые RAG-экстрактором со страниц клиента. */
  sourceImages?: Array<{
    url: string; alt?: string | null; width?: number | null; height?: number | null; context?: string | null;
  }> | null;
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
  // Полупрозрачный tint бренда (~9%) для фонов боксов и обложек.
  const tintOf = (alpha: number) => rgb(
    Math.min(1, brand.r + (1 - brand.r) * (1 - alpha)),
    Math.min(1, brand.g + (1 - brand.g) * (1 - alpha)),
    Math.min(1, brand.b + (1 - brand.b) * (1 - alpha)),
  );
  const brandTint = tintOf(0.09);
  const brandTint14 = tintOf(0.14);
  const bodyInk = rgb(0.2, 0.2, 0.2);
  const dangerColor = rgb(0.78, 0.18, 0.18);
  let linkCount = 0;

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
  // ---- RAG-фото со страниц клиента ----
  const srcImages = (input.sourceImages || []).filter((i) => i && typeof i.url === "string" && /^https:\/\//i.test(i.url));
  const area = (i: any) => (Number(i.width) || 0) * (Number(i.height) || 0);
  const heroCandidate =
    srcImages.find((i) => i.context === "hero") ||
    [...srcImages.filter((i) => i.context === "product_card")].sort((a, b) => area(b) - area(a))[0] ||
    [...srcImages].sort((a, b) => area(b) - area(a))[0] ||
    null;
  const heroImg = heroCandidate ? await embedImage(pdf, heroCandidate.url) : null;
  console.log(
    `[PDF-HERO] source=${heroImg ? (heroCandidate?.context === "hero" ? "extracted_hero" : "extracted_product") : (client.logo_url ? "client_logo" : "unsplash")}` +
    ` image_url=${heroImg ? heroCandidate?.url : (client.logo_url || images[0] || "none")} source_images=${srcImages.length}`,
  );
  // Кэш встроенных RAG-картинок, чтобы не скачивать одно и то же дважды.
  const embeddedSrc = new Map<string, any>();
  const embedSourceImage = async (url: string) => {
    if (embeddedSrc.has(url)) return embeddedSrc.get(url);
    const img = await embedImage(pdf, url);
    embeddedSrc.set(url, img);
    return img;
  };
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

  // ---- Примитивы оформления ----

  /** Прямоугольник со скруглёнными углами (pdf-lib не поддерживает radius нативно). */
  const roundedRect = (
    p: any,
    x: number, yBottom: number, w: number, h: number,
    opts: { color?: any; borderColor?: any; borderWidth?: number; radius?: number } = {},
  ) => {
    const r = Math.max(0, Math.min(opts.radius ?? 8, Math.min(w, h) / 2));
    const path =
      `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} ` +
      `A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} ` +
      `V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
    p.drawSvgPath(path, {
      x, y: yBottom + h,
      color: opts.color,
      borderColor: opts.borderColor,
      borderWidth: opts.borderWidth ?? 0,
    });
  };

  /** Регистрирует кликабельную область (URI annotation) и считает статистику. */
  const addLink = (p: any, x: number, yBottom: number, w: number, h: number, url?: string | null) => {
    if (!url) return;
    annotLinks.push({ page: p, x, y: yBottom, w, h, url });
    linkCount++;
  };

  /** Рисует текст-ссылку с подчёркиванием и annotation. Возвращает ширину. */
  const drawLinkText = (
    p: any, text: string, x: number, baseline: number,
    opts: { size?: number; font?: any; color?: any; url?: string | null; underline?: boolean } = {},
  ) => {
    const size = opts.size ?? 10;
    const font = opts.font || regular;
    const color = opts.color || brandColor;
    p.drawText(text, { x, y: baseline, size, font, color });
    const w = font.widthOfTextAtSize(text, size);
    if (opts.url) {
      if (opts.underline !== false) {
        p.drawLine({ start: { x, y: baseline - 2 }, end: { x: x + w, y: baseline - 2 }, thickness: 0.5, color });
      }
      addLink(p, x - 1, baseline - 3, w + 2, size + 5, opts.url);
    }
    return w;
  };

  const wordCount = (blocks: MdBlock[]) =>
    blocks.reduce((s, b) => s + String(b.text || "").split(/\s+/).filter(Boolean).length, 0);

  const drawRich = (
    text: string,
    opts: { font?: any; size?: number; color?: any; leading?: number; indent?: number; width?: number },
  ) => {
    const size = opts.size ?? bodySize;
    const leading = opts.leading ?? size * 1.5;
    const indent = opts.indent ?? 0;
    const font = opts.font || regular;
    const color = opts.color || bodyInk;
    const maxW = (opts.width ?? contentW) - indent;
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
          linkCount++;
        }
        x += wW + (i < line.length - 1 ? spaceW : 0);
      }
      y -= leading;
      line = []; lineW = 0;
    };
    // Авто-линковка «голых» URL, email и телефонов прямо в тексте.
    for (const t of tokens) {
      if (!t.url) {
        const w = t.word.replace(/[),.;:]+$/, "");
        if (/^https?:\/\/\S+$/i.test(w)) t.url = w;
        else if (/^[\w.+-]+@[\w-]+\.[a-z]{2,}$/i.test(w)) t.url = `mailto:${w}`;
        else if (/^\+?\d[\d\s()-]{8,}$/.test(w)) t.url = `tel:${w.replace(/[^\d+]/g, "")}`;
        else if (domain && w.toLowerCase() === domain.toLowerCase()) t.url = `https://${domain}`;
      }
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
    // Брендированная «шапка» страницы: полоса, лого, название документа, разделитель.
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
    if (input.documentTypeName) {
      const label = input.documentTypeName.slice(0, 50);
      const lw = regular.widthOfTextAtSize(label, 8);
      page.drawText(label, { x: pageW - marginRight - lw, y: hy - 9, size: 8, font: regular, color: muted });
    }
    page.drawRectangle({ x: marginX, y: hy - 18, width: contentW, height: 0.4, color: brandColor });
    y = pageH - marginTop - 22;
  };

  // ---- Профессиональная обложка (приоритет 2) ----
  const renderCoverProfessional = (block: any) => {
    skipFooter.add(page);
    // Фон-tint на всю страницу + декоративная верхняя полоса.
    page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: brandTint });
    page.drawRectangle({ x: 0, y: pageH - 32, width: pageW, height: 32, color: brandColor });
    // Hero-фото: 1) RAG-фото клиента, 2) логотип на брендовом фоне, 3) сток (Unsplash).
    const coverHero = heroImg || (logoImg ? null : bannerImg);
    const useLogoHero = !heroImg && !bannerImg && !!logoImg;
    const heroBandY = 20, heroBandH = 225;
    const hasHeroBand = !!coverHero || useLogoHero;
    if (hasHeroBand) {
      page.drawRectangle({ x: 0, y: heroBandY, width: pageW, height: heroBandH, color: brandTint14 });
      const src = coverHero || logoImg;
      const maxH = useLogoHero ? heroBandH * 0.5 : heroBandH;
      const s = Math.min(pageW / src.width, maxH / src.height);
      const w = src.width * s, h = src.height * s;
      page.drawImage(src, { x: (pageW - w) / 2, y: heroBandY + (heroBandH - h) / 2, width: w, height: h });
      page.drawRectangle({ x: 0, y: heroBandY + heroBandH, width: pageW, height: 3, color: brandColor });
      console.log(`[PDF-IMAGES] cover hero_source=${heroImg ? "client_rag" : useLogoHero ? "client_logo" : "stock"}`);
    }
    // Белая «карточка» под контент, чтобы текст читался.
    const cardBottom = hasHeroBand ? heroBandY + heroBandH + 14 : 150;
    page.drawRectangle({ x: 0, y: cardBottom, width: pageW, height: pageH - 32 - cardBottom, color: white, opacity: 0.72 });

    y = pageH - 78;
    if (logoImg) {
      const h = 40;
      const w = Math.min(120, logoImg.width * (h / logoImg.height));
      page.drawImage(logoImg, { x: marginX, y: y - h, width: w, height: logoImg.height * (w / logoImg.width) });
      y -= h + 26;
    } else if (brandName) {
      page.drawText(brandName.slice(0, 40), { x: marginX, y: y - 14, size: 14, font: bold, color: ink });
      y -= 34;
    }

    // Тип документа крупным заглавным брендовым шрифтом.
    const kind = String(block?.label || input.documentTypeName || "Экспертный документ").toUpperCase();
    for (const ln of wrapText(kind, bold, 20, contentW)) {
      page.drawText(ln, { x: marginX, y: y - 20, size: 20, font: bold, color: brandColor });
      y -= 26;
    }
    y -= 10;

    // H1 (максимум 2 строки, авто-уменьшение кегля).
    let h1Size = 36;
    let h1Lines = wrapText(h1Line, bold, h1Size, contentW);
    while (h1Lines.length > 2 && h1Size > 22) { h1Size -= 2; h1Lines = wrapText(h1Line, bold, h1Size, contentW); }
    for (const ln of h1Lines.slice(0, 2)) {
      page.drawText(ln, { x: marginX, y: y - h1Size, size: h1Size, font: bold, color: ink });
      y -= h1Size * 1.18;
    }
    y -= 10;

    const subtitle = String(block?.subtitle || input.article?.meta_description || "Практическое руководство от экспертов");
    for (const ln of wrapText(subtitle, regular, 16, contentW).slice(0, 3)) {
      page.drawText(ln, { x: marginX, y: y - 16, size: 16, font: regular, color: muted });
      y -= 23;
    }

    // Разделительная линия в ~1/3 высоты страницы.
    const divY = Math.min(y - 24, pageH / 3 + 150);
    page.drawRectangle({ x: marginX, y: divY, width: contentW, height: 4.2, color: brandColor });

    // Нижний блок: фото эксперта, имя, должность, версия/дата/домен.
    let by = divY - 40;
    const photo = 66;
    let tx = marginX;
    if (expertImg) {
      page.drawImage(expertImg, { x: marginX, y: by - photo, width: photo, height: photo });
      page.drawRectangle({ x: marginX, y: by - photo, width: photo, height: 2.5, color: brandColor });
      tx = marginX + photo + 18;
    }
    let ty = by - 14;
    if (client.expert_name) {
      page.drawText(client.expert_name.slice(0, 60), { x: tx, y: ty, size: 14, font: bold, color: ink });
      ty -= 18;
    }
    if (client.expert_bio) {
      for (const ln of wrapText(client.expert_bio, regular, 11, contentW - (tx - marginX)).slice(0, 2)) {
        page.drawText(ln, { x: tx, y: ty, size: 11, font: regular, color: muted });
        ty -= 15;
      }
    }
    const metaLine = [`Версия ${version}`, dateStr, domain].filter(Boolean).join("  •  ");
    page.drawText(metaLine, { x: tx, y: ty, size: 10, font: regular, color: muted });
    if (domain) {
      const prefix = metaLine.slice(0, metaLine.length - domain.length);
      const px = tx + regular.widthOfTextAtSize(prefix, 10);
      addLink(page, px - 1, ty - 3, regular.widthOfTextAtSize(domain, 10) + 2, 14, utm("cover_domain"));
    }
    // Нижняя декоративная полоса.
    page.drawRectangle({ x: 0, y: 0, width: pageW, height: 12, color: brandColor });
    console.log(`[PDF-LINKS] block=cover_professional annotations_count=${domain ? 1 : 0}`);
    newPage();
  };

  // ---- Профессиональная задняя обложка (приоритет 8) ----
  const renderBackCoverProfessional = () => {
    newPage();
    skipFooter.add(page);
    const before = linkCount;
    page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: brandTint14 });
    page.drawRectangle({ x: 0, y: pageH - 34, width: pageW, height: 34, color: brandColor });
    let by = pageH - 150;
    if (logoImg) {
      const h = 90;
      const w = Math.min(220, logoImg.width * (h / logoImg.height));
      page.drawImage(logoImg, { x: (pageW - w) / 2, y: by - h, width: w, height: logoImg.height * (w / logoImg.width) });
      by -= h + 34;
    }
    if (brandName) {
      const size = 24;
      const w = bold.widthOfTextAtSize(brandName, size);
      page.drawText(brandName, { x: (pageW - w) / 2, y: by - size, size, font: bold, color: ink });
      by -= size + 22;
    }
    if (domain) {
      const size = 14;
      const w = regular.widthOfTextAtSize(domain, size);
      drawLinkText(page, domain, (pageW - w) / 2, by - size, { size, color: brandColor, url: utm("back_cover") });
      by -= size + 30;
    }
    // Карточка контактов эксперта.
    const hasContacts = client.expert_name || client.contact_email || client.contact_phone;
    if (hasContacts) {
      const rows = (client.expert_name ? 1 : 0) + (client.contact_email ? 1 : 0) + (client.contact_phone ? 1 : 0);
      const cardW = contentW - 60;
      const cardH = 34 + rows * 22;
      const cardX = (pageW - cardW) / 2;
      const cardY = by - cardH;
      roundedRect(page, cardX, cardY, cardW, cardH, { color: white, borderColor: brandColor, borderWidth: 0.8, radius: 9 });
      let cy = by - 24;
      if (client.expert_name) {
        const line = `${client.expert_name}${client.expert_bio ? ` — ${client.expert_bio.slice(0, 50)}` : ""}`;
        const w = bold.widthOfTextAtSize(line, 12);
        page.drawText(line, { x: cardX + Math.max(16, (cardW - w) / 2), y: cy, size: 12, font: bold, color: ink });
        cy -= 22;
      }
      if (client.contact_email) {
        const line = client.contact_email;
        const w = regular.widthOfTextAtSize(line, 11);
        drawLinkText(page, line, cardX + (cardW - w) / 2, cy, { size: 11, url: `mailto:${client.contact_email}` });
        cy -= 22;
      }
      if (client.contact_phone) {
        const digits = String(client.contact_phone).replace(/[^\d+]/g, "");
        const line = String(client.contact_phone);
        const w = regular.widthOfTextAtSize(line, 11);
        drawLinkText(page, line, cardX + (cardW - w) / 2, cy, { size: 11, url: `tel:${digits}` });
      }
      by = cardY - 30;
    }
    const cr = `© ${new Date().getFullYear()} ${brandName || "СЕО-Модуль"}`;
    const cw = regular.widthOfTextAtSize(cr, 10);
    page.drawText(cr, { x: (pageW - cw) / 2, y: 54, size: 10, font: regular, color: muted });
    page.drawRectangle({ x: 0, y: 0, width: pageW, height: 10, color: brandColor });
    console.log(`[PDF-LINKS] block=back_cover_professional annotations_count=${linkCount - before}`);
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
        page.drawText(ln, { x: marginX, y: y - h2Size, size: h2Size, font: bold, color: brandColor });
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
    const border = opts.border || brandColor;
    const bg = opts.bg || brandTint;
    const padX = 18;
    const padY = 16;
    const items = body.filter((b) => b.kind === "p" || b.kind === "li" || b.kind === "h3");
    if (items.length === 0) return;

    // Высота каждого элемента считается заранее — так блок никогда не «съедается»
    // целиком: то, что не влезло, переносится на следующую страницу.
    const itemHeight = (b: MdBlock) => {
      if (b.kind === "h3") return (bodySize + 1) * 1.6 + 4;
      const indent = b.kind === "li" ? padX + 16 : padX;
      const lines = wrapText(b.text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"), regular, bodySize, contentW - indent - padX);
      return Math.max(1, lines.length) * bodySize * 1.5 + (b.kind === "li" ? 4 : 6);
    };

    const headerH = 30;
    let idx = 0;
    let pageBreaks = 0;
    let first = true;
    while (idx < items.length) {
      const availableTop = y;
      const maxH = availableTop - marginBottom - 24;
      if (maxH < 70) { newPage(); pageBreaks++; continue; }
      // Сколько элементов помещается в текущий бокс.
      let used = (first ? headerH : 12) + padY;
      let end = idx;
      while (end < items.length) {
        const h = itemHeight(items[end]);
        if (used + h > maxH && end > idx) break;
        used += h;
        end++;
      }
      const boxH = Math.min(maxH, used + padY / 2);
      const boxY = availableTop - boxH;
      roundedRect(page, marginX, boxY, contentW, boxH, {
        color: bg, borderColor: border, borderWidth: 0.7, radius: 8.5,
      });
      y = availableTop - padY;
      if (first) {
        const label = `${opts.icon ? opts.icon + "  " : ""}${title}`;
        page.drawText(label, { x: marginX + padX, y: y - 14, size: 14, font: bold, color: border });
        y -= headerH;
      } else {
        page.drawText(`${title} (продолжение)`, { x: marginX + padX, y: y - 9, size: 9, font: regular, color: muted });
        y -= 18;
      }
      for (let i = idx; i < end; i++) {
        const b = items[i];
        if (b.kind === "h3") {
          drawRich(b.text, { size: bodySize + 1, font: bold, color: ink, leading: bodySize * 1.6, indent: padX, width: contentW - padX });
          y -= 4;
        } else if (b.kind === "li") {
          page.drawText(opts.icon && opts.icon.length <= 2 ? opts.icon : "•", {
            x: marginX + padX, y: y - bodySize, size: bodySize, font: bold, color: border,
          });
          drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: padX + 16, width: contentW - padX });
          y -= 4;
        } else {
          drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: padX, width: contentW - padX });
          y -= 6;
        }
      }
      y = Math.min(y, boxY) - 18;
      idx = end;
      first = false;
      if (idx < items.length) { newPage(); pageBreaks++; }
    }
    console.log(`[PDF-RENDER] block=${title} content_words=${wordCount(items)} page_break=${pageBreaks > 0}`);
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
    { border: brandColor, bg: brandTint, icon: "!" });
  const renderPracticalConclusions = (block: any) => renderBoxedSection(String(block?.title || "Практические выводы"),
    { border: brandColor, bg: brandTint, icon: "✓" });

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
      const centerLabel = `Стр. ${pageNo} / ${total}`;
      const yF = 30;
      p.drawRectangle({ x: marginX, y: yF + 16, width: contentW, height: 0.4, color: brandColor });
      if (left) p.drawText(left, { x: marginX, y: yF, size: 8, font: regular, color: muted });
      const cw = bold.widthOfTextAtSize(centerLabel, 9);
      p.drawText(centerLabel, { x: (pageW - cw) / 2, y: yF, size: 9, font: bold, color: brandColor });
      if (right) {
        const rw = regular.widthOfTextAtSize(right, 8);
        const rx = pageW - marginRight - rw;
        p.drawText(right, { x: rx, y: yF, size: 8, font: regular, color: brandColor });
        if (right === domain) addLink(p, rx - 1, yF - 3, rw + 2, 13, utm("footer_domain"));
      }
      p.drawRectangle({ x: 0, y: 0, width: pageW, height: 3, color: brandColor });
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
    // Баннер (Unsplash / Pexels), если поместится над карточкой автора.
    if (bannerImg) {
      const footerTop = 130 + 96; // footerBoxY + footerBoxH
      const available = y - footerTop - 20;
      if (available > 80) {
        const scale = contentW / bannerImg.width;
        const drawH = Math.min(available, Math.min(200, bannerImg.height * scale));
        page.drawImage(bannerImg, { x: marginX, y: y - drawH, width: contentW, height: drawH });
        y -= drawH + 14;
      }
    }
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
      renderBoxedSection(title, { border: brandColor, bg: brandTint, icon: "→" });
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
        page.drawText(ln, { x: marginX, y: y - h2Size, size: h2Size, font: bold, color: brandColor });
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

  // Отложенная простановка номеров страниц в оглавлении каталога
  // (двухпроходный рендеринг: первый проход рисует пункты, второй —
  // реальные номера страниц, известные только после отрисовки категорий).
  const catalogCategoryPages: number[] = [];
  const deferredDraws: Array<() => void> = [];

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
      const tocPage = page;
      const lineY = y - size;
      const idx = i;
      deferredDraws.push(() => {
        const pageNum = catalogCategoryPages[idx];
        const numTxt = pageNum ? String(pageNum) : "";
        const numW = numTxt ? bold.widthOfTextAtSize(numTxt, size) : 0;
        const dotsStart = marginX + Math.min(labelW + 8, contentW - 30);
        const dotsEnd = marginX + contentW - numW - 8;
        let dx = dotsStart;
        while (dx < dotsEnd) {
          tocPage.drawText(".", { x: dx, y: lineY, size, font: regular, color: muted });
          dx += 4;
        }
        if (numTxt) {
          tocPage.drawText(numTxt, {
            x: marginX + contentW - numW, y: lineY, size, font: bold, color: brandColor,
          });
        }
      });
      y -= size * 1.9;
    }
    console.log(`[PDF-RENDER] block=catalog_toc end_y=${Math.round(y)} page=${pages.length}`);
  };

  const renderCategoryHeaders = async (block: any) => {
    const pattern = new RegExp(String(block?.category_pattern || "^Категория"), "i");
    const startNew = block?.start_new_page !== false;
    const categories = chaptersAll.filter((c) => pattern.test(c.title));
    if (categories.length === 0) return;
    let cn = 0;
    for (const ch of categories) {
      cn++;
      // Не создаём страницу, если текущая ещё пустая — иначе между
      // оглавлением и первой категорией появляется пустой лист.
      const pageIsFresh = y >= pageH - marginTop - 1;
      if (startNew && !pageIsFresh) newPage();
      catalogCategoryPages[cn - 1] = pages.length;
      console.log(`[PDF-RENDER] block=category_headers index=${cn} start_new_page=${startNew} actual_page=${pages.length}`);
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
          // Фото товара со страницы клиента, если удалось сопоставить.
          if (srcImages.length) {
            const meta = matchSourceImage(b.text.replace(/\*\*/g, ""));
            const img = meta ? await embedSourceImage(meta.url) : null;
            console.log(`[PDF-IMAGES] catalog_item=${itemN} matched_image=${img ? meta.url : "placeholder"}`);
            if (img) {
              const w = 140;
              const h = Math.min(110, img.height * (w / img.width));
              ensureRoom(h + 10);
              page.drawImage(img, { x: marginX, y: y - h, width: w, height: h });
              y -= h + 10;
            }
          }
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

  // ---------- Ranking / Comparison / Glossary / Encyclopedia / Mistakes ----------

  const drawSectionTitle = (title: string, size = 22) => {
    ensureRoom(60);
    page.drawText(title, { x: marginX, y: y - size, size, font: bold, color: ink });
    page.drawRectangle({ x: marginX, y: y - size - 6, width: 48, height: 3, color: brandColor });
    y -= size + 24;
  };

  const drawEmptyNotice = (title: string) => {
    ensureRoom(40);
    page.drawText(`[Раздел «${title}» не заполнен — требуется перегенерация]`, {
      x: marginX, y: y - bodySize, size: bodySize, font: bold, color: brandColor,
    });
    y -= bodySize * 2.4;
  };

  // Группирует блоки раздела по H3.
  const groupByH3 = (body: MdBlock[]): { title: string; blocks: MdBlock[] }[] => {
    const out: { title: string; blocks: MdBlock[] }[] = [];
    let g: { title: string; blocks: MdBlock[] } | null = null;
    for (const b of body) {
      if (b.kind === "h3") { g = { title: b.text, blocks: [] }; out.push(g); }
      else if (g) g.blocks.push(b);
    }
    return out;
  };

  const drawProsCons = (blocks: MdBlock[]) => {
    const pros = blocks.filter((b) => /^\s*(плюсы|преимущества)\s*:/i.test(b.text)).map((b) => b.text.replace(/^\s*[^:]+:\s*/, ""));
    const cons = blocks.filter((b) => /^\s*(минусы|недостатки)\s*:/i.test(b.text)).map((b) => b.text.replace(/^\s*[^:]+:\s*/, ""));
    if (pros.length === 0 && cons.length === 0) return false;
    const colW = (contentW - 12) / 2;
    const prosLines = pros.flatMap((t) => wrapText(t, regular, bodySize - 1, colW - 20));
    const consLines = cons.flatMap((t) => wrapText(t, regular, bodySize - 1, colW - 20));
    const boxH = 26 + Math.max(prosLines.length, consLines.length) * (bodySize + 3) + 12;
    ensureRoom(boxH + 12);
    const boxY = y - boxH;
    page.drawRectangle({ x: marginX, y: boxY, width: colW, height: boxH, color: brandLight });
    page.drawRectangle({ x: marginX + colW + 12, y: boxY, width: colW, height: boxH, color: lightBg });
    page.drawText("Плюсы", { x: marginX + 12, y: y - 16, size: bodySize, font: bold, color: brandDark });
    page.drawText("Минусы", { x: marginX + colW + 24, y: y - 16, size: bodySize, font: bold, color: muted });
    let py = y - 32;
    for (const ln of prosLines) { page.drawText(ln, { x: marginX + 12, y: py, size: bodySize - 1, font: regular, color: ink }); py -= bodySize + 3; }
    let cy2 = y - 32;
    for (const ln of consLines) { page.drawText(ln, { x: marginX + colW + 24, y: cy2, size: bodySize - 1, font: regular, color: ink }); cy2 -= bodySize + 3; }
    y = boxY - 14;
    return true;
  };

  const renderCriteriaBox = (block: any) =>
    renderBoxedSection(String(block?.title || "Критерии оценки"), { border: brandColor, bg: brandTint, icon: "•" });

  // Разбирает блоки позиции на подзаголовок, тех-характеристики, текст и плюсы/минусы.
  const splitRankingItem = (blocks: MdBlock[]) => {
    const specRe = /^\s*([A-ZА-ЯЁa-zа-яё][^:]{1,28}):\s*(.{1,60})\s*$/;
    const prosConsRe = /^\s*(плюсы|преимущества|минусы|недостатки)\s*:/i;
    const specs: Array<[string, string]> = [];
    const paras: MdBlock[] = [];
    for (const b of blocks) {
      if (prosConsRe.test(b.text)) continue;
      const m = b.kind === "li" ? specRe.exec(b.text.replace(/\*\*/g, "")) : null;
      if (m) specs.push([m[1].trim(), m[2].trim()]);
      else paras.push(b);
    }
    const pick = (re: RegExp) => blocks
      .filter((b) => re.test(b.text))
      .map((b) => b.text.replace(/^\s*[^:]+:\s*/, "").trim())
      .flatMap((t) => t.split(/\s*;\s*/).filter(Boolean));
    return {
      specs,
      paras,
      pros: pick(/^\s*(плюсы|преимущества)\s*:/i),
      cons: pick(/^\s*(минусы|недостатки)\s*:/i),
    };
  };

  // Карточная вёрстка позиции рейтинга (приоритет 4).
  // --- Сопоставление позиции рейтинга с фото со страницы клиента ---
  const normToken = (s: string) => s.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "");
  const titleTokens = (title: string): string[] => {
    const out: string[] = [];
    for (const m of title.matchAll(/[A-Za-zА-Яа-я]{1,8}[\s-]?\d{2,4}\s?[A-Za-zА-Яа-я]?|\b\d{3,4}\b/g)) {
      const t = normToken(m[0]);
      if (t.length >= 3) out.push(t);
    }
    return [...new Set(out)];
  };
  // Уже использованные фото, чтобы разные позиции не получали одну картинку.
  const usedSrcImages = new Set<string>();
  const matchSourceImage = (title: string) => {
    const tokens = titleTokens(title);
    if (!tokens.length || !srcImages.length) return null;
    let best: { img: any; score: number } | null = null;
    for (const img of srcImages) {
      const hay = normToken(String(img.alt || "")) + " " + normToken(String(img.url));
      let score = 0;
      for (const tok of tokens) {
        if (hay.includes(tok)) score += tok.length; // длинный токен = точнее совпадение
      }
      if (score === 0) continue;
      if (usedSrcImages.has(img.url)) score -= 1000; // берём только если нет свободных
      if (!best || score > best.score) best = { img, score };
    }
    if (!best || best.score <= 0) return null;
    usedSrcImages.add(best.img.url);
    return best.img;
  };
  const rankingWithImages =
    cfg.ranking_style === "with_images" || (srcImages.length > 0 && cfg.ranking_style !== "text");

  const renderRankingCard = async (block: any) => {
    const section = String(block?.section || "Топ-10");
    const body = extractSectionBodyBlocks(section);
    newPage();
    drawSectionTitle(section, 24);
    const groups = body ? groupByH3(body) : [];
    if (groups.length === 0) { drawEmptyNotice(section); return; }
    let imgIdx = 0;
    const imgEvery = chapterImgs.length > 0 ? Math.max(2, Math.ceil(groups.length / chapterImgs.length)) : 0;
    let n = 0;
    const pad = 16;
    const innerW = contentW - pad * 2;
    for (const g of groups) {
      n++;
      const { specs, paras, pros, cons } = splitRankingItem(g.blocks);
      const clean = g.title.replace(/^\d+[.)]\s*/, "").replace(/\*\*/g, "");
      // Фото позиции (RAG со страницы клиента).
      let posImg: any = null;
      let posMeta: any = null;
      if (rankingWithImages) {
        posMeta = matchSourceImage(clean);
        if (posMeta) posImg = await embedSourceImage(posMeta.url);
        console.log(`[PDF-IMAGES] ranking_card position=${n} matched_image=${posImg ? posMeta.url : "placeholder"} alt="${posMeta?.alt || ""}"`);
      }
      const thumbW = posImg ? 150 : 0;
      const thumbH = posImg ? Math.min(120, posImg.height * (thumbW / posImg.width)) : 0;
      const headTextW = innerW - 46 - (posImg ? thumbW + 14 : 0);
      const titleLines = wrapText(clean, bold, 14, headTextW);
      // --- измерение карточки ---
      let h = 18 + Math.max(34, titleLines.length * 18, thumbH) + 10;
      const paraLines: string[][] = paras.map((b) =>
        wrapText(b.text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"), regular, bodySize, innerW));
      for (const pl of paraLines) h += pl.length * bodySize * 1.5 + 5;
      const specRows = Math.ceil(specs.length / 2);
      if (specRows) h += 10 + specRows * (bodySize + 6) * 1.6 + 8;
      const colW = (innerW - 14) / 2;
      const prosLines = pros.flatMap((t) => wrapText(t, regular, bodySize - 1, colW - 14));
      const consLines = cons.flatMap((t) => wrapText(t, regular, bodySize - 1, colW - 14));
      if (prosLines.length || consLines.length) {
        h += 12 + 16 + Math.max(prosLines.length, consLines.length) * (bodySize + 3) + 10;
      }
      h += pad;
      const maxCard = pageH - marginTop - marginBottom - 20;
      const cardH = Math.min(h, maxCard);
      // Keep-together: не влезает на текущей странице — переносим карточку целиком.
      if (y - cardH < marginBottom + 20) newPage();
      const cardTop = y;
      const cardY = cardTop - cardH;
      roundedRect(page, marginX, cardY, contentW, cardH, {
        color: white, borderColor: brandColor, borderWidth: 0.6, radius: 9,
      });
      page.drawRectangle({ x: marginX, y: cardTop - 4, width: contentW, height: 4, color: brandColor });

      y = cardTop - pad - 4;
      const headTop = y;
      if (posImg) {
        // Thumbnail слева, номер и заголовок справа.
        page.drawImage(posImg, { x: marginX + pad, y: headTop - thumbH, width: thumbW, height: thumbH });
        roundedRect(page, marginX + pad, headTop - thumbH, thumbW, thumbH, {
          borderColor: brandTint14, borderWidth: 0.6, radius: 4,
        });
      }
      // Крупный номер в брендовом круге.
      const rad = 17;
      const cxc = marginX + pad + (posImg ? thumbW + 14 : 0) + rad;
      const cyc = y - rad + 4;
      page.drawCircle({ x: cxc, y: cyc, size: rad, color: brandColor });
      const numTxt = String(n).padStart(2, "0");
      const nw = bold.widthOfTextAtSize(numTxt, 15);
      page.drawText(numTxt, { x: cxc - nw / 2, y: cyc - 5, size: 15, font: bold, color: white });
      // Заголовок позиции.
      const tx = cxc + rad + 12;
      let ty = y - 12;
      for (const ln of titleLines) {
        page.drawText(ln, { x: tx, y: ty, size: 14, font: bold, color: ink });
        ty -= 18;
      }
      y = Math.min(ty, cyc - rad, posImg ? headTop - thumbH : Infinity) - 12;
      page.drawRectangle({ x: marginX + pad, y, width: innerW, height: 0.4, color: brandTint14 });
      y -= 12;

      // Обоснование позиции.
      for (const b of paras) {
        if (b.kind === "table" && b.rows) { renderInlineTable(b.rows); continue; }
        drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: pad, width: contentW - pad });
        y -= 5;
      }

      // Тех-характеристики в две колонки.
      if (specs.length) {
        y -= 4;
        const specSize = bodySize - 0.5;
        const cellW = colW - 8;
        const fitText = (txt: string, font: any, maxW: number) => {
          if (font.widthOfTextAtSize(txt, specSize) <= maxW) return txt;
          let s = txt;
          while (s.length > 1 && font.widthOfTextAtSize(s + "…", specSize) > maxW) s = s.slice(0, -1);
          return s + "…";
        };
        for (let i = 0; i < specs.length; i += 2) {
          const row = [specs[i], specs[i + 1]].filter(Boolean) as Array<[string, string]>;
          let cx = marginX + pad;
          let rowLines = 1;
          for (const [k, v] of row) {
            const label = `${k}: `;
            const lw = regular.widthOfTextAtSize(label, specSize);
            const vw = bold.widthOfTextAtSize(v, specSize);
            if (lw + vw <= cellW) {
              page.drawText(label, { x: cx, y: y - specSize, size: specSize, font: regular, color: muted });
              page.drawText(v, { x: cx + lw, y: y - specSize, size: specSize, font: bold, color: ink });
            } else if (lw <= cellW * 0.75) {
              // Значение переносим на вторую строку ячейки.
              page.drawText(fitText(label, regular, cellW), { x: cx, y: y - specSize, size: specSize, font: regular, color: muted });
              page.drawText(fitText(v, bold, cellW), { x: cx, y: y - specSize * 2 - 3, size: specSize, font: bold, color: ink });
              rowLines = 2;
            } else {
              page.drawText(fitText(label, regular, cellW * 0.5), { x: cx, y: y - specSize, size: specSize, font: regular, color: muted });
              const lw2 = regular.widthOfTextAtSize(fitText(label, regular, cellW * 0.5), specSize);
              page.drawText(fitText(v, bold, cellW - lw2), { x: cx + lw2, y: y - specSize, size: specSize, font: bold, color: ink });
            }
            cx += colW + 14;
          }
          y -= rowLines * (bodySize + 6) + (rowLines > 1 ? 1 : 0);
        }
        y -= 6;
      }

      // Плюсы / минусы.
      if (prosLines.length || consLines.length) {
        const boxH = 16 + Math.max(prosLines.length, consLines.length) * (bodySize + 3) + 12;
        const boxY = y - boxH;
        roundedRect(page, marginX + pad, boxY, colW, boxH, { color: brandTint, radius: 6 });
        roundedRect(page, marginX + pad + colW + 14, boxY, colW, boxH, { color: lightBg, radius: 6 });
        page.drawText("✓ ПЛЮСЫ", { x: marginX + pad + 10, y: y - 13, size: bodySize - 1, font: bold, color: brandColor });
        page.drawText("✗ МИНУСЫ", { x: marginX + pad + colW + 24, y: y - 13, size: bodySize - 1, font: bold, color: dangerColor });
        let py = y - 13 - (bodySize + 6);
        for (const ln of prosLines) { page.drawText(ln, { x: marginX + pad + 10, y: py, size: bodySize - 1, font: regular, color: bodyInk }); py -= bodySize + 3; }
        let cy2 = y - 13 - (bodySize + 6);
        for (const ln of consLines) { page.drawText(ln, { x: marginX + pad + colW + 24, y: cy2, size: bodySize - 1, font: regular, color: bodyInk }); cy2 -= bodySize + 3; }
        y = boxY - 10;
      }

      y = Math.min(y, cardY) - 22;
      if (imgEvery && imgIdx < chapterImgs.length && n % imgEvery === 0) {
        drawChapterImage(chapterImgs[imgIdx]); imgIdx++;
      }
    }
  };

  const renderFinalAdviceSection = (block: any) =>
    renderBoxedSection(String(block?.title || "Как выбрать из топа?"), { border: brandColor, bg: brandTint, icon: "→", startNew: true });

  const renderComparisonTableMain = (block: any) => {
    const title = String(block?.title || "Общая таблица");
    const body = extractSectionBodyBlocks(title);
    newPage();
    drawSectionTitle(title, 22);
    const tables = (body || []).filter((b) => b.kind === "table" && b.rows && b.rows.length > 1);
    const fallback = tables.length === 0 ? md.filter((b) => b.kind === "table" && b.rows && b.rows.length > 1) : tables;
    if (fallback.length === 0) { drawEmptyNotice(title); return; }
    for (const t of fallback) renderInlineTable(t.rows!);
    for (const b of (body || []).filter((x) => x.kind === "p")) {
      drawRich(b.text, { size: bodySize, leading: bodySize * 1.55 }); y -= 4;
    }
  };

  const renderAlternativeSections = (block: any) => {
    const section = String(block?.section || "Разбор альтернатив");
    const body = extractSectionBodyBlocks(section);
    newPage();
    drawSectionTitle(section, 24);
    const groups = body ? groupByH3(body) : [];
    if (groups.length === 0) { drawEmptyNotice(section); return; }
    let imgIdx = 0;
    for (const g of groups) {
      ensureRoom(80);
      const tSize = 17;
      for (const ln of wrapText(g.title, bold, tSize, contentW)) {
        page.drawText(ln, { x: marginX, y: y - tSize, size: tSize, font: bold, color: brandDark });
        y -= tSize * 1.25;
      }
      page.drawRectangle({ x: marginX, y: y + 2, width: 36, height: 2, color: brandColor });
      y -= 14;
      for (const b of g.blocks) {
        if (/^\s*(плюсы|преимущества|минусы|недостатки)\s*:/i.test(b.text)) continue;
        if (b.kind === "p") { drawRich(b.text, { size: bodySize, leading: bodySize * 1.55 }); y -= 3; }
        else if (b.kind === "li") {
          page.drawText("•", { x: marginX + 4, y: y - bodySize, size: bodySize + 1, font: bold, color: brandColor });
          drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: 18 });
        } else if (b.kind === "table" && b.rows) { renderInlineTable(b.rows); }
      }
      drawProsCons(g.blocks);
      if (imgIdx < chapterImgs.length) { drawChapterImage(chapterImgs[imgIdx]); imgIdx++; }
      y -= 10;
    }
  };

  const renderRecommendationFinal = (block: any) =>
    renderBoxedSection(String(block?.title || "Рекомендация по выбору"), { border: brandColor, bg: brandTint, icon: "✓", startNew: true });

  // Алфавитные разделы глоссария: H2 из одной буквы.
  const glossaryLetters = () =>
    chaptersAll.filter((c) => /^[A-ZА-ЯЁ]$/i.test(c.title.trim()));

  const renderGlossaryToc = (block: any) => {
    const letters = glossaryLetters();
    if (letters.length === 0) return;
    drawSectionTitle(String(block?.title || "Алфавитный указатель"), 22);
    const size = 13;
    const perRow = 10;
    let col = 0;
    const cellW = contentW / perRow;
    let rowTop = y;
    for (let i = 0; i < letters.length; i++) {
      if (col === 0) { ensureRoom(34); rowTop = y; }
      const lx = marginX + col * cellW;
      page.drawRectangle({ x: lx, y: rowTop - 26, width: cellW - 4, height: 24, color: brandLight });
      const ltr = letters[i].title.trim().toUpperCase();
      const lw = bold.widthOfTextAtSize(ltr, size);
      page.drawText(ltr, { x: lx + (cellW - 4 - lw) / 2, y: rowTop - 20, size, font: bold, color: brandDark });
      col++;
      if (col >= perRow) { col = 0; y = rowTop - 30; }
    }
    if (col !== 0) y = rowTop - 30;
    const terms = md.filter((b) => b.kind === "h3").length;
    page.drawText(`Всего терминов: ${terms}`, { x: marginX, y: y - 14, size: 10, font: regular, color: muted });
    y -= 26;
    newPage();
  };

  const renderGlossaryLetterSections = (_block: any) => {
    const letters = glossaryLetters();
    if (letters.length === 0) { drawEmptyNotice("Термины"); return; }
    for (const letter of letters) {
      ensureRoom(70);
      const ltr = letter.title.trim().toUpperCase();
      // Крупная буква в брендовой рамке-квадрате.
      const boxSide = 56;
      ensureRoom(boxSide + 24);
      roundedRect(page, marginX, y - boxSide, boxSide, boxSide, {
        color: brandTint, borderColor: brandColor, borderWidth: 1, radius: 6,
      });
      const lSize = 34;
      const lw = bold.widthOfTextAtSize(ltr, lSize);
      page.drawText(ltr, { x: marginX + (boxSide - lw) / 2, y: y - boxSide + 16, size: lSize, font: bold, color: brandColor });
      y -= boxSide + 10;
      page.drawRectangle({ x: marginX, y, width: contentW, height: 1.2, color: brandColor });
      y -= 20;
      for (const g of groupByH3(letter.blocks)) {
        ensureRoom(52);
        // Карточка термина: маркер-квадрат + название в брендовом цвете.
        page.drawRectangle({ x: marginX, y: y - bodySize - 1, width: 8, height: 8, color: brandColor });
        drawRich(g.title.replace(/\*\*/g, ""), {
          size: bodySize + 1, font: bold, color: brandColor,
          leading: (bodySize + 1) * 1.35, indent: 16,
        });
        y -= 4;
        for (const b of g.blocks) {
          if (b.kind === "p") { drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: 16 }); y -= 3; }
          else if (b.kind === "li") {
            page.drawText("•", { x: marginX + 18, y: y - bodySize, size: bodySize, font: bold, color: brandColor });
            drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: 32 });
          }
        }
        y -= 6;
        page.drawRectangle({ x: marginX, y, width: contentW, height: 0.3, color: rgb(0.93, 0.93, 0.93) });
        y -= 12;
      }
      y -= 6;
    }
  };

  const renderSeeAlsoSection = (block: any) =>
    renderBoxedSection(String(block?.title || "См. также"), { border: brandColor, bg: brandTint, icon: "→" });

  // Энциклопедия: H2-разделы, кроме служебных.
  const encyclopediaSections = (skipTitles: string[]) =>
    chaptersAll.filter((c) => !skipTitles.some((t) => c.title.trim().toLowerCase() === t.toLowerCase()));

  const renderEncyclopediaToc = (block: any) => {
    const skip = ["Дальнейшее изучение", "Ссылки на клиента", String(block?.title || "Содержание")];
    const secs = encyclopediaSections(skip);
    if (secs.length === 0) return;
    drawSectionTitle(String(block?.title || "Содержание"), 24);
    const size = 12;
    let n = 0;
    for (const s of secs) {
      n++;
      ensureRoom(size * 2.2);
      page.drawText(`${n}. ${s.title}`, { x: marginX, y: y - size, size, font: bold, color: ink });
      y -= size * 1.7;
      const subs = s.blocks.filter((b) => b.kind === "h3").slice(0, 6);
      for (const sub of subs) {
        ensureRoom(size * 1.8);
        page.drawText(`— ${sub.text}`, { x: marginX + 18, y: y - size + 1, size: size - 1, font: regular, color: muted });
        y -= (size - 1) * 1.5;
      }
      y -= 6;
    }
    newPage();
  };

  const renderEncyclopediaSections = (_block: any) => {
    const skip = ["Содержание", "Дальнейшее изучение", "Ссылки на клиента"];
    const secs = encyclopediaSections(skip);
    if (secs.length === 0) { drawEmptyNotice("Разделы"); return; }
    let imgIdx = 0;
    const imgEvery = chapterImgs.length > 0 ? Math.max(1, Math.ceil(secs.length / chapterImgs.length)) : 0;
    let n = 0;
    for (const s of secs) {
      n++;
      newPage();
      page.drawRectangle({ x: 0, y: pageH - marginTop + 4, width: pageW, height: 4, color: brandColor });
      const hSize = 21;
      page.drawText(String(n).padStart(2, "0"), { x: marginX, y: y - hSize, size: hSize, font: bold, color: brandLight });
      for (const ln of wrapText(s.title, bold, hSize, contentW - 44)) {
        page.drawText(ln, { x: marginX + 44, y: y - hSize, size: hSize, font: bold, color: ink });
        y -= hSize * 1.25;
      }
      y -= 16;
      for (const b of s.blocks) {
        if (b.kind === "h3") {
          y -= 6; ensureRoom(34);
          drawRich(b.text, { size: bodySize + 2, font: bold, leading: (bodySize + 2) * 1.35 });
          page.drawRectangle({ x: marginX, y: y + 2, width: 26, height: 1.5, color: brandColor });
          y -= 6;
        } else if (b.kind === "p") {
          if (/^\s*см\.?\s+также/i.test(b.text)) {
            ensureRoom(26);
            const boxLines = wrapText(b.text, regular, bodySize - 1, contentW - 28);
            const h = boxLines.length * (bodySize + 3) + 12;
            const by = y - h;
            page.drawRectangle({ x: marginX, y: by, width: contentW, height: h, color: lightBg });
            page.drawRectangle({ x: marginX, y: by, width: 3, height: h, color: brandColor });
            let ly = y - 12;
            for (const ln of boxLines) {
              page.drawText(ln, { x: marginX + 14, y: ly, size: bodySize - 1, font: regular, color: brandDark });
              ly -= bodySize + 3;
            }
            y = by - 12;
          } else {
            drawRich(b.text, { size: bodySize, leading: bodySize * 1.6 }); y -= 4;
          }
        } else if (b.kind === "li") {
          page.drawText("•", { x: marginX + 4, y: y - bodySize, size: bodySize + 1, font: bold, color: brandColor });
          drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: 18 });
        } else if (b.kind === "table" && b.rows) { renderInlineTable(b.rows); }
        else if (b.kind === "blank") { y -= 4; }
      }
      if (imgEvery && imgIdx < chapterImgs.length && n % imgEvery === 0) {
        drawChapterImage(chapterImgs[imgIdx]); imgIdx++;
      }
    }
  };

  const renderFurtherReadingBox = (block: any) =>
    renderBoxedSection(String(block?.title || "Дальнейшее изучение"), { border: brandColor, bg: brandTint, icon: "→", startNew: true });

  // Ошибки покупателей: H2 вида «Ошибка N: ...».
  const renderMistakeItems = (block: any) => {
    const pattern = new RegExp(String(block?.pattern || "^Ошибка\\s*\\d+"), "i");
    const items = chaptersAll.filter((c) => pattern.test(c.title.trim()));
    if (items.length === 0) { drawEmptyNotice("Ошибки"); return; }
    let imgIdx = 0;
    const imgEvery = chapterImgs.length > 0 ? Math.max(2, Math.ceil(items.length / chapterImgs.length)) : 0;
    let n = 0;
    for (const ch of items) {
      n++;
      ensureRoom(90);
      const badge = 28;
      page.drawRectangle({ x: marginX, y: y - badge, width: badge, height: badge, color: brandColor });
      const numTxt = String(n).padStart(2, "0");
      const nw = bold.widthOfTextAtSize(numTxt, 14);
      page.drawText(numTxt, { x: marginX + (badge - nw) / 2, y: y - badge + 9, size: 14, font: bold, color: white });
      const tSize = 15;
      const clean = ch.title.replace(/^Ошибка\s*\d+\s*[:.\-—]?\s*/i, "");
      for (const ln of wrapText(clean, bold, tSize, contentW - badge - 14)) {
        page.drawText(ln, { x: marginX + badge + 14, y: y - tSize - 3, size: tSize, font: bold, color: ink });
        y -= tSize * 1.25;
      }
      y -= 14;
      for (const b of ch.blocks) {
        const isFix = /^\s*как избежать\s*:/i.test(b.text);
        if (isFix) {
          const txt = b.text.replace(/^\s*как избежать\s*:\s*/i, "");
          const lines = wrapText(txt, regular, bodySize, contentW - 34);
          const h = lines.length * (bodySize * 1.5) + 30;
          ensureRoom(h + 10);
          const by = y - h;
          page.drawRectangle({ x: marginX, y: by, width: contentW, height: h, color: brandLight });
          page.drawRectangle({ x: marginX, y: by, width: 3, height: h, color: brandColor });
          page.drawText("Как избежать", { x: marginX + 16, y: y - 15, size: bodySize, font: bold, color: brandDark });
          let ly = y - 15 - bodySize * 1.6;
          for (const ln of lines) {
            page.drawText(ln, { x: marginX + 16, y: ly, size: bodySize, font: regular, color: ink });
            ly -= bodySize * 1.5;
          }
          y = by - 12;
        } else if (b.kind === "p") { drawRich(b.text, { size: bodySize, leading: bodySize * 1.55 }); y -= 3; }
        else if (b.kind === "li") {
          page.drawText("•", { x: marginX + 4, y: y - bodySize, size: bodySize + 1, font: bold, color: brandColor });
          drawRich(b.text, { size: bodySize, leading: bodySize * 1.5, indent: 18 });
        } else if (b.kind === "blank") { y -= 4; }
      }
      y -= 4;
      page.drawRectangle({ x: marginX, y, width: contentW, height: 0.4, color: muted });
      y -= 14;
      if (imgEvery && imgIdx < chapterImgs.length && n % imgEvery === 0) {
        drawChapterImage(chapterImgs[imgIdx]); imgIdx++;
      }
    }
  };

  const renderFinalChecklistBox = (block: any) => {
    const title = String(block?.title || "Итоговый чек-лист безопасной покупки");
    const body = extractSectionBodyBlocks(title);
    const items = (body || []).filter((b) => b.kind === "li").map((b) => b.text.replace(/^☐\s*/, "").trim()).filter(Boolean);
    newPage();
    drawSectionTitle(title, 22);
    if (items.length === 0) { drawEmptyNotice(title); return; }
    for (let i = 0; i < items.length; i++) {
      const lines = wrapText(items[i], regular, bodySize + 1, contentW - 32);
      const h = lines.length * (bodySize + 1) * 1.5 + 14;
      ensureRoom(h + 8);
      const by = y - h;
      page.drawRectangle({ x: marginX, y: by, width: contentW, height: h, color: i % 2 === 0 ? brandLight : lightBg });
      drawCheckbox(page, marginX + 10, y - 18, 12, brandColor);
      let ly = y - 17;
      for (const ln of lines) {
        page.drawText(ln, { x: marginX + 32, y: ly, size: bodySize + 1, font: regular, color: ink });
        ly -= (bodySize + 1) * 1.5;
      }
      y = by - 8;
    }
  };

  const renderers: Record<string, (block: any) => void | Promise<void>> = {
    // Профессиональная обложка используется по умолчанию для всех pdf-типов
    // (checklist рендерится отдельным билдером checklistPdf.ts и не затронут).
    cover: renderCoverProfessional,
    cover_professional: renderCoverProfessional,
    cover_simple: renderCover,
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
    back_cover: renderBackCoverProfessional,
    back_cover_professional: renderBackCoverProfessional,
    back_cover_dark: renderBackCover,
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
    // Ranking-специфичные
    criteria_box: renderCriteriaBox,
    criteria_list: renderCriteriaBox,
    ranking_items: renderRankingCard,
    ranking_card: renderRankingCard,
    pros_cons_box: () => {}, // рендерится внутри ranking_items / alternative_sections
    final_advice_section: renderFinalAdviceSection,
    // Comparison review
    comparison_table_main: renderComparisonTableMain,
    alternative_sections: renderAlternativeSections,
    recommendation_final: renderRecommendationFinal,
    // Glossary
    glossary_toc: renderGlossaryToc,
    glossary_letter_sections: renderGlossaryLetterSections,
    glossary_term: () => {}, // рендерится внутри glossary_letter_sections
    see_also_section: renderSeeAlsoSection,
    // Encyclopedia
    encyclopedia_toc: renderEncyclopediaToc,
    encyclopedia_sections: renderEncyclopediaSections,
    encyclopedia_subsection: () => {}, // рендерится внутри encyclopedia_sections
    cross_reference_hint: () => {}, // рендерится внутри encyclopedia_sections
    further_reading_box: renderFurtherReadingBox,
    // Mistakes
    mistake_items: renderMistakeItems,
    final_checklist_box: renderFinalChecklistBox,
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
  const keywords = Array.from(new Set([
    ...keywordsRaw.map(String),
    ...(brandName ? [brandName] : []),
    ...(meta.keyword ? [String(meta.keyword)] : []),
  ].map((k) => k.trim()).filter(Boolean)));
  const metaTitle = `${meta.title || input.title || "Документ"}${input.documentTypeName ? ` — ${input.documentTypeName}` : ""}`;
  const metaAuthor = [client.expert_name, brandName].filter(Boolean).join(", ") || "СЕО-Модуль";
  setStandardMetadata(pdf, {
    title: metaTitle,
    author: metaAuthor,
    subject: (cfg as any)?.description || meta.meta_description || firstPara,
    keywords,
    language: "ru-RU",
  });
  // PDF 1.7 — базовое требование архивных профилей (PDF/A-3b), шрифты уже встроены.
  try { (pdf as any).context?.header && ((pdf as any).context.header.minor = 7); } catch { /* noop */ }

  const bytes = await pdf.save();

  let metadataOk = true;
  try {
    const check = await PDFDocument.load(bytes, { updateMetadata: false });
    const fields = [
      check.getTitle(), check.getAuthor(), check.getSubject(), check.getKeywords(),
      check.getProducer(), check.getCreator(), check.getCreationDate(),
    ];
    metadataOk = fields.every(Boolean);
    console.log(`[PDF-METADATA] title=${check.getTitle()} author=${check.getAuthor()} keywords_count=${keywords.length} valid=${metadataOk}`);
  } catch { metadataOk = false; }
  console.log(`[PDF-LINKS] block=document annotations_count=${annotLinks.length}`);

  return { bytes, unrenderedLinks, pageCount: pages.length, metadataOk };
}