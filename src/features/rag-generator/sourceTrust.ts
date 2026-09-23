/**
 * Trust filter for external sources.
 *
 * INDEPENDENTLY_VERIFIED may only rest on genuinely independent publishers: registries,
 * state bodies, independent media, industry portals. A link is NOT independent when it
 * points at the participant's own domain, at a user-generated platform (marketplaces,
 * classifieds, social networks, messengers), at a free blogging or site-builder host, or
 * at a link-farm style aggregator. Those are filtered out before any evidence tier is
 * assigned, so a supplier cannot buy a verified status with postings it controls.
 *
 * The filter is identity-blind: the same list applies to every participant in the sample.
 */

/** Platforms where anyone can publish their own page: never an independent source. */
const USER_GENERATED = [
  // marketplaces and classifieds
  "avito", "youla", "ozon", "wildberries", "market.yandex", "aliexpress", "ebay", "amazon",
  "satom", "tiu", "prom.ua", "pulscen", "flagma", "allbiz", "all.biz", "blizko", "regmarkets",
  "goods.ru", "sbermegamarket", "megamarket", "leroymerlin", "drom", "farpost",
  // social networks and messengers
  "vk.com", "vk.ru", "ok.ru", "facebook", "instagram", "twitter", "x.com", "t.me", "telegram",
  "telegra.ph", "teletype.in", "pinterest", "tiktok", "youtube", "rutube", "linkedin",
  // free blogging and site builders
  "dzen.ru", "zen.yandex", "blogspot", "wordpress.com", "livejournal", "medium.com", "tilda",
  "wixsite", "ucoz", "narod.ru", "jimdo", "weebly", "webnode", "mozello", "nethouse", "b12.io",
  // directories and question boards
  "yell.ru", "zoon", "spr.ru", "orgpage", "rusprofile", "otzovik", "irecommend", "otzyvru",
  "pikabu", "answers", "quora", "reddit",
];

const normalise = (host: string): string => String(host || "").toLowerCase().replace(/^www\./, "");

/** Registrable-ish root: last two labels, enough to catch sub-domains of one owner. */
export const rootDomain = (host: string): string => {
  const parts = normalise(host).split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  return parts.slice(-2).join(".");
};

/**
 * True when `host` can back an independent verification for a participant whose own site
 * is `ownHost`. Blank hosts, own-domain links and user-generated platforms return false.
 */
export function isTrustedExternalHost(host: string, ownHost: string): boolean {
  const h = normalise(host);
  if (!h || !h.includes(".")) return false;
  const own = normalise(ownHost);
  if (own && (h === own || rootDomain(h) === rootDomain(own))) return false;
  return !USER_GENERATED.some((bad) => h === bad || h.endsWith(`.${bad}`) || h.includes(bad));
}

/**
 * Distinct trusted external root domains among `urls`, excluding the participant's own site.
 * `hostOf` maps a URL to its host with the caller's own parser.
 */
export function trustedExternalDomains(
  urls: Array<string | undefined | null>,
  ownHost: string,
  hostOf: (url: string) => string,
): Set<string> {
  const out = new Set<string>();
  for (const u of urls) {
    if (!u) continue;
    const h = hostOf(String(u));
    if (isTrustedExternalHost(h, ownHost)) out.add(rootDomain(h));
  }
  return out;
}
