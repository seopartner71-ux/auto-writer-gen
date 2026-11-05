// Admin-only: re-reads client site pages at archive build time so the generator can
// hide facts that vanished from the site and block verbatim copies of site text.
// Only pages on the client domain are fetched. Returns plain page text, no LLM.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdmin } from "../_shared/auth.ts";
import { readPage, hostOf } from "../_shared/siteReader.ts";

const MAX_URLS = 30;

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

    const pages = (await Promise.all(urls.map(readPage))).map(({ url, ok, text }) => ({ url, ok, text }));
    return jsonResponse({ checkedAt: new Date().toISOString().slice(0, 10), pages });
  } catch (e) {
    return errorResponse((e as Error).message || "Ошибка сверки с сайтом", 500);
  }
});
