// Markdown → DOCX (clean parser).
// Поддержка: заголовки H1-H6, маркированные и нумерованные списки,
// таблицы (| ... |), цитаты, горизонтальные линии, абзацы,
// инлайн-форматирование: **жирный**, *курсив*, `код`, [ссылка](url).
//
// Возвращает Blob, который удобно скачать через file-saver.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  HeadingLevel,
  AlignmentType,
  LevelFormat,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
} from "docx";

type InlineNode = TextRun | ExternalHyperlink;

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

/** Инлайн-парсер: **bold**, *italic*, `code`, [text](href). Без вложенности. */
export function parseInlineRuns(text: string): InlineNode[] {
  const runs: InlineNode[] = [];
  // Регексп охватывает все варианты разом, чтобы порядок сохранялся.
  const re = /(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|`[^`\n]+?`|\[[^\]\n]+?\]\([^)\s]+?\))/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) {
      runs.push(new TextRun({ text: text.slice(lastIdx, m.index) }));
    }
    const token = m[0];
    if (token.startsWith("**")) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true }));
    } else if (token.startsWith("`")) {
      runs.push(new TextRun({ text: token.slice(1, -1), font: "Courier New" }));
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        runs.push(
          new ExternalHyperlink({
            link: linkMatch[2],
            children: [
              new TextRun({ text: linkMatch[1], style: "Hyperlink", color: "1155CC", underline: {} }),
            ],
          }),
        );
      } else {
        runs.push(new TextRun({ text: token }));
      }
    } else if (token.startsWith("*")) {
      runs.push(new TextRun({ text: token.slice(1, -1), italics: true }));
    }
    lastIdx = re.lastIndex;
  }
  if (lastIdx < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIdx) }));
  }
  if (runs.length === 0) runs.push(new TextRun({ text: "" }));
  return runs;
}

function headingLevel(level: number) {
  switch (level) {
    case 1: return HeadingLevel.HEADING_1;
    case 2: return HeadingLevel.HEADING_2;
    case 3: return HeadingLevel.HEADING_3;
    case 4: return HeadingLevel.HEADING_4;
    case 5: return HeadingLevel.HEADING_5;
    default: return HeadingLevel.HEADING_6;
  }
}

function stripImageMarkdown(s: string): string {
  return s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "[$1: $2]");
}

function buildTable(rows: string[][]): Table {
  const colCount = Math.max(...rows.map((r) => r.length));
  const contentWidth = 9360; // 6.5" в DXA
  const colWidth = Math.floor(contentWidth / colCount);
  const columnWidths = Array(colCount).fill(colWidth);

  const trs = rows.map((row, rIdx) =>
    new TableRow({
      tableHeader: rIdx === 0,
      children: Array.from({ length: colCount }, (_, cIdx) => {
        const text = row[cIdx] ?? "";
        return new TableCell({
          width: { size: colWidth, type: WidthType.DXA },
          borders: CELL_BORDERS,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          shading: rIdx === 0
            ? { fill: "F2F2F2", type: ShadingType.CLEAR, color: "auto" }
            : undefined,
          children: [
            new Paragraph({
              children: rIdx === 0
                ? [new TextRun({ text: stripImageMarkdown(text), bold: true })]
                : parseInlineRuns(stripImageMarkdown(text)),
            }),
          ],
        });
      }),
    }),
  );

  return new Table({
    width: { size: contentWidth, type: WidthType.DXA },
    columnWidths,
    rows: trs,
  });
}

/** Главный парсер: markdown → массив блоков для секции docx. */
export function markdownToDocxBlocks(md: string): (Paragraph | Table)[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: (Paragraph | Table)[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) { i++; continue; }

    // Таблица
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        const r = lines[i].trim();
        if (/^\|[\s|:\-]+\|$/.test(r)) { i++; continue; }
        rows.push(r.split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      if (rows.length > 0) blocks.push(buildTable(rows));
      continue;
    }

    // Заголовок
    const h = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const level = h[1].length;
      blocks.push(new Paragraph({
        heading: headingLevel(level),
        spacing: { before: level <= 2 ? 280 : 200, after: 120 },
        children: parseInlineRuns(stripImageMarkdown(h[2])),
      }));
      i++;
      continue;
    }

    // Горизонтальная линия
    if (/^[-*_]{3,}$/.test(trimmed)) {
      blocks.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
        children: [new TextRun({ text: "" })],
      }));
      i++;
      continue;
    }

    // Маркированный список
    if (/^[-*+]\s+/.test(trimmed)) {
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const item = lines[i].trim().replace(/^[-*+]\s+/, "");
        blocks.push(new Paragraph({
          numbering: { reference: "md-bullets", level: 0 },
          children: parseInlineRuns(stripImageMarkdown(item)),
        }));
        i++;
      }
      continue;
    }

    // Нумерованный список
    if (/^\d+\.\s+/.test(trimmed)) {
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const item = lines[i].trim().replace(/^\d+\.\s+/, "");
        blocks.push(new Paragraph({
          numbering: { reference: "md-numbers", level: 0 },
          children: parseInlineRuns(stripImageMarkdown(item)),
        }));
        i++;
      }
      continue;
    }

    // Цитата
    if (/^>\s?/.test(trimmed)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(new Paragraph({
        indent: { left: 360 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: "CCCCCC", space: 12 } },
        spacing: { before: 120, after: 120 },
        children: parseInlineRuns(stripImageMarkdown(quote.join(" "))),
      }));
      continue;
    }

    // Картинка отдельной строкой → плейсхолдер (бинарную загрузку не делаем)
    const img = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (img) {
      blocks.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: `[Изображение: ${img[1] || img[2]}]`, italics: true, color: "666666" })],
      }));
      i++;
      continue;
    }

    // Абзац: склеиваем подряд идущие непустые строки
    const para: string[] = [trimmed];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(\s*[-*+]\s+|\s*\d+\.\s+|#{1,6}\s+|\||>|!\[)/.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push(new Paragraph({
      spacing: { after: 160, line: 320 },
      children: parseInlineRuns(stripImageMarkdown(para.join(" "))),
    }));
  }

  return blocks;
}

export async function markdownToDocxBlob(
  md: string,
  title?: string,
  metaDescription?: string,
): Promise<Blob> {
  const body: (Paragraph | Table)[] = [];

  if (title) {
    body.push(new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 },
      children: [new TextRun({ text: title, bold: true, size: 36 })],
    }));
  }
  if (metaDescription) {
    body.push(new Paragraph({
      spacing: { after: 240 },
      children: [new TextRun({ text: metaDescription, italics: true, color: "555555" })],
    }));
  }

  body.push(...markdownToDocxBlocks(md));

  const doc = new Document({
    creator: "SEO-Module",
    title: title || "Article",
    description: metaDescription || "",
    styles: {
      default: {
        document: { run: { font: "Arial", size: 24 } }, // 12pt
      },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 36, bold: true, font: "Arial" },
          paragraph: { spacing: { before: 320, after: 200 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 30, bold: true, font: "Arial" },
          paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 26, bold: true, font: "Arial" },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 2 } },
        { id: "Heading4", name: "Heading 4", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 24, bold: true, font: "Arial" },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 3 } },
      ],
    },
    numbering: {
      config: [
        {
          reference: "md-bullets",
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          ],
        },
        {
          reference: "md-numbers",
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          ],
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: body,
    }],
  });

  return await Packer.toBlob(doc);
}

export function safeFilename(name: string, ext = "docx"): string {
  return `${(name || "article").replace(/[^a-zA-Zа-яА-Я0-9_-]+/g, "_").slice(0, 80)}.${ext}`;
}