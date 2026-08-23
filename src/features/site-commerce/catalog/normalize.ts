// P23 - Catalog Normalize Engine.
//
//   CSV / XLSX / XML (YML, CommerceML, OpenCart, WooCommerce)
//        -> Universal Parser (parseImport.readRows)
//        -> Field Mapping (guessMapping / user override)
//        -> Normalize Engine (this file)
//        -> site_products
//
// The engine only prepares rows: PDE, SILO and every downstream engine stay
// untouched and simply read site_products as before.

import type { RawRow, ImportFormat } from "../parseImport";
import { slugifyRu } from "../parseImport";

export type FactoryField =
  | "name" | "sku" | "price" | "stock" | "image" | "brand"
  | "category" | "description" | "external_id" | "currency" | "url" | "ignore";

export const FACTORY_FIELDS: { key: FactoryField; ru: string; en: string }[] = [
  { key: "name", ru: "Наименование", en: "Product name" },
  { key: "sku", ru: "Артикул (SKU)", en: "SKU" },
  { key: "price", ru: "Цена", en: "Price" },
  { key: "stock", ru: "Остаток", en: "Stock" },
  { key: "image", ru: "Фото", en: "Image" },
  { key: "brand", ru: "Производитель", en: "Brand" },
  { key: "category", ru: "Категория", en: "Category" },
  { key: "description", ru: "Описание", en: "Description" },
  { key: "external_id", ru: "Внешний ID", en: "External ID" },
  { key: "currency", ru: "Валюта", en: "Currency" },
  { key: "url", ru: "Ссылка", en: "Source URL" },
  { key: "ignore", ru: "Не импортировать", en: "Skip" },
];

export type Mapping = Record<string, FactoryField>;

export type SourceKind = "csv" | "xlsx" | "yml" | "commerceml" | "woocommerce" | "opencart" | "xml";

export interface NormalizedProduct {
  external_id: string | null;
  sku: string | null;
  name: string;
  price: number | null;
  currency: string;
  brand: string | null;
  availability: string;
  stock: number | null;
  description: string | null;
  characteristics: Record<string, string>;
  images: string[];
  category_hint: string | null;
  source_url: string | null;
  kind: "product" | "service";
}

export type IssueLevel = "blocker" | "warning";
export interface CatalogIssue {
  level: IssueLevel;
  code: "duplicate_sku" | "empty_name" | "invalid_category" | "missing_brand" | "no_image" | "no_price" | "no_stock";
  row: number;
  detail: string;
}

export interface NormalizeResult {
  items: NormalizedProduct[];
  issues: CatalogIssue[];
  rowsTotal: number;
  dropped: number;
  duplicates: number;
  categories: string[];
  brands: string[];
}

const DICT: Record<Exclude<FactoryField, "ignore">, string[]> = {
  name: ["name", "title", "posttitle", "название", "наименование", "товар", "модель", "product", "productname", "namerurus"],
  sku: ["sku", "артикул", "vendorcode", "код", "code", "модельартикул", "штрихкод", "модель1"],
  price: ["price", "regularprice", "цена", "стоимость", "cost", "priceru", "розничнаяцена"],
  stock: ["stock", "quantity", "остаток", "количество", "instock", "наличие", "склад", "qty"],
  image: ["picture", "image", "images", "photo", "фото", "изображение", "картинка", "imageurl", "картинкифайл"],
  brand: ["brand", "vendor", "manufacturer", "бренд", "производитель", "марка", "изготовитель"],
  category: ["category", "categories", "категория", "раздел", "section", "categoryid", "группа", "группытоваров"],
  description: ["description", "описание", "text", "текст", "postcontent", "shortdescription", "аннотация"],
  external_id: ["id", "@id", "externalid", "идентификатор", "productid", "ид"],
  currency: ["currency", "currencyid", "валюта"],
  url: ["url", "link", "ссылка", "permalink"],
};

export function normKey(k: string): string {
  return String(k || "").toLowerCase().replace(/^@/, "").replace(/[\s_\-().]+/g, "").trim();
}

/** Heuristic auto-mapping used before (or instead of) the AI suggestion. */
export function guessMapping(headers: string[]): Mapping {
  const map: Mapping = {};
  const taken = new Set<FactoryField>();
  for (const h of headers) {
    const n = normKey(h);
    let hit: FactoryField = "ignore";
    for (const [field, keys] of Object.entries(DICT) as [FactoryField, string[]][]) {
      if (keys.includes(n)) { hit = field; break; }
    }
    if (hit === "ignore") {
      for (const [field, keys] of Object.entries(DICT) as [FactoryField, string[]][]) {
        if (keys.some((k) => k.length > 4 && n.includes(k))) { hit = field; break; }
      }
    }
    // одна колонка на поле, кроме характеристик
    if (hit !== "ignore" && taken.has(hit)) hit = "ignore";
    if (hit !== "ignore") taken.add(hit);
    map[h] = hit;
  }
  return map;
}

export function detectSource(format: ImportFormat, headers: string[]): SourceKind {
  const n = headers.map(normKey);
  if (format === "xml") {
    if (n.some((h) => /^(артикул|наименование|значенияреквизитов|базоваяединица)$/.test(h))) return "commerceml";
    return n.some((h) => h === "typeprefix" || h === "vendorcode") ? "yml" : "xml";
  }
  if (n.includes("posttitle") || n.includes("regularprice")) return "woocommerce";
  if (n.includes("productid") && n.some((h) => h.startsWith("name"))) return "opencart";
  return format === "xlsx" ? "xlsx" : "csv";
}

