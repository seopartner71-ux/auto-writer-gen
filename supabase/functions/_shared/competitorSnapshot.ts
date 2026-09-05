// Competitor Monitoring — fetch + content extraction + normalization.
//
// Pipeline: FETCH -> HTML -> EXTRACTION -> NORMALIZATION -> SNAPSHOT (+hashes)
// Raw HTML is stored separately, but diffs NEVER compare raw HTML: ads,
// counters, timestamps and CDN markup would produce endless false positives.

import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

export interface Heading { level: number; text: string }
export interface FaqItem { q: string; a: string }
export interface LinkItem { href: string; text: string }
export interface ImageItem { src: string; alt: string }

export interface NormalizedSnapshot {
  url: string;
  http_status: number;
  title: string;
  description: string;
  h1: string;
  headings: Heading[];
  word_count: number;
  content: string;
  images: ImageItem[];
  internal_links: LinkItem[];
  external_links: LinkItem[];
  faq: FaqItem[];
  tables: string[];
  lists: string[];
  cta: string[];
  prices: string[];
  schema_types: string[];
  canonical: string;
  robots: string;
  content_hash: string;
  structure_hash: string;
  meta_hash: string;
  links_hash: string;
  raw_html: string;
}

export type FetchFailureKind =
  | "timeout" | "http_403" | "http_404" | "http_5xx" | "http_error"
  | "robots" | "connection" | "invalid_url" | "not_html";

export interface FetchFailure { ok: false; kind: FetchFailureKind; message: string; status?: number }
export interface FetchSuccess { ok: true; html: string; status: number; finalUrl: string }

const UA = "Mozilla/5.0 (compatible; SeoModulMonitor/1.0; +https://seo-modul.pro/bot)";
const MAX_HTML_BYTES = 3_000_000;

/** Validates a user-supplied URL: http/https only, public host. */
export function validateUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  let u: URL;
  try { u = new URL(String(raw || "").trim()); } catch { return { ok: false, reason: "Некорректный URL" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "Разрешены только http и https" };
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" || host.endsWith(".local") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) && (
      host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") ||
      host.startsWith("169.254.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "0.0.0.0"
    ) ||
    host === "[::1]" || host.endsWith(".internal")
  ) {
    return { ok: false, reason: "Внутренние адреса недоступны для мониторинга" };
  }
  return { ok: true, url: u.toString() };
}

export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Polite fetch with timeout + one retry with backoff. */
export async function fetchPage(url: string, timeoutMs = 20_000): Promise<FetchSuccess | FetchFailure> {
  const v = validateUrl(url);
  if (!v.ok) return { ok: false, kind: "invalid_url", message: v.reason };

  let lastErr: FetchFailure | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2500 * attempt));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(v.url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "ru,en;q=0.8",
        },
      });
      const status = res.status;
      if (!res.ok) {
        await res.body?.cancel();
        const kind: FetchFailureKind =
          status === 403 ? "http_403" : status === 404 ? "http_404" :
          status >= 500 ? "http_5xx" : "http_error";
        lastErr = { ok: false, kind, message: `HTTP ${status}`, status };
        // 4xx are permanent — no retry.
        if (status < 500) return lastErr;
        continue;
      }
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct && !ct.includes("html") && !ct.includes("xml")) {
        await res.body?.cancel();
        return { ok: false, kind: "not_html", message: `Тип контента: ${ct}`, status };
      }
      const html = (await res.text()).slice(0, MAX_HTML_BYTES);
      return { ok: true, html, status, finalUrl: res.url || v.url };
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      lastErr = /abort/i.test(msg)
        ? { ok: false, kind: "timeout", message: "Превышено время ожидания" }
        : { ok: false, kind: "connection", message: msg.slice(0, 200) };
    } finally {
      clearTimeout(t);
    }
  }
  return lastErr ?? { ok: false, kind: "connection", message: "Не удалось получить страницу" };
}

