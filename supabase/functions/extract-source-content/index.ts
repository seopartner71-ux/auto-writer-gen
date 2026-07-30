// RAG-экстрактор контента клиентской страницы для Контентной экосистемы.
// Принимает { url, source_type }, возвращает { content, title, word_count, error }.

import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

const UA = "SEO-Modul RAG Bot 1.0";
const TIMEOUT_MS = 10_000;
const MIN_WORDS = 100;

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
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let html = "";
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
      });
      if (!r.ok) return jsonResponse({ error: `URL not accessible (HTTP ${r.status})` }, 200);
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
        return jsonResponse({ error: "Source is not an HTML page" }, 200);
      }
      html = await r.text();
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      return jsonResponse({
        error: aborted ? "Source URL took too long to respond" : "URL not accessible",
      }, 200);
    } finally { clearTimeout(timer); }

    const mainHtml = pickMainHtml(html);
    const content = htmlToMarkdown(mainHtml).slice(0, 60000);
    const title = extractTitle(html, content);
    const wordCount = countWords(content);
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
      warning: wordCount < MIN_WORDS ? "Source content is very short" : undefined,
      extraction_metadata: {
        word_count: wordCount,
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

export { corsHeaders };