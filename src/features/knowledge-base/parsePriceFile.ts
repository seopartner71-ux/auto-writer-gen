// Generic price-list file parser (xlsx/xls/csv). Same column template for every client.
import * as XLSX from "xlsx";
import { firstNumber, type KbPrice } from "./buildKnowledgeBase";

export interface PriceImport {
  filename: string;
  rowsRead: number;
  withPrice: number;
  dropped: number;
  photosDropped: number;
  errors: string[];
}

const SYN: Record<keyof Omit<KbPrice, "currency">, string[]> = {
  name: ["название", "наименование", "name", "продукт", "позиция", "товар"],
  priceFrom: ["цена_от", "ценаот", "цена от", "цена", "price", "cost", "стоимость"],
  unit: ["единица", "unit", "ед", "ед.", "ед. изм.", "ед.изм"],
  zone: ["зона", "region", "регион", "город"],
  useCases: ["задачи", "use", "применение"],
  pageUrl: ["страница", "url", "ссылка", "link"],
  imageUrl: ["фото", "image", "photo", "изображение"],
  category: ["категория", "category"],
  synonyms: ["синонимы", "synonyms", "синоним"],
};
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/ё/g, "е").trim();
const HINT = /только число|как на сайте|подсказка/i;

function mapHeader(row: unknown[]): Record<string, number> | null {
  const m: Record<string, number> = {};
  row.forEach((cell, i) => {
    const h = norm(cell);
    if (!h) return;
    for (const [k, list] of Object.entries(SYN)) {
      if (m[k] === undefined && list.some((s) => h === s || h.replace(/[\s_.]+/g, "") === s.replace(/[\s_.]+/g, ""))) { m[k] = i; break; }
    }
  });
  return m.name !== undefined || m.priceFrom !== undefined ? m : null;
}

export async function parsePriceFile(file: File, clientSite: string): Promise<{ prices: KbPrice[]; report: PriceImport }> {
  const report: PriceImport = { filename: file.name, rowsRead: 0, withPrice: 0, dropped: 0, photosDropped: 0, errors: [] };
  let wb: XLSX.WorkBook;
  try {
    wb = /\.csv$/i.test(file.name) ? XLSX.read(await file.text(), { type: "string" }) : XLSX.read(await file.arrayBuffer(), { type: "array" });
  } catch {
    report.errors.push("Файл прайса не прочитан");
    return { prices: [], report };
  }
  const named = wb.SheetNames.find((n) => /^(прайс|price)$/i.test(n.trim()));
  const order = named ? [named, ...wb.SheetNames.filter((n) => n !== named)] : wb.SheetNames;
  let rows: unknown[][] = [], header: Record<string, number> | null = null, hIdx = -1;
  for (const n of order) {
    const r = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, defval: "" });
    for (let i = 0; i < Math.min(5, r.length); i++) {
      const h = mapHeader(r[i]);
      if (h) { rows = r; header = h; hIdx = i; break; }
    }
    if (header) break;
  }
  if (!header) { report.errors.push("Файл прайса не прочитан: нет строки заголовков в первых 5 строках"); return { prices: [], report }; }
  if (header.name === undefined) { report.errors.push("В прайсе нет колонки названия"); return { prices: [], report }; }
  let host = "";
  try { host = new URL(clientSite).hostname.replace(/^www\./, ""); } catch { /* empty */ }
  const get = (r: unknown[], k: string) => (header![k] === undefined ? "" : String(r[header![k]] ?? "").trim());
  const prices: KbPrice[] = [];
  for (const r of rows.slice(hIdx + 1)) {
    if (!r.some((c) => String(c ?? "").trim())) continue;
    if (r.some((c) => HINT.test(String(c ?? "")))) continue;
    report.rowsRead++;
    const name = get(r, "name");
    if (!name) { report.dropped++; continue; }
    let imageUrl = get(r, "imageUrl");
    if (imageUrl) {
      let ok = false;
      try { ok = !!host && new URL(imageUrl).hostname.replace(/^www\./, "").endsWith(host); } catch { /* bad url */ }
      if (!ok) { imageUrl = ""; report.photosDropped++; }
    }
    const priceFrom = firstNumber(get(r, "priceFrom"));
    if (priceFrom) report.withPrice++;
    prices.push({ name, priceFrom, currency: "руб", unit: get(r, "unit"), zone: get(r, "zone"), category: get(r, "category"), useCases: get(r, "useCases"), pageUrl: get(r, "pageUrl"), imageUrl, synonyms: get(r, "synonyms") });
  }
  if (report.rowsRead && !report.withPrice) report.errors.push("В прайсе 0 числовых цен");
  if (report.photosDropped) report.errors.push(`Фото с чужого домена отброшены: ${report.photosDropped}`);
  return { prices, report };
}