export const SOURCE_LABEL: Record<SourceKind, string> = {
  csv: "CSV", xlsx: "XLSX", yml: "YML / XML", commerceml: "Bitrix CommerceML",
  woocommerce: "WooCommerce CSV", opencart: "OpenCart Export", xml: "XML",
};

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^\d,.\-]/g, "").replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function splitImages(v: string): string[] {
  return String(v || "")
    .split(/[|,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s) || /\.(jpe?g|png|webp|gif)$/i.test(s))
    .slice(0, 8);
}

function cleanCategory(v: string): string | null {
  const s = String(v || "").replace(/\s*[>\/|]\s*/g, " / ").trim();
  if (!s || /^\d+$/.test(s)) return null; // голый ID категории - невалидно
  return s.slice(0, 160);
}

/** Field mapping + cleanup + dedupe + QA. */
export function normalizeRows(rows: RawRow[], mapping: Mapping): NormalizeResult {
  const items: NormalizedProduct[] = [];
  const issues: CatalogIssue[] = [];
  const bySku = new Map<string, number>();
  const byName = new Set<string>();
  const categories = new Set<string>();
  const brands = new Set<string>();
  let dropped = 0, duplicates = 0;

  const cols = Object.entries(mapping);
  const get = (row: RawRow, field: FactoryField): string => {
    for (const [col, f] of cols) {
      if (f !== field) continue;
      const v = row[col];
      if (v !== null && v !== undefined && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };

  rows.forEach((row, index) => {
    const rowNo = index + 1;
    const name = get(row, "name");
    if (!name) {
      dropped++;
      issues.push({ level: "blocker", code: "empty_name", row: rowNo, detail: "Строка без наименования" });
      return;
    }
    const sku = get(row, "sku") || null;
    const key = (sku || name).toLowerCase();
    if (sku && bySku.has(sku.toLowerCase())) {
      duplicates++; dropped++;
      issues.push({ level: "blocker", code: "duplicate_sku", row: rowNo, detail: `Дубль SKU: ${sku}` });
      return;
    }
    if (!sku && byName.has(key)) { duplicates++; dropped++; return; }
    if (sku) bySku.set(sku.toLowerCase(), rowNo); else byName.add(key);

    const priceRaw = get(row, "price");
    const price = toNumber(priceRaw);
    if (priceRaw && price === null) {
      issues.push({ level: "warning", code: "no_price", row: rowNo, detail: `Битая цена: ${priceRaw}` });
    } else if (price === null) {
      issues.push({ level: "warning", code: "no_price", row: rowNo, detail: name });
    }

    const stock = toNumber(get(row, "stock"));
    const stockRaw = get(row, "stock").toLowerCase();
    if (!stockRaw) issues.push({ level: "warning", code: "no_stock", row: rowNo, detail: name });

    const brand = get(row, "brand") || null;
    if (!brand) issues.push({ level: "warning", code: "missing_brand", row: rowNo, detail: name });
    else brands.add(brand);

    const images = splitImages(get(row, "image"));
    if (!images.length) issues.push({ level: "warning", code: "no_image", row: rowNo, detail: name });

    const rawCategory = get(row, "category");
    const category = cleanCategory(rawCategory);
    if (rawCategory && !category) {
      issues.push({ level: "blocker", code: "invalid_category", row: rowNo, detail: `Категория не распознана: ${rawCategory}` });
    }
    if (category) categories.add(category);

    const characteristics: Record<string, string> = {};
    for (const [col, f] of cols) {
      if (f !== "ignore") continue;
      const val = String(row[col] ?? "").trim();
      if (!val || val.length > 200) continue;
      characteristics[col.replace(/^@/, "").slice(0, 60)] = val;
    }
    if (stock !== null) characteristics["Остаток"] = String(stock);

    const outOfStock = stock !== null
      ? stock <= 0
      : ["false", "0", "нет", "под заказ"].includes(stockRaw);

    items.push({
      external_id: get(row, "external_id") || null,
      sku,
      name: name.slice(0, 300),
      price,
      currency: (get(row, "currency") || "RUB").toUpperCase().slice(0, 6),
      brand,
      availability: outOfStock ? "out_of_stock" : "in_stock",
      stock,
      description: get(row, "description").slice(0, 4000) || null,
      characteristics,
      images,
      category_hint: category,
      source_url: get(row, "url") || null,
      kind: /услуг|service|монтаж|работы/i.test(`${category || ""} ${name}`) ? "service" : "product",
    });
  });

  return {
    items, issues, rowsTotal: rows.length, dropped, duplicates,
    categories: [...categories], brands: [...brands],
  };
}

export function toProductInsert(p: NormalizedProduct, projectId: string, position: number) {
  return {
    project_id: projectId,
    external_id: p.external_id,
    sku: p.sku,
    name: p.name,
    slug: slugifyRu(p.name) || `item-${position + 1}`,
    price: p.price,
    currency: p.currency,
    brand: p.brand,
    availability: p.availability,
    description: p.description,
    characteristics: p.characteristics,
    images: p.images,
    source_url: p.source_url,
    category_hint: p.category_hint,
    kind: p.kind,
    data_source: "import",
    position,
  };
}

export interface QaSummary {
  blockers: number;
  warnings: number;
  byCode: Record<string, number>;
}

export function summarizeIssues(issues: CatalogIssue[]): QaSummary {
  const byCode: Record<string, number> = {};
  let blockers = 0, warnings = 0;
  for (const i of issues) {
    byCode[i.code] = (byCode[i.code] || 0) + 1;
    if (i.level === "blocker") blockers++; else warnings++;
  }
  return { blockers, warnings, byCode };
}
