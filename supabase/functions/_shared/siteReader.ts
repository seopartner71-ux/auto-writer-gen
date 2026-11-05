// Shared site page reader: direct fetch with a text-reader fallback.
// Returns plain text plus raw HTML (empty when the fallback reader answered).

import { withTimeout } from "./withTimeout.ts";

const PAGE_CHARS = 60000;
const HTML_CHARS = 400000;

export function htmlToText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

export const hostOf = (u: string) => {
  try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};

export async function readPage(url: string): Promise<{ url: string; ok: boolean; text: string; html: string }> {
  try {
    const res = await withTimeout(fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SeoModuleBot/1.0)" } }), 15_000, "direct timeout");
    if (res.ok) {
      const html = (await res.text()).slice(0, HTML_CHARS);
      const text = htmlToText(html).slice(0, PAGE_CHARS);
      if (text.length > 40) return { url, ok: true, text, html };
    }
  } catch { /* reader fallback */ }
  const jinaKey = Deno.env.get("JINA_API_KEY");
  try {
    const res = await withTimeout(fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain", "X-Return-Format": "text", ...(jinaKey ? { Authorization: `Bearer ${jinaKey}` } : {}) },
    }), 25_000, "reader timeout");
    if (res.ok) {
      const text = (await res.text()).slice(0, PAGE_CHARS);
      if (text.trim().length > 40) return { url, ok: true, text, html: "" };
    }
  } catch { /* unread */ }
  return { url, ok: false, text: "", html: "" };
}