const BOILERPLATE_SELECTORS = [
  "script", "style", "noscript", "iframe", "svg", "template",
  "nav", "header", "footer", "aside",
  ".sidebar", ".widget", ".advert", ".ads", ".ad", ".banner", ".popup", ".modal",
  ".cookie", ".cookies", ".breadcrumb", ".breadcrumbs", ".comments", ".comment-list",
  "#comments", ".share", ".social", ".menu", ".navigation", ".pagination",
];

function textOf(el: Element | null | undefined): string {
  return normalizeText(el?.textContent ?? "");
}

/** Collapses whitespace, drops zero-width chars, unifies dashes to a short hyphen. */
export function normalizeText(s: string): string {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Removes volatile fragments (dates, counters, ids, query-string noise). */
function stripVolatile(s: string): string {
  return s
    .replace(/\b\d{1,2}[:.]\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\b\d{10,}\b/g, " ")
    .replace(/[?&](utm_[a-z]+|_ga|fbclid|gclid|yclid)=[^&\s]*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(s: string): number {
  const t = normalizeText(s);
  if (!t) return 0;
  return t.split(/[^\p{L}\p{N}\-]+/u).filter(w => w.length > 1).length;
}

function pickMain(doc: any): Element {
  const candidates = ["article", "main", "[role=main]", ".post-content", ".entry-content", ".article-content", "#content", ".content"];
  for (const sel of candidates) {
    const el = doc.querySelector(sel) as Element | null;
    if (el && countWords(el.textContent || "") > 80) return el;
  }
  return (doc.querySelector("body") || doc.documentElement) as Element;
}

const PRICE_RE = /(?:\d[\d\s\u00A0]{2,})\s?(?:₽|руб\.?|рублей|р\.|\$|€|USD|EUR|RUB)/gi;

export async function buildSnapshot(html: string, pageUrl: string, httpStatus: number): Promise<NormalizedSnapshot> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error("Не удалось разобрать HTML");

  const base = new URL(pageUrl);

  const title = normalizeText(doc.querySelector("title")?.textContent || "");
  const description = normalizeText(doc.querySelector('meta[name="description"]')?.getAttribute("content") || "");
  const canonical = normalizeText(doc.querySelector('link[rel="canonical"]')?.getAttribute("href") || "");
  const robots = normalizeText(doc.querySelector('meta[name="robots"]')?.getAttribute("content") || "");

  const schema_types: string[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((n: any) => {
    try {
      const parsed = JSON.parse(n.textContent || "{}");
      const walk = (o: any) => {
        if (!o) return;
        if (Array.isArray(o)) return o.forEach(walk);
        if (typeof o === "object") {
          if (o["@type"]) {
            const t = Array.isArray(o["@type"]) ? o["@type"] : [o["@type"]];
            t.forEach((x: unknown) => schema_types.push(String(x)));
          }
          if (o["@graph"]) walk(o["@graph"]);
        }
      };
      walk(parsed);
    } catch { /* ignore malformed ld+json */ }
  });

  // Images before boilerplate removal would include ad pixels; take them from main content later.
  for (const sel of BOILERPLATE_SELECTORS) {
    doc.querySelectorAll(sel).forEach((n: any) => n.remove?.());
  }
  const main = pickMain(doc);

  const h1 = textOf(main.querySelector("h1") || doc.querySelector("h1"));

  const headings: Heading[] = [];
  main.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((n: any) => {
    const txt = normalizeText(n.textContent || "");
    if (txt) headings.push({ level: Number(String(n.tagName).slice(1)) || 2, text: txt });
  });

  const images: ImageItem[] = [];
  main.querySelectorAll("img").forEach((n: any) => {
    const src = n.getAttribute("src") || n.getAttribute("data-src") || "";
    if (!src || src.startsWith("data:")) return;
    let abs = src;
    try { abs = new URL(src, base).toString(); } catch { /* keep raw */ }
    images.push({ src: abs.split("#")[0], alt: normalizeText(n.getAttribute("alt") || "") });
  });

  const internal_links: LinkItem[] = [];
  const external_links: LinkItem[] = [];
  main.querySelectorAll("a[href]").forEach((n: any) => {
    const raw = n.getAttribute("href") || "";
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:") || raw.startsWith("mailto:") || raw.startsWith("tel:")) return;
    let u: URL;
    try { u = new URL(raw, base); } catch { return; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    u.hash = "";
    const item: LinkItem = { href: u.toString(), text: normalizeText(n.textContent || "").slice(0, 120) };
    (u.hostname === base.hostname ? internal_links : external_links).push(item);
  });

  // FAQ: details/summary, schema FAQPage, or heading-question + following text.
  const faq: FaqItem[] = [];
  main.querySelectorAll("details").forEach((n: any) => {
    const q = normalizeText(n.querySelector("summary")?.textContent || "");
    if (!q) return;
    const clone = normalizeText(n.textContent || "");
    faq.push({ q, a: clone.replace(q, "").trim().slice(0, 600) });
  });
  if (faq.length === 0) {
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(() => { /* removed above */ });
    for (const h of headings) {
      if (/[?？]\s*$/.test(h.text) && h.level >= 2) faq.push({ q: h.text, a: "" });
    }
  }

  const tables: string[] = [];
  main.querySelectorAll("table").forEach((n: any) => {
    const caption = normalizeText(n.querySelector("caption")?.textContent || "");
    const firstRow = normalizeText(n.querySelector("tr")?.textContent || "").slice(0, 200);
    tables.push(caption || firstRow || "table");
  });

  const lists: string[] = [];
  main.querySelectorAll("ul,ol").forEach((n: any) => {
    const items = Array.from(n.querySelectorAll("li")).slice(0, 3)
      .map((li: any) => normalizeText(li.textContent || "").slice(0, 80)).filter(Boolean);
    if (items.length) lists.push(items.join(" | "));
  });

  const cta: string[] = [];
  main.querySelectorAll("button,a.btn,a.button,.btn,.button,[class*=cta]").forEach((n: any) => {
    const txt = normalizeText(n.textContent || "");
    if (txt && txt.length <= 80) cta.push(txt);
  });

  const mainText = normalizeText(main.textContent || "");
  const prices = Array.from(new Set((mainText.match(PRICE_RE) || []).map(p => normalizeText(p)))).slice(0, 60);

  const content = stripVolatile(mainText).slice(0, 200_000);
  const word_count = countWords(content);

  const uniqCta = Array.from(new Set(cta)).slice(0, 40);
  const structureSignature = headings.map(h => `${h.level}:${h.text.toLowerCase()}`).join("\n") +
    `\n#tables:${tables.length}\n#lists:${lists.length}\n#faq:${faq.length}\n#images:${images.length}`;
  const linksSignature = [
    ...internal_links.map(l => `i:${l.href}`),
    ...external_links.map(l => `e:${l.href}`),
  ].sort().join("\n");
  const metaSignature = `${title}\n${description}\n${h1}\n${canonical}\n${robots}`;

  const [content_hash, structure_hash, meta_hash, links_hash] = await Promise.all([
    sha256(content.toLowerCase()),
    sha256(structureSignature),
    sha256(metaSignature),
    sha256(linksSignature),
  ]);

  return {
    url: pageUrl,
    http_status: httpStatus,
    title, description, h1, headings,
    word_count, content,
    images: images.slice(0, 300),
    internal_links: internal_links.slice(0, 500),
    external_links: external_links.slice(0, 300),
    faq: faq.slice(0, 100),
    tables: tables.slice(0, 60),
    lists: lists.slice(0, 120),
    cta: uniqCta,
    prices,
    schema_types: Array.from(new Set(schema_types)).slice(0, 40),
    canonical, robots,
    content_hash, structure_hash, meta_hash, links_hash,
    raw_html: html.slice(0, 900_000),
  };
}
