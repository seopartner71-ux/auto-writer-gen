// Admin-only: parses the client site to pre-fill the Knowledge Base wizard.
// Reads the homepage plus the contacts page (when linked), extracts company name,
// description, city, phones, emails, address, work hours and a classified list of
// internal pages. Regex-based, no LLM: extracted values are drafts for the wizard,
// the user confirms them before they become facts.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdmin } from "../_shared/auth.ts";
import { readPage, hostOf } from "../_shared/siteReader.ts";

type PageLink = { url: string; title: string; kind: "contacts" | "delivery" | "prices" | "catalog" | "page" };

const KIND_RULES: [PageLink["kind"], RegExp][] = [
  ["contacts", /kontakt|contact|контакт/i],
  ["delivery", /dostavka|delivery|доставк/i],
  ["prices", /price|prajs|prays|стоимост|цены|прайс/i],
  ["catalog", /catalog|katalog|produkt|uslug|товар|услуг|продукц/i],
];

function extractLinks(html: string, site: string): PageLink[] {
  const base = hostOf(site);
  if (!html || !base) return [];
  const out: PageLink[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 60) {
    let url = m[1].trim();
    const title = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (/^(#|javascript:|mailto:|tel:)/i.test(url)) continue;
    try { url = new URL(url, site).toString(); } catch { continue; }
    const h = hostOf(url);
    if (h !== base && !h.endsWith(`.${base}`)) continue;
    url = url.replace(/#.*$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    const probe = `${url} ${title}`;
    const kind = KIND_RULES.find(([, r]) => r.test(probe))?.[0] ?? "page";
    out.push({ url, title, kind });
  }
  const rank = { contacts: 0, delivery: 1, prices: 2, catalog: 3, page: 4 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, 20);
}

function metaContent(html: string, key: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${key}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1].replace(/\s+/g, " ").trim();
  }
  return "";
}

function extractName(html: string): string {
  const og = metaContent(html, "og:site_name");
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
  const raw = (og || title).replace(/\s+/g, " ").trim();
  return raw.split(/\s[|—–-]\s|::/)[0].trim().slice(0, 80);
}

const uniq = (xs: string[]) => [...new Set(xs)];

function extractPhones(text: string): string[] {
  const found = text.match(/(?:\+7|8)[\s(]?\d{3}[\s)]?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g) || [];
  return uniq(found.map((p) => p.replace(/\s+/g, " ").trim())).slice(0, 5);
}

function extractEmails(text: string): string[] {
  const found = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [];
  return uniq(found.filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/i.test(e))).slice(0, 5);
}

function extractAddress(text: string): string {
  const m = text.match(/(?:наш адрес|адрес офиса|адрес)[:\s]+([^\n.]{10,140})/i);
  return m?.[1]?.trim().replace(/\s{2,}/g, " ").slice(0, 140) || "";
}

function extractWorkHours(text: string): string {
  const m = text.match(/(пн\s*[-–]\s*(?:пт|сб|вс)[^.\n]{0,70})/i);
  return m?.[1]?.trim().slice(0, 80) || "";
}

function extractCity(text: string): string {
  const m = text.match(/(?:^|[\s,])г\.?\s?([А-Я][а-яё]+(?:-[А-Яа-яё]+)?)/);
  return m?.[1] || "";
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const forbidden = await requireAdmin(auth);
    if (forbidden) return forbidden;

    let body: { site?: unknown } = {};
    try { body = await req.json(); } catch { /* empty */ }
    const site = String(body.site ?? "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(site) || !hostOf(site)) {
      return errorResponse("Укажите сайт компании (http/https)", 400);
    }

    const { data: rateOk } = await adminClient().rpc("check_rate_limit", {
      p_user_id: auth.userId, p_action: "kb_site_parse", p_max_requests: 30, p_window_minutes: 60,
    });
    if (rateOk === false) return errorResponse("Слишком много разборов. Попробуйте позже.", 429);

    const home = await readPage(site);
    if (!home.ok) return errorResponse("Сайт не отвечает или главная страница пуста", 502);

    const pages = extractLinks(home.html, site);
    const contactsUrl = pages.find((p) => p.kind === "contacts")?.url || "";
    const contactsPage = contactsUrl && contactsUrl !== site ? await readPage(contactsUrl) : null;

    const html = [home.html, contactsPage?.html || ""].join("\n");
    const text = [home.text, contactsPage?.text || ""].filter(Boolean).join("\n");

    return jsonResponse({
      name: extractName(home.html),
      description: metaContent(home.html, "description").slice(0, 300),
      city: extractCity(text),
      contactsPage: contactsUrl,
      address: extractAddress(text),
      workHours: extractWorkHours(text),
      phones: extractPhones(text),
      emails: extractEmails(text),
      pages,
      htmlUsed: Boolean(html.trim()),
    });
  } catch (e) {
    return errorResponse((e as Error).message || "Ошибка разбора сайта", 500);
  }
});
