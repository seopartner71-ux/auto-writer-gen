// RAG-экстрактор контента клиентской страницы для Контентной экосистемы.
// Принимает { url, source_type }, возвращает { content, title, word_count, error }.

import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

// Многие сайты режут «ботовые» User-Agent - ходим как обычный браузер.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT_MS = 25_000;
const RETRIES = 2;
const MIN_WORDS = 100;

async function fetchHtml(url: string): Promise<{ html?: string; error?: string }> {
  let lastErr = "URL not accessible";
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
          "Cache-Control": "no-cache",
        },
      });
      if (!r.ok) {
        lastErr = `Страница недоступна (HTTP ${r.status})`;
        if (r.status < 500) return { error: lastErr };
        continue;
      }
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
        return { error: "По ссылке не HTML-страница" };
      }
      return { html: await r.text() };
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      lastErr = aborted ? "Сайт слишком долго отвечает" : "Не удалось загрузить страницу";
      console.warn(`[RAG-EXTRACT] attempt=${attempt} url=${url} err=${lastErr}`);
    } finally { clearTimeout(timer); }
  }
  return { error: lastErr };
}

function stripBlocks(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function pickMainHtml(html: string): string {
  const clean = stripBlocks(html);
  const p1 = clean.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i);
  if (p1 && p1[2] && p1[2].length > 400) return p1[2];

  const idClass = /(main-content|article-body|product-description|category-content|content-main|entry-content)/i;
  const divRe = /<(div|section)[^>]*(?:id|class)=["']([^"']*)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let best = "";
  for (const m of clean.matchAll(divRe)) {
    if (idClass.test(m[2]) && m[3].length > best.length) best = m[3];
  }
  if (best.length > 400) return best;

  const body = clean.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || clean;
  return body
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "-").replace(/&ndash;/g, "-").replace(/&laquo;/g, "«").replace(/&raquo;/g, "»");
}

/** Минималистичный HTML -> Markdown без внешних зависимостей. */
function htmlToMarkdown(html: string): string {
  let s = html;
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|section|tr|li|h[1-6]|table)>/gi, "\n");
  for (let i = 1; i <= 6; i++) {
    s = s.replace(new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, "gi"), (_m, t) => `\n${"#".repeat(i)} ${stripTags(t)}\n`);
  }
  s = s.replace(/<li[^>]*>([\s\S]*?)(?=<li|$)/gi, (_m, t) => `- ${stripTags(t)}\n`);
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, t2) => stripTags(t2));
  s = stripTags(s);
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/—/g, "-")
    .trim();
}

function stripTags(s: string): string {
  return decodeEntities(String(s).replace(/<[^>]+>/g, " ")).replace(/[ \t\u00a0]+/g, " ").trim();
}

function extractTitle(html: string, md: string): string {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (t && stripTags(t)) return stripTags(t).slice(0, 300);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1 && stripTags(h1)) return stripTags(h1).slice(0, 300);
  return (md.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "") || "").slice(0, 300);
}

function countWords(s: string): number {
  return s.replace(/[#*_`>~|-]/g, " ").split(/\s+/).filter(Boolean).length;
}

// ---------- Извлечение изображений ----------

export interface ExtractedImage {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
  context: "product_card" | "gallery" | "hero" | "content";
}

const MAX_IMAGES = 30;
const BAD_ALT = /(icon|иконка|logo-small|sprite|placeholder|bg[-_ ]|background)/i;
const BAD_URL = /(sprite|favicon|logo|icon|placeholder|pixel|1x1|blank)/i;
const CTX_PRIORITY: Record<ExtractedImage["context"], number> = {
  product_card: 0, hero: 1, gallery: 2, content: 3,
};

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1].trim() : "";
}

function absUrl(src: string, base: URL): string | null {
  if (!src) return null;
  if (/^data:/i.test(src)) return null;
  try {
    const u = new URL(src, base);
    if (u.protocol !== "https:") return null;
    if (/\.svg(\?|$)/i.test(u.pathname)) return null;
    return u.toString();
  } catch { return null; }
}

