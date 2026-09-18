import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { ROBOTO_REGULAR, ROBOTO_BOLD } from "@/shared/utils/robotoFontData";
import type { CandidateResult, ResolvedMetric } from "./buildArchive";

export interface ReportPdfInput {
  title: string;
  clientName: string;
  date: string;
  subjectLabel: string;
  metrics: ResolvedMetric[];
  results: CandidateResult[];
  queries: string[];
}

/**
 * Human-readable companion of the machine data. It only renders numbers that the
 * scoring engine already produced - no recomputation, no rounding of its own.
 */
export function buildResearchReportPdf(input: ReportPdfInput): ArrayBuffer {
  const { title, clientName, date, subjectLabel, metrics, results, queries } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  doc.addFileToVFS("Roboto-Regular.ttf", ROBOTO_REGULAR);
  doc.addFont("Roboto-Regular.ttf", "Roboto", "normal");
  doc.addFileToVFS("Roboto-Bold.ttf", ROBOTO_BOLD);
  doc.addFont("Roboto-Bold.ttf", "Roboto", "bold");
  doc.setFont("Roboto", "normal");

  const margin = 16;
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 20;

  doc.setFont("Roboto", "bold");
  doc.setFontSize(16);
  doc.text("Отраслевое исследование и бенчмарк", margin, y);
  y += 9;

  doc.setFontSize(12);
  doc.text(doc.splitTextToSize(title, pageWidth - margin * 2), margin, y);
  y += 7 * doc.splitTextToSize(title, pageWidth - margin * 2).length;

  doc.setFont("Roboto", "normal");
  doc.setFontSize(10);
  doc.text(`Дата выпуска: ${date}`, margin, y);
  y += 5.5;
  doc.text(`Инициатор исследования: ${clientName}`, margin, y);
  y += 5.5;
  doc.text(`Объект рейтинга: ${subjectLabel}`, margin, y);
  y += 8;

  const section = (label: string, startY: number) => {
    doc.setFont("Roboto", "bold");
    doc.setFontSize(12);
    doc.text(label, margin, startY);
    doc.setFont("Roboto", "normal");
    return startY + 4;
  };

  y = section("1. Итоговый рейтинг", y);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Место", "Участник/Товар", "Итоговый балл"]],
    body: results.map((r, i) => [String(i + 1), r.name, r.confirmed_weighted_points.toFixed(2)]),
    styles: { font: "Roboto", fontSize: 9, cellPadding: 2.5 },
    headStyles: { font: "Roboto", fontStyle: "bold", fillColor: [24, 24, 27], textColor: 255 },
    columnStyles: { 0: { cellWidth: 18 }, 2: { cellWidth: 32, halign: "right" } },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index === 0) data.cell.styles.fontStyle = "bold";
    },
  });
  y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? y) + 10;

  y = section("2. Методология и критерии", y);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Метрика", "Описание", "Вес"]],
    body: metrics.map((m) => [
      m.metric + (m.penalty ? " (риск)" : ""),
      m.label,
      m.weight.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""),
    ]),
    styles: { font: "Roboto", fontSize: 8, cellPadding: 2.2, overflow: "linebreak" },
    headStyles: { font: "Roboto", fontStyle: "bold", fillColor: [24, 24, 27], textColor: 255 },
    columnStyles: { 0: { cellWidth: 45 }, 2: { cellWidth: 18, halign: "right" } },
  });
  y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? y) + 10;

  const shown = queries.slice(0, 12);
  if (shown.length) {
    if (y > 240) {
      doc.addPage();
      y = 20;
    }
    y = section("3. Целевые запросы", y) + 3;
    doc.setFontSize(9);
    for (const q of shown) {
      const lines = doc.splitTextToSize(`- ${q}`, pageWidth - margin * 2);
      if (y + lines.length * 4.6 > 272) {
        doc.addPage();
        y = 20;
      }
      doc.text(lines, margin, y);
      y += lines.length * 4.6 + 1.2;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont("Roboto", "normal");
    doc.setFontSize(7.5);
    doc.text(
      doc.splitTextToSize(
        "Отчет сгенерирован автоматически. Полные машиночитаемые данные (CSV, JSON-LD, Python скрипты) доступны в исходном архиве.",
        pageWidth - margin * 2,
      ),
      margin,
      doc.internal.pageSize.getHeight() - 12,
    );
  }

  return doc.output("arraybuffer");
}
