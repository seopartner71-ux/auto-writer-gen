// Admin-only: re-reads client site pages at archive build time so the generator can
// hide facts that vanished from the site and block verbatim copies of site text.
// Only pages on the client domain are fetched. Returns plain page text, no LLM.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdmin } from "../_shared/auth.ts";
import { withTimeout } from "../_shared/withTimeout.ts";

const MAX_URLS = 30;
const PAGE_CHARS = 60000;

function htmlToText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

async function readPage(url: string): Promise<{ url: string; ok: boolean; text: string }> {
  try {
    const res = await withTimeout(fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SeoModuleBot/1.0)" } }), 15_000, "direct timeout");
    if (res.ok) {
      const text = htmlToText(await res.text()).slice(0, PAGE_CHARS);
      if (text.length > 40) return { url, ok: true, text };
    }
  } catch { /* reader fallback */ }
  const jinaKey = Deno.env.get("JINA_API_KEY");
  try {
    const res = await withTimeout(fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain", "X-Return-Format": "text", ...(jinaKey ? { Authorization: `Bearer ${jinaKey}` } : {}) },
    }), 25_000, "reader timeout");
    if (res.ok) {
      const text = (await res.text()).slice(0, PAGE_CHARS);
      if (text.trim().length > 40) return { url, ok: true, text };
    }
  } catch { /* unread */ }
  return { url, ok: false, text: "" };
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const forbidden = await requireAdmin(auth);
    if (forbidden) return forbidden;

    let body: { site?: unknown; urls?: unknown } = {};
    try { body = await req.json(); } catch { /* empty */ }
    const site = String(body.site ?? "").trim();
    const h = hostOf(site);
    if (!/^https?:\/\//i.test(site) || !h) return errorResponse("Укажите сайт компании (http/https)", 400);
    const urls = (Array.isArray(body.urls) ? body.urls : [])
      .map((u) => String(u ?? "").trim())
      .filter((u) => /^https?:\/\/[^\s]+$/i.test(u) && (hostOf(u) === h || hostOf(u).endsWith(`.${h}`)))
      .filter((u, i, a) => a.indexOf(u) === i)
      .slice(0, MAX_URLS);
    if (!urls.length) urls.push(site);

    const { data: rateOk } = await adminClient().rpc("check_rate_limit", {
      p_user_id: auth.userId, p_action: "kb_site_verify", p_max_requests: 60, p_window_minutes: 60,
    });
    if (rateOk === false) return errorResponse("Слишком много проверок. Попробуйте позже.", 429);

    const pages = await Promise.all(urls.map(readPage));
    return jsonResponse({ checkedAt: new Date().toISOString().slice(0, 10), pages });
  } catch (e) {
    return errorResponse((e as Error).message || "Ошибка сверки с сайтом", 500);
  }
});