/** Размечает регионы страницы, чтобы определить контекст каждой картинки. */
function imageRegions(html: string): Array<{ html: string; context: ExtractedImage["context"] }> {
  const clean = stripBlocks(html);
  const regions: Array<{ html: string; context: ExtractedImage["context"] }> = [];
  const push = (re: RegExp, context: ExtractedImage["context"]) => {
    for (const m of clean.matchAll(re)) {
      const chunk = m[m.length - 1];
      if (chunk && chunk.length > 40) regions.push({ html: chunk, context });
    }
  };
  push(/<(div|section|li|article)[^>]*(?:id|class)=["'][^"']*(product|catalog|item|card|tovar|goods)[^"']*["'][^>]*>([\s\S]{0,20000}?)<\/\1>/gi, "product_card");
  push(/<(div|section|ul)[^>]*(?:id|class)=["'][^"']*(gallery|slider|carousel|swiper|photos)[^"']*["'][^>]*>([\s\S]{0,20000}?)<\/\1>/gi, "gallery");
  push(/<(header|div|section)[^>]*(?:id|class)=["'][^"']*(hero|banner|promo|main-visual|intro)[^"']*["'][^>]*>([\s\S]{0,20000}?)<\/\1>/gi, "hero");
  push(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/gi, "content");
  regions.push({ html: clean, context: "content" });
  return regions;
}

export function extractImages(html: string, pageUrl: string): { images: ExtractedImage[]; filteredOut: number } {
  let base: URL;
  try { base = new URL(pageUrl); } catch { return { images: [], filteredOut: 0 }; }
  const seen = new Map<string, ExtractedImage>();
  let filteredOut = 0;
  const imgRe = /<img\b[^>]*>/gi;
  for (const region of imageRegions(html)) {
    for (const m of region.html.matchAll(imgRe)) {
      const tag = m[0];
      const raw = attr(tag, "src") || attr(tag, "data-src") || attr(tag, "data-original") ||
        (attr(tag, "srcset").split(",")[0] || "").trim().split(/\s+/)[0];
      const url = absUrl(raw, base);
      if (!url) { filteredOut++; continue; }
      if (seen.has(url)) continue;
      const alt = attr(tag, "alt");
      const w = parseInt(attr(tag, "width"), 10);
      const h = parseInt(attr(tag, "height"), 10);
      const width = Number.isFinite(w) ? w : null;
      const height = Number.isFinite(h) ? h : null;
      if (!alt.trim()) { filteredOut++; continue; }
      if (BAD_ALT.test(alt) || BAD_URL.test(url)) { filteredOut++; continue; }
      if ((width !== null && width < 300) || (height !== null && height < 200)) { filteredOut++; continue; }
      seen.set(url, { url, alt: alt.slice(0, 300), width, height, context: region.context });
    }
  }
  const images = [...seen.values()].sort((a, b) => {
    const p = CTX_PRIORITY[a.context] - CTX_PRIORITY[b.context];
    if (p !== 0) return p;
    return ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0));
  }).slice(0, MAX_IMAGES);
  return { images, filteredOut };
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const url = String((body as any)?.url || "").trim();
    const sourceType = String((body as any)?.source_type || "client_page");
    if (!url) return errorResponse("url is required", 400);
    if (url.length > 2000) return errorResponse("URL too long", 400);
    let parsed: URL;
    try { parsed = new URL(url); } catch { return errorResponse("Invalid URL", 400); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return errorResponse("Invalid URL protocol", 400);
    }

    const started = Date.now();
    const fetched = await fetchHtml(url);
    if (fetched.error || !fetched.html) {
      return jsonResponse({ error: fetched.error || "Не удалось загрузить страницу" }, 200);
    }
    const html = fetched.html;

    const mainHtml = pickMainHtml(html);
    const content = htmlToMarkdown(mainHtml).slice(0, 60000);
    const title = extractTitle(html, content);
    const wordCount = countWords(content);
    const { images, filteredOut } = extractImages(html, url);
    console.log(`[RAG-EXTRACT-IMAGES] url=${url} extracted_count=${images.length} filtered_out=${filteredOut}`);
    const elapsed = Date.now() - started;
    console.log(`[RAG-EXTRACT] url=${url} title=${title} words=${wordCount} elapsed=${elapsed}ms`);

    if (!content || wordCount < 20) {
      return jsonResponse({ error: "Could not extract meaningful content", title, word_count: wordCount }, 200);
    }

    return jsonResponse({
      content,
      title,
      word_count: wordCount,
      source_type: sourceType,
      images,
      warning: wordCount < MIN_WORDS ? "Source content is very short" : undefined,
      extraction_metadata: {
        word_count: wordCount,
        images_count: images.length,
        images_filtered_out: filteredOut,
        extracted_at: new Date().toISOString(),
        extractor_version: "1.0",
        elapsed_ms: elapsed,
      },
    });
  } catch (e) {
    console.error("[RAG-EXTRACT] error", e);
    return errorResponse((e as Error).message || "internal error", 500);
  }
});