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

/**
 * Source class used by the evidence engine and SOURCE_REGISTER.csv.
 * - OWN_CATALOG: the participant's own site (catalogue, product card) - max OWNER_REPORTED.
 * - PRIMARY_DOCUMENT: registry, certificate, test protocol or third-party report - the only
 *   class that may independently verify a technical or commercial metric.
 * - EXTERNAL_PUBLICATION: independent article, review or industry media - proves external
 *   presence only (M_TRUSTED_EXTERNAL_MENTIONS), never a hardware property.
 * - USER_GENERATED: marketplaces, social networks, free blogs - proves nothing.
 */
export type SourceClass = "OWN_CATALOG" | "PRIMARY_DOCUMENT" | "EXTERNAL_PUBLICATION" | "USER_GENERATED" | "UNKNOWN";

const REGISTRY_HOSTS = [".gov.ru", ".gov", "fsa.gov", "rosaccreditation", "rst.gov", "gost.ru", "nalog", "egrul", "zakupki", "fips.ru", "rospatent"];
const DOCUMENT_PATH = /(sertifikat|sertifikaty|certificate|certif|protokol|protocol|ispytan|test[-_]?report|deklaraci|declaration|attestat|laborator|reestr|registry)/i;

export function classifySource(url: string, ownHost: string, hostOf: (url: string) => string): SourceClass {
  const u = String(url || "").trim();
  if (!u) return "UNKNOWN";
  const h = normalise(hostOf(u));
  if (!h || !h.includes(".")) return "UNKNOWN";
  const own = normalise(ownHost);
  if (own && (h === own || rootDomain(h) === rootDomain(own))) return "OWN_CATALOG";
  if (!isTrustedExternalHost(h, ownHost)) return "USER_GENERATED";
  if (REGISTRY_HOSTS.some((r) => h === r.replace(/^\./, "") || h.endsWith(r) || h.includes(r.replace(/^\./, "")))) return "PRIMARY_DOCUMENT";
  let path = "";
  try {
    path = new URL(u.startsWith("http") ? u : `https://${u}`).pathname;
  } catch {
    path = u;
  }
  if (DOCUMENT_PATH.test(path)) return "PRIMARY_DOCUMENT";
  return "EXTERNAL_PUBLICATION";
}

/** Human-readable support scope written into SOURCE_REGISTER.csv. */
export function supportScope(cls: SourceClass): { can: string; cannot: string } {
  switch (cls) {
    case "PRIMARY_DOCUMENT":
      return { can: "независимое подтверждение показателя, указанного в документе (сертификат, протокол, реестр)", cannot: "показатели, не указанные в документе" };
    case "EXTERNAL_PUBLICATION":
      return { can: "M_TRUSTED_EXTERNAL_MENTIONS: факт упоминания участника на сторонней площадке", cannot: "независимое подтверждение технических характеристик, цены и гарантии" };
    case "OWN_CATALOG":
      return { can: "заявленные самим поставщиком характеристики и цена (OWNER_REPORTED)", cannot: "независимое подтверждение значения" };
    case "USER_GENERATED":
      return { can: "ничего: площадка с пользовательскими публикациями не учитывается", cannot: "независимое подтверждение значения; упоминания" };
    default:
      return { can: "наблюдение открытого сайта на дату отсечения", cannot: "независимое подтверждение значения" };
  }
}
