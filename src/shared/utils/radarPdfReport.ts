import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface RadarReportData {
  brandName: string;
  domain: string;
  date: string;
  overallVisibility: number;
  somData: { label: string; value: number; status: string }[];
  radarChartData: { axis: string; value: number }[];
  sentimentDonut: { name: string; pct: number }[];
  sovDonut: { name: string; pct: number }[];
  competitorLeaderboard: { name: string; visibility: number; sentiment: string; isBrand: boolean }[];
  keywordSummary: { keyword: string; mainStatus: string; models: { model: string; status: string }[] }[];
}

interface SourcesReportData {
  sources: { domain: string; type: string; typeLabel: string; occurrenceCount: number }[];
  pieData: { name: string; value: number }[];
  totalSources: number;
  totalOccurrences: number;
}

const BRAND_COLOR: [number, number, number] = [124, 58, 237];
const DARK_BG: [number, number, number] = [15, 15, 20];
const CARD_BG: [number, number, number] = [25, 25, 35];
const TEXT_WHITE: [number, number, number] = [240, 240, 245];
const TEXT_MUTED: [number, number, number] = [150, 150, 165];
const GREEN: [number, number, number] = [34, 197, 94];
const YELLOW: [number, number, number] = [234, 179, 8];
const RED: [number, number, number] = [239, 68, 68];

function getTrafficLightColor(value: number): [number, number, number] {
  if (value >= 70) return GREEN;
  if (value >= 30) return YELLOW;
  return RED;
}

function addHeader(doc: jsPDF, brandName: string, domain: string, date: string) {
  // Dark header bar
  doc.setFillColor(...DARK_BG);
  doc.rect(0, 0, 210, 40, "F");

  // Accent line
  doc.setFillColor(...BRAND_COLOR);
  doc.rect(0, 40, 210, 1.5, "F");

  doc.setTextColor(...TEXT_WHITE);
  doc.setFontSize(18);
  doc.text("GEO Radar Report", 15, 18);

  doc.setFontSize(10);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(`${brandName} - ${domain}`, 15, 27);
  doc.text(date, 15, 34);

  doc.setTextColor(...TEXT_WHITE);
  doc.setFontSize(9);
  doc.text("seo-modul.pro", 195, 18, { align: "right" });
}

function addSectionTitle(doc: jsPDF, title: string, y: number): number {
  doc.setFillColor(...BRAND_COLOR);
  doc.rect(15, y, 3, 8, "F");
  doc.setTextColor(...TEXT_WHITE);
  doc.setFontSize(13);
  doc.text(title, 22, y + 6);
  return y + 14;
}

function addKpiRow(doc: jsPDF, items: { label: string; value: string; color?: [number, number, number] }[], y: number): number {
  const boxW = (180 - (items.length - 1) * 4) / items.length;
  items.forEach((item, i) => {
    const x = 15 + i * (boxW + 4);
    doc.setFillColor(...CARD_BG);
    doc.roundedRect(x, y, boxW, 22, 2, 2, "F");
    doc.setTextColor(...TEXT_MUTED);
    doc.setFontSize(8);
    doc.text(item.label, x + boxW / 2, y + 8, { align: "center" });
    doc.setTextColor(...(item.color || TEXT_WHITE));
    doc.setFontSize(14);
    doc.text(item.value, x + boxW / 2, y + 18, { align: "center" });
  });
  return y + 28;
}

function checkPageBreak(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > 280) {
    doc.addPage();
    doc.setFillColor(...DARK_BG);
    doc.rect(0, 0, 210, 297, "F");
    return 15;
  }
  return y;
}

