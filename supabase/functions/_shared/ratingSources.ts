// Source fetchers for the "rating" format: real companies / products / services.
// Goal: kill hallucinations. Model must only use entities returned here.
// Backends: Serper.dev (maps / shopping / organic). Manual list passes through.
import { withTimeout } from "./withTimeout.ts";

export type RatingSourceType = "services" | "products" | "saas" | "manual";

export interface RatingItem {
  name: string;
  url?: string;
  address?: string;
  phone?: string;
  rating?: number;
  reviews?: number;
  price_range?: string;
  source: "yandex_maps" | "google_maps" | "google_shopping" | "google_organic" | "manual";
  source_label: string; // e.g. "Яндекс Карты", "Google Shopping"
}

function clean(s: unknown): string {
  return String(s ?? "").replace(/ё/g, "е").replace(/Ё/g, "Е").replace(/[—–]/g, "-").trim();
}

function priceBucket(price?: number | string): string | undefined {
  if (price == null) return undefined;
  const n = typeof price === "number" ? price : Number(String(price).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n < 1000) return "до 1 000 руб";
  if (n < 5000) return "1 000-5 000 руб";
  if (n < 20000) return "5 000-20 000 руб";
  if (n < 100000) return "20 000-100 000 руб";
  return "от 100 000 руб";
}

async function serperFetch(path: string, key: string, body: Record<string, unknown>): Promise<any> {
  const res = await withTimeout(
    fetch(`https://google.serper.dev/${path}`, {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    12000,
    `serper:${path}`,
  );
  if (!res.ok) throw new Error(`serper ${path} ${res.status}`);
  return await res.json();
}

/** Local services (companies with address) via Serper Maps. */
export async function fetchMapsItems(key: string, query: string, city?: string): Promise<RatingItem[]> {
  const q = clean([query, city].filter(Boolean).join(" "));
  const j = await serperFetch("maps", key, { q, gl: "ru", hl: "ru" });
  const places = Array.isArray(j?.places) ? j.places : [];
  return places.slice(0, 15).map((p: any): RatingItem => ({
    name: clean(p?.title),
    url: p?.website || p?.cid ? (p?.website || `https://www.google.com/maps?cid=${p.cid}`) : undefined,
    address: clean(p?.address),
    phone: clean(p?.phoneNumber),
    rating: typeof p?.rating === "number" ? p.rating : undefined,
    reviews: typeof p?.ratingCount === "number" ? p.ratingCount : undefined,
    source: "google_maps",
    source_label: "Google Maps",
  })).filter((x: RatingItem) => x.name.length >= 2);
}

/** Physical goods via Serper Shopping. */
export async function fetchShoppingItems(key: string, query: string): Promise<RatingItem[]> {
  const j = await serperFetch("shopping", key, { q: clean(query), gl: "ru", hl: "ru" });
  const items = Array.isArray(j?.shopping) ? j.shopping : [];
  return items.slice(0, 15).map((p: any): RatingItem => ({
    name: clean(p?.title),
    url: clean(p?.link) || undefined,
    price_range: priceBucket(p?.price),
    rating: typeof p?.rating === "number" ? p.rating : undefined,
    reviews: typeof p?.ratingCount === "number" ? p.ratingCount : undefined,
    address: p?.source ? `Магазин: ${clean(p.source)}` : undefined,
    source: "google_shopping",
    source_label: "Google Shopping",
  })).filter((x: RatingItem) => x.name.length >= 2);
}

/** SaaS / online services via Serper organic (top sites for the query). */
export async function fetchOrganicItems(key: string, query: string): Promise<RatingItem[]> {
  const j = await serperFetch("search", key, { q: clean(query), gl: "ru", hl: "ru", num: 15 });
  const items = Array.isArray(j?.organic) ? j.organic : [];
  const seenDomains = new Set<string>();
  const out: RatingItem[] = [];
  for (const r of items) {
    let host = "";
    try { host = new URL(r?.link).hostname.replace(/^www\./, ""); } catch { continue; }
    if (!host || seenDomains.has(host)) continue;
    // Skip обвязку: marketplaces, СМИ, агрегаторы рейтингов - оставляем продукт.
    if (/wikipedia|youtube|vc\.ru|habr|dtf|tproger|pikabu/i.test(host)) continue;
    seenDomains.add(host);
    const name = clean(r?.title).split(/[|\-\u2014]/)[0].trim() || host;
    out.push({
      name,
      url: r.link,
      address: `Сайт: ${host}`,
      source: "google_organic",
      source_label: "Google Search",
    });
    if (out.length >= 12) break;
  }
  return out;
}

/** Manual list: "Name | url | price | rating" per line (only name required). */
export function parseManualList(raw: string): RatingItem[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 15)
    .map((line): RatingItem => {
      const [name, url, price, rating] = line.split("|").map((s) => clean(s));
      return {
        name,
        url: url && /^https?:\/\//i.test(url) ? url : undefined,
        price_range: price || undefined,
        rating: rating ? Number(rating) : undefined,
        source: "manual",
        source_label: "Список заказчика",
      };
    })
    .filter((x) => x.name && x.name.length >= 2);
}

/** Pin a brand to position 01 (move existing match to front, or insert synthetic). */
export function pinToFront(items: RatingItem[], pinned: string): RatingItem[] {
  if (!pinned) return items;
  const norm = pinned.toLowerCase().trim();
  const idx = items.findIndex((it) => it.name.toLowerCase().includes(norm));
  if (idx > 0) {
    const [hit] = items.splice(idx, 1);
    return [hit, ...items];
  }
  if (idx === -1) {
    return [{ name: pinned, source: "manual", source_label: "Закреплено заказчиком" }, ...items];
  }
  return items;
}

/** Render items as a strict markdown block the model can only quote, not invent. */
export function renderItemsBlock(items: RatingItem[]): string {
  const lines = items.map((it, i) => {
    const n = String(i + 1).padStart(2, "0");
    const parts = [`${n}. ${it.name}`];
    if (it.address) parts.push(`   адрес/источник: ${it.address}`);
    if (it.phone) parts.push(`   телефон: ${it.phone}`);
    if (it.rating) parts.push(`   рейтинг: ${it.rating}${it.reviews ? ` (${it.reviews} отзывов)` : ""}`);
    if (it.price_range) parts.push(`   цена: ${it.price_range}`);
    if (it.url) parts.push(`   ссылка: ${it.url}`);
    parts.push(`   источник: ${it.source_label}`);
    return parts.join("\n");
  });
  return lines.join("\n");
}

/** Attribution string for the article's "Примечание" section. */
export function attributionLine(items: RatingItem[]): string {
  const sources = Array.from(new Set(items.map((i) => i.source_label)));
  return sources.length ? `Данные о позициях: ${sources.join(", ")}. Актуально на ${new Date().getFullYear()}.` : "";
}