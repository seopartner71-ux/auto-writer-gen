// Client-side parsing of semantics / product feeds for the Site Factory.
// Supported: CSV (auto delimiter), XLSX/XLS, XML (YML / generic item lists).

import * as XLSX from "xlsx";
import { XMLParser } from "fast-xml-parser";

export type ImportKind = "keywords" | "products";
export type ImportFormat = "csv" | "xlsx" | "xml";

export interface RawRow { [key: string]: string | number | null }

export interface KeywordRow {
  keyword: string;
  frequency: number | null;
  intent: string | null;
  cluster_hint: string | null;
  category_hint: string | null;
}

export interface ProductRow {
  external_id: string | null;
  sku: string | null;
  name: string;
  price: number | null;
  currency: string | null;
  brand: string | null;
  availability: string | null;
  description: string | null;
  characteristics: Record<string, string>;
  images: string[];
  category_hint: string | null;
  source_url: string | null;
}

export interface ParseResult<T> {
  format: ImportFormat;
  rowsTotal: number;
  rowsOk: number;
  rowsDupe: number;
  rowsError: number;
  rows: T[];
  errors: string[];
  headers: string[];
}

function norm(k: string): string {
  return String(k || "").toLowerCase().replace(/[\s_-]+/g, "").trim();
}

function pick(row: RawRow, keys: string[]): string {
  for (const key of Object.keys(row)) {
    if (keys.includes(norm(key))) {
      const v = row[key];
      if (v !== null && v !== undefined && String(v).trim() !== "") return String(v).trim();
    }
  }
  return "";
}

function toNumber(v: string): number | null {
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function detectDelimiter(line: string): string {
  const counts = [";", ",", "\t", "|"].map((d) => [d, line.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ",";
}

function parseCsv(text: string): RawRow[] {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return [];
  const d = detectDelimiter(lines[0]);
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "", inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === d && !inQuotes) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = splitLine(lines[0]);
  const looksLikeHeader = headers.some((h) => /[a-zA-Zа-яА-Я]/.test(h));
  const dataLines = looksLikeHeader ? lines.slice(1) : lines;
  const cols = looksLikeHeader ? headers : headers.map((_, i) => `col${i + 1}`);
  return dataLines.map((line) => {
    const cells = splitLine(line);
    const row: RawRow = {};
    cols.forEach((c, i) => { row[c || `col${i + 1}`] = cells[i] ?? ""; });
    return row;
  });
}

function parseSheet(buf: ArrayBuffer): RawRow[] {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });
}

function parseXml(text: string): RawRow[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
  const doc = parser.parse(text);
  const found: any[] = [];
  const walk = (node: any, depth: number) => {
    if (!node || typeof node !== "object" || depth > 8) return;
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value) && value.length && typeof value[0] === "object") {
        if (/offer|item|product|goods|entry|row/i.test(key)) found.push(...value);
        else value.forEach((v) => walk(v, depth + 1));
      } else if (value && typeof value === "object") {
        walk(value, depth + 1);
      }
    }
  };
  walk(doc, 0);
  return found.map((o) => {
    const row: RawRow = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === null || typeof v === "object") {
        if (Array.isArray(v)) row[k] = v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("|");
        else if (v && typeof v === "object") row[k] = JSON.stringify(v);
        else row[k] = "";
      } else row[k] = String(v);
    }
    return row;
  });
}

export function formatOf(filename: string): ImportFormat {
  const ext = filename.toLowerCase().split(".").pop() || "";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "xml" || ext === "yml") return "xml";
  return "csv";
}

export async function readRows(file: File): Promise<{ rows: RawRow[]; format: ImportFormat }> {
  const format = formatOf(file.name);
  if (format === "xlsx") return { rows: parseSheet(await file.arrayBuffer()), format };
  const text = await file.text();
  return { rows: format === "xml" ? parseXml(text) : parseCsv(text), format };
}

const KW_KEYS = ["keyword", "keywords", "ключ", "ключевоеслово", "запрос", "фраза", "query", "phrase"];
const FREQ_KEYS = ["frequency", "freq", "volume", "частота", "частотность", "ws", "базоваячастота"];
const INTENT_KEYS = ["intent", "интент", "тип"];
const CLUSTER_KEYS = ["cluster", "кластер", "группа", "group"];
const CAT_KEYS = ["category", "категория", "раздел", "section", "categoryid"];

