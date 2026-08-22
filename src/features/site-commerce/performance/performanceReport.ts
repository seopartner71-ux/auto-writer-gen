// P22 - "AI Visibility Report" PDF export. Agency-style report built from the
// read-only Performance Center payload.

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { PerfOverview, ScoreSnapshot } from "./types";

const INK = "#0A0A0A";
const ACCENT: [number, number, number] = [110, 86, 207];

const clean = (s: string) => (s || "").replace(/[—–]/g, "-").replace(/ё/g, "е");

export function buildPerformancePdf(
  o: PerfOverview,
  timeline: ScoreSnapshot[],
  ru: boolean,
): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  let y = 0;

  // ------------------------------------------------------------- cover -----
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, W, 150, "F");
  doc.setTextColor("#FFFFFF");
  doc.setFontSize(24);
  doc.text(clean(ru ? "Отчет AI Visibility" : "AI Visibility Report"), 40, 70);
  doc.setFontSize(12);
  doc.text(clean(`${o.site.name || "-"} - ${o.site.domain || o.site.production_url || "-"}`), 40, 100);
  doc.setFontSize(10);
  doc.text(new Date().toLocaleDateString(ru ? "ru-RU" : "en-US"), 40, 122);
  doc.setTextColor(INK);
  y = 185;

  const section = (title: string) => {
    if (y > 720) { doc.addPage(); y = 60; }
    doc.setFontSize(13);
    doc.setTextColor(...ACCENT);
    doc.text(clean(title), 40, y);
    doc.setTextColor(INK);
    y += 14;
  };

  const table = (head: string[], rows: (string | number)[][]) => {
    autoTable(doc, {
      startY: y,
      head: [head.map(clean)],
      body: rows.map((r) => r.map((c) => clean(String(c)))),
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: ACCENT, textColor: 255 },
      margin: { left: 40, right: 40 },
    });
    y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY || y) + 26;
  };

  section(ru ? "1. Общая оценка" : "1. Overall score");
  table(
    [ru ? "Метрика" : "Metric", ru ? "Значение" : "Value"],
    [
      ["SEO", o.scores.seo],
      ["GEO", o.scores.geo],
      [ru ? "Дизайн" : "Visual", o.scores.visual],
      [ru ? "Медиа" : "Media", o.scores.media],
      [ru ? "Коммерция" : "Commercial", o.scores.commercial],
      [ru ? "Контент" : "Content", o.scores.content],
      [ru ? "Итоговое качество" : "Overall quality", o.scores.quality],
      [ru ? "Готов к органике" : "Organic ready", o.stats.organic_ready ? "YES" : "NO"],
    ],
  );

  section(ru ? "2. GEO - разбор по факторам" : "2. GEO factor breakdown");
  table(
    [ru ? "Фактор" : "Factor", ru ? "Вес" : "Weight", ru ? "Оценка" : "Score", ru ? "Баллы" : "Points"],
    o.geo_breakdown.map((g) => [ru ? g.label_ru : g.label_en, g.weight, g.value, g.points]),
  );

  section(ru ? "3. Индексация" : "3. Indexing");
  table(
    [ru ? "Показатель" : "Metric", ru ? "URL" : "URLs"],
    [
      [ru ? "Всего" : "Total", o.index_status.total],
      [ru ? "Отправлено" : "Submitted", o.index_status.submitted],
      [ru ? "Проиндексировано" : "Indexed", o.index_status.indexed],
      [ru ? "Ожидают" : "Pending", o.index_status.pending],
    ],
  );

  section(ru ? "4. AI Visibility" : "4. AI Visibility");
  if (o.ai_visibility.length) {
    const queries = Array.from(new Set(o.ai_visibility.map((v) => v.query))).slice(0, 25);
    table(
      [ru ? "Запрос" : "Query", "ChatGPT", "Gemini", "Claude"],
      queries.map((q) => {
        const cell = (m: string) => {
          const row = o.ai_visibility.find((v) => v.query === q && v.model === m);
          if (!row || !row.mentioned) return "-";
          return row.position ? `#${row.position}${row.cited ? " *" : ""}` : "+";
        };
        return [q, cell("chatgpt"), cell("gemini"), cell("claude")];
      }),
    );
  } else {
    doc.setFontSize(10);
    doc.text(clean(ru ? "Проверка еще не запускалась." : "No check has been run yet."), 40, y);
    y += 26;
  }

  section(ru ? "5. Структура SILO" : "5. SILO structure");
  const byStatus = { PASS: 0, REVIEW: 0, FAIL: 0 };
  for (const n of o.silo_map) byStatus[n.status]++;
  table(
    [ru ? "Статус" : "Status", ru ? "Страниц" : "Pages"],
    [["PASS", byStatus.PASS], ["REVIEW", byStatus.REVIEW], ["FAIL", byStatus.FAIL]],
  );

  section(ru ? "6. Контент, коммерция и медиа" : "6. Content, commerce and media");
  table(
    [ru ? "Показатель" : "Metric", ru ? "Значение" : "Value"],
    [
      [ru ? "Страниц в реестре" : "Registry pages", o.stats.pages],
      [ru ? "Контентных страниц" : "Content pages", o.stats.content_pages],
      [ru ? "Товаров и услуг" : "Products and services", o.stats.products],
      [ru ? "Изображений" : "Images", o.stats.images],
      [ru ? "Тематических кластеров" : "Topic clusters", o.stats.clusters],
    ],
  );

  section(ru ? "7. История релизов" : "7. Release history");
  if (timeline.length) {
    table(
      [ru ? "Версия" : "Version", "SEO", "GEO", ru ? "Дизайн" : "Visual", ru ? "Медиа" : "Media", ru ? "Страниц" : "Pages", ru ? "Дата" : "Date"],
      timeline.slice(-15).map((t) => [
        t.version || "-", t.seo_score, t.geo_score, t.visual_score, t.media_score, t.pages,
        new Date(t.created_at).toLocaleDateString(ru ? "ru-RU" : "en-US"),
      ]),
    );
  } else {
    doc.setFontSize(10);
    doc.text(clean(ru ? "Снимки еще не сохранялись." : "No snapshots stored yet."), 40, y);
    y += 26;
  }

  section(ru ? "8. Рекомендации" : "8. Recommendations");
  table(
    [ru ? "Направление" : "Area", ru ? "Что улучшить" : "What to improve", ru ? "Объем" : "Volume", ru ? "Влияние" : "Impact"],
    o.opportunities.slice(0, 25).map((op) => [
      op.group.toUpperCase(), ru ? op.label_ru : op.label_en, op.count, op.impact,
    ]),
  );

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor("#888888");
    doc.text(clean(`${o.site.name || "Factory Pro"} - AI Visibility Report`), 40, 820);
    doc.text(`${i}/${pages}`, W - 60, 820);
  }
  return doc;
}