export function generateRadarPdf(data: RadarReportData) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Full dark background
  doc.setFillColor(...DARK_BG);
  doc.rect(0, 0, 210, 297, "F");

  addHeader(doc, data.brandName, data.domain, data.date);

  let y = 50;

  // KPI row
  y = addSectionTitle(doc, "Visibility Overview", y);
  const visColor = getTrafficLightColor(data.overallVisibility);
  y = addKpiRow(doc, [
    { label: "Overall Visibility", value: `${data.overallVisibility}%`, color: visColor },
    { label: "Models Tracked", value: String(data.somData.length) },
    { label: "Keywords", value: String(data.keywordSummary.length) },
    { label: "Competitors", value: String(data.competitorLeaderboard.filter(c => !c.isBrand).length) },
  ], y);

  // SOM table
  y = checkPageBreak(doc, y, 50);
  y = addSectionTitle(doc, "Share of Model (SoM)", y);
  autoTable(doc, {
    startY: y,
    head: [["Model", "Visibility %", "Status"]],
    body: data.somData.map(d => [d.label, `${d.value}%`, d.status]),
    theme: "plain",
    styles: { textColor: TEXT_WHITE, fillColor: DARK_BG, fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: CARD_BG, textColor: BRAND_COLOR, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [20, 20, 28] },
    margin: { left: 15, right: 15 },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // Radar axes
  if (data.radarChartData.length > 0) {
    y = checkPageBreak(doc, y, 45);
    y = addSectionTitle(doc, "Visibility Dimensions", y);
    autoTable(doc, {
      startY: y,
      head: [["Dimension", "Score"]],
      body: data.radarChartData.map(d => [d.axis, `${d.value}%`]),
      theme: "plain",
      styles: { textColor: TEXT_WHITE, fillColor: DARK_BG, fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: CARD_BG, textColor: BRAND_COLOR, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [20, 20, 28] },
      margin: { left: 15, right: 15 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Sentiment
  if (data.sentimentDonut.length > 0) {
    y = checkPageBreak(doc, y, 30);
    y = addSectionTitle(doc, "Sentiment Analysis", y);
    const sentItems = data.sentimentDonut.map(s => ({
      label: s.name,
      value: `${s.pct}%`,
      color: s.name.includes("Позитив") || s.name.includes("Positive") ? GREEN : s.name.includes("Негатив") || s.name.includes("Negative") ? RED : TEXT_MUTED,
    }));
    y = addKpiRow(doc, sentItems as any, y);
  }

  // Share of Voice
  if (data.sovDonut.length > 0) {
    y = checkPageBreak(doc, y, 30);
    y = addSectionTitle(doc, "Share of Voice", y);
    const sovItems = data.sovDonut.map(s => ({
      label: s.name,
      value: `${s.pct}%`,
      color: TEXT_WHITE as [number, number, number],
    }));
    y = addKpiRow(doc, sovItems as any, y);
  }

  // Competitor leaderboard
  if (data.competitorLeaderboard.length > 0) {
    y = checkPageBreak(doc, y, 50);
    y = addSectionTitle(doc, "Competitor Leaderboard", y);
    autoTable(doc, {
      startY: y,
      head: [["#", "Brand / Domain", "Visibility %", "Sentiment"]],
      body: data.competitorLeaderboard.map((c, i) => [
        String(i + 1),
        c.isBrand ? `* ${c.name}` : c.name,
        `${c.visibility}%`,
        c.sentiment,
      ]),
      theme: "plain",
      styles: { textColor: TEXT_WHITE, fillColor: DARK_BG, fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: CARD_BG, textColor: BRAND_COLOR, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [20, 20, 28] },
      margin: { left: 15, right: 15 },
      didParseCell: (hookData: any) => {
        if (hookData.section === "body" && hookData.column.index === 1) {
          const text = hookData.cell.raw as string;
          if (text.startsWith("*")) {
            hookData.cell.styles.textColor = BRAND_COLOR;
            hookData.cell.styles.fontStyle = "bold";
          }
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(...CARD_BG);
    doc.rect(0, 287, 210, 10, "F");
    doc.setTextColor(...TEXT_MUTED);
    doc.setFontSize(7);
    doc.text(`Page ${i} of ${pageCount}`, 105, 293, { align: "center" });
    doc.text("Generated by SEO-Module - seo-modul.pro", 15, 293);
  }

  doc.save(`GEO_Radar_${data.brandName.replace(/\s+/g, "_")}_${data.date}.pdf`);
}

export function generateSourcesPdf(data: SourcesReportData, brandName: string, date: string) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  doc.setFillColor(...DARK_BG);
  doc.rect(0, 0, 210, 297, "F");

  addHeader(doc, brandName, "AI Sources Report", date);

  let y = 50;

  // KPIs
  y = addSectionTitle(doc, "Sources Overview", y);
  y = addKpiRow(doc, [
    { label: "Total Sources", value: String(data.totalSources) },
    { label: "Total Mentions", value: String(data.totalOccurrences) },
    { label: "Source Types", value: String(data.pieData.length) },
    { label: "Top Source", value: data.sources[0]?.domain || "-" },
  ], y);

  // Type distribution
  if (data.pieData.length > 0) {
    y = checkPageBreak(doc, y, 40);
    y = addSectionTitle(doc, "Distribution by Type", y);
    autoTable(doc, {
      startY: y,
      head: [["Type", "Mentions", "Share"]],
      body: data.pieData.map(d => {
        const total = data.pieData.reduce((s, x) => s + x.value, 0) || 1;
        return [d.name, String(d.value), `${Math.round((d.value / total) * 100)}%`];
      }),
      theme: "plain",
      styles: { textColor: TEXT_WHITE, fillColor: DARK_BG, fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: CARD_BG, textColor: BRAND_COLOR, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [20, 20, 28] },
      margin: { left: 15, right: 15 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Top sources table
  y = checkPageBreak(doc, y, 50);
  y = addSectionTitle(doc, "Top Sources", y);
  const topSources = data.sources.slice(0, 30);
  autoTable(doc, {
    startY: y,
    head: [["#", "Domain", "Type", "Mentions"]],
    body: topSources.map((s, i) => [String(i + 1), s.domain, s.typeLabel, String(s.occurrenceCount)]),
    theme: "plain",
    styles: { textColor: TEXT_WHITE, fillColor: DARK_BG, fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: CARD_BG, textColor: BRAND_COLOR, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [20, 20, 28] },
    margin: { left: 15, right: 15 },
  });

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(...CARD_BG);
    doc.rect(0, 287, 210, 10, "F");
    doc.setTextColor(...TEXT_MUTED);
    doc.setFontSize(7);
    doc.text(`Page ${i} of ${pageCount}`, 105, 293, { align: "center" });
    doc.text("Generated by SEO-Module - seo-modul.pro", 15, 293);
  }

  doc.save(`AI_Sources_${brandName.replace(/\s+/g, "_")}_${date}.pdf`);
}