export function mapKeywords(rows: RawRow[], format: ImportFormat): ParseResult<KeywordRow> {
  const out: KeywordRow[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  let dupe = 0;
  for (const row of rows) {
    const keyword = pick(row, KW_KEYS) || String(Object.values(row)[0] ?? "").trim();
    if (!keyword) { errors.push("Пустой ключ"); continue; }
    const key = keyword.toLowerCase();
    if (seen.has(key)) { dupe++; continue; }
    seen.add(key);
    out.push({
      keyword: keyword.slice(0, 300),
      frequency: toNumber(pick(row, FREQ_KEYS)),
      intent: pick(row, INTENT_KEYS) || null,
      cluster_hint: pick(row, CLUSTER_KEYS) || null,
      category_hint: pick(row, CAT_KEYS) || null,
    });
  }
  return {
    format, rows: out, rowsTotal: rows.length, rowsOk: out.length,
    rowsDupe: dupe, rowsError: errors.length, errors: errors.slice(0, 20),
    headers: Object.keys(rows[0] || {}),
  };
}

const NAME_KEYS = ["name", "title", "название", "наименование", "товар", "модель"];
const SKU_KEYS = ["sku", "артикул", "vendorcode", "code", "код"];
const ID_KEYS = ["id", "@id", "externalid", "идентификатор"];
const PRICE_KEYS = ["price", "цена", "стоимость", "cost"];
const CUR_KEYS = ["currency", "currencyid", "валюта"];
const BRAND_KEYS = ["brand", "vendor", "бренд", "производитель", "марка"];
const AVAIL_KEYS = ["available", "availability", "наличие", "instock", "@available"];
const DESC_KEYS = ["description", "описание", "text", "текст"];
const IMG_KEYS = ["picture", "image", "images", "photo", "фото", "изображение", "картинка"];
const URL_KEYS = ["url", "link", "ссылка"];

const SERVICE_META = new Set([
  ...NAME_KEYS, ...SKU_KEYS, ...ID_KEYS, ...PRICE_KEYS, ...CUR_KEYS, ...BRAND_KEYS,
  ...AVAIL_KEYS, ...DESC_KEYS, ...IMG_KEYS, ...URL_KEYS, ...CAT_KEYS,
]);

export function mapProducts(rows: RawRow[], format: ImportFormat): ParseResult<ProductRow> {
  const out: ProductRow[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  let dupe = 0;
  for (const row of rows) {
    const name = pick(row, NAME_KEYS);
    if (!name) { errors.push("Строка без названия"); continue; }
    const sku = pick(row, SKU_KEYS) || null;
    const key = (sku || name).toLowerCase();
    if (seen.has(key)) { dupe++; continue; }
    seen.add(key);

    const characteristics: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (SERVICE_META.has(norm(k))) continue;
      const val = String(v ?? "").trim();
      if (!val || val.length > 200) continue;
      characteristics[k.replace(/^@/, "").slice(0, 60)] = val;
    }
    const availRaw = pick(row, AVAIL_KEYS).toLowerCase();
    out.push({
      external_id: pick(row, ID_KEYS) || null,
      sku,
      name: name.slice(0, 300),
      price: toNumber(pick(row, PRICE_KEYS)),
      currency: (pick(row, CUR_KEYS) || "RUB").toUpperCase().slice(0, 6),
      brand: pick(row, BRAND_KEYS) || null,
      availability: availRaw === "false" || availRaw === "0" || /нет/.test(availRaw) ? "out_of_stock" : "in_stock",
      description: pick(row, DESC_KEYS).slice(0, 4000) || null,
      characteristics,
      images: pick(row, IMG_KEYS).split("|").map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s)).slice(0, 8),
      category_hint: pick(row, CAT_KEYS) || null,
      source_url: pick(row, URL_KEYS) || null,
    });
  }
  return {
    format, rows: out, rowsTotal: rows.length, rowsOk: out.length,
    rowsDupe: dupe, rowsError: errors.length, errors: errors.slice(0, 20),
    headers: Object.keys(rows[0] || {}),
  };
}

export function slugifyRu(v: string): string {
  const map: Record<string, string> = {
    а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",
    р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
  };
  return String(v || "").toLowerCase().split("").map((c) => map[c] ?? c).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}