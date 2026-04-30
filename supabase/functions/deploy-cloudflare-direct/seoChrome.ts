// Shared SEO + UX chrome for Site Factory pages.
// - Head with title, meta description, canonical, OG, Twitter, JSON-LD
// - Sticky header / menu / breadcrumbs
// - Footer with full link set + copyright
// - Cookie consent banner (GDPR) saved to localStorage
// - robots.txt and sitemap.xml builders

import { widgetsCss, widgetsHtml as renderSiteWidgets } from "./siteWidgets.ts";

export interface TeamMember {
  name: string;
  role: string;
  bio?: string;
}

export interface Author {
  name: string;
  role?: string;
  bio?: string;
  avatar_seed?: string;
}

export interface BusinessPages {
  vacancies?: string;
  portfolio?: string;
  reviews?: string;
  faq?: string;
  pricing?: string;
  guarantees?: string;
  delivery?: string;
  promo?: string;
}

export interface SiteChrome {
  domain: string;          // e.g. "foo.pages.dev"
  siteName: string;
  siteAbout: string;
  topic: string;
  lang: string;            // "ru" | "en"
  accent: string;
  headingFont: string;
  bodyFont: string;
  projectId?: string;       // for tracking pixel
  trackerUrl?: string;      // full https URL of track-visit edge function
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  foundingYear?: number;
  teamMembers?: TeamMember[];
  ogImageUrl?: string;
  aboutHtml?: string;
  contactsHtml?: string;
  privacyHtml?: string;
  termsHtml?: string;
  footerLinkUrl?: string;
  footerLinkText?: string;
  injectionLinks?: { url: string; anchor: string }[];
  // Trust chrome v2
  legalAddress?: string;
  workHours?: string;
  juridicalInn?: string;
  whatsappUrl?: string;
  telegramUrl?: string;
  vkUrl?: string;
  youtubeUrl?: string;
  instagramUrl?: string;
  clientsCountText?: string;
  authors?: Author[];
  businessPages?: BusinessPages;
  /** Brand icon URL (FAL-generated, NO text). Rendered next to siteName text. */
  iconUrl?: string;
  /** Floating "Back to top" button placement; default left-bottom. */
  totopPosition?: "left-bottom" | "right-bottom" | "left-top" | "right-top" | "hidden";
}

export interface PageMeta {
  title: string;
  description: string;
  path: string;            // e.g. "/about.html" or "/posts/foo.html"
  type?: "website" | "article";
  publishedTime?: string;  // ISO
  modifiedTime?: string;   // ISO
  ogImage?: string;
  breadcrumbs: { label: string; href: string }[];  // include home + current
  jsonLd?: Record<string, unknown>[];              // extra schema beyond defaults
  noIndex?: boolean;
  bodyClass?: string;
}

export function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escAttr(s: string): string { return escHtml(s); }

function fontUrl(name: string): string { return name.replace(/\s+/g, "+"); }

export function googleFontsHref(heading: string, body: string): string {
  return `https://fonts.googleapis.com/css2?family=${fontUrl(heading)}:wght@400;700&family=${fontUrl(body)}:wght@400;600&display=swap`;
}

function absUrl(domain: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `https://${domain}${p}`;
}

function navItems(c: SiteChrome) {
  const isRu = c.lang === "ru";
  const items: { href: string; label: string }[] = [
    { href: "/", label: isRu ? "Главная" : "Home" },
    { href: "/about.html", label: isRu ? "О нас" : "About" },
  ];
  const bp = c.businessPages || {};
  if (bp.portfolio)  items.push({ href: "/portfolio.html",  label: isRu ? "Кейсы"     : "Portfolio" });
  if (bp.pricing)    items.push({ href: "/pricing.html",    label: isRu ? "Цены"      : "Pricing"   });
  if (bp.reviews)    items.push({ href: "/reviews.html",    label: isRu ? "Отзывы"    : "Reviews"   });
  if (bp.faq)        items.push({ href: "/faq.html",        label: "FAQ" });
  if (bp.vacancies)  items.push({ href: "/vacancies.html",  label: isRu ? "Вакансии"  : "Careers"   });
  items.push({ href: "/contacts.html", label: isRu ? "Контакты" : "Contacts" });
  return items;
}

function footerExtraLinks(c: SiteChrome) {
  const isRu = c.lang === "ru";
  const out: { href: string; label: string }[] = [];
  const bp = c.businessPages || {};
  if (bp.guarantees) out.push({ href: "/guarantees.html", label: isRu ? "Гарантии"        : "Guarantees" });
  if (bp.delivery)   out.push({ href: "/delivery.html",   label: isRu ? "Доставка и оплата" : "Shipping & Payment" });
  if (bp.promo)      out.push({ href: "/promo.html",      label: isRu ? "Акции"           : "Promotions" });
  out.push({ href: "/privacy.html", label: isRu ? "Конфиденциальность" : "Privacy" });
  out.push({ href: "/terms.html",   label: isRu ? "Соглашение"         : "Terms" });
  return out;
}

function organizationLd(c: SiteChrome) {
  const team = c.teamMembers || [];
  const founder = team[0];
  const sameAs = [c.whatsappUrl, c.telegramUrl, c.vkUrl, c.youtubeUrl, c.instagramUrl]
    .filter((u): u is string => !!u && /^https?:\/\//.test(u));
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: c.companyName || c.siteName,
    url: `https://${c.domain}/`,
    logo: c.ogImageUrl || undefined,
    description: c.siteAbout || undefined,
    foundingDate: c.foundingYear ? String(c.foundingYear) : undefined,
    numberOfEmployees: team.length > 0 ? team.length : undefined,
    address: c.companyAddress ? postalAddressLd(c) : undefined,
    telephone: c.companyPhone || undefined,
    email: c.companyEmail || undefined,
    sameAs: sameAs.length ? sameAs : undefined,
    founder: founder ? personLd(c, founder) : undefined,
    employee: team.length ? team.map((m) => personLd(c, m)) : undefined,
    contactPoint: (c.companyPhone || c.companyEmail) ? {
      "@type": "ContactPoint",
      telephone: c.companyPhone || undefined,
      email: c.companyEmail || undefined,
      contactType: "customer support",
    } : undefined,
  };
}

// Parse free-form address into a coarse PostalAddress.
// Heuristic: split by commas; first chunk = street, then city, postal code, country.
export function postalAddressLd(c: SiteChrome) {
  const raw = (c.companyAddress || c.legalAddress || "").trim();
  if (!raw) return undefined;
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  // Try to detect postal code (5-6 digit number)
  const postalMatch = raw.match(/\b(\d{5,6})\b/);
  const country = c.lang === "ru" ? "RU" : "US";
  return {
    "@type": "PostalAddress",
    streetAddress: parts[0] || raw,
    addressLocality: parts[1] || undefined,
    postalCode: postalMatch ? postalMatch[1] : undefined,
    addressCountry: country,
  };
}

// Build a Person schema for a TeamMember.
function personLd(c: SiteChrome, m: TeamMember) {
  return {
    "@type": "Person",
    name: m.name,
    jobTitle: m.role || undefined,
    description: m.bio || undefined,
    worksFor: { "@type": "Organization", name: c.companyName || c.siteName },
  };
}

// Parse "Пн-Пт 9:00-18:00, Сб 10:00-16:00" / "Mon-Fri 09:00-18:00" into
// schema.org openingHoursSpecification array. Returns undefined if no match.
export function parseOpeningHours(workHours?: string): unknown[] | undefined {
  if (!workHours) return undefined;
  const dayMap: Record<string, string> = {
    пн: "Monday", вт: "Tuesday", ср: "Wednesday", чт: "Thursday",
    пт: "Friday", сб: "Saturday", вс: "Sunday",
    mo: "Monday", tu: "Tuesday", we: "Wednesday", th: "Thursday",
    fr: "Friday", sa: "Saturday", su: "Sunday",
  };
  const out: unknown[] = [];
  // Match patterns like "Пн-Пт 9:00-18:00" or "Mon-Fri 09:00 - 18:00"
  const re = /([а-яa-z]{2,3})\s*[-–]\s*([а-яa-z]{2,3})\s*([0-9]{1,2}[:.][0-9]{2})\s*[-–]\s*([0-9]{1,2}[:.][0-9]{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(workHours)) !== null) {
    const from = dayMap[m[1].toLowerCase().slice(0, 2)];
    const to = dayMap[m[2].toLowerCase().slice(0, 2)];
    if (!from || !to) continue;
    const order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const i1 = order.indexOf(from);
    const i2 = order.indexOf(to);
    if (i1 < 0 || i2 < 0) continue;
    const days = order.slice(i1, i2 + 1);
    out.push({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: days,
      opens: m[3].replace(".", ":"),
      closes: m[4].replace(".", ":"),
    });
  }
  // Also single days: "Сб 10:00-16:00"
  const re2 = /(?:^|[,;])\s*([а-яa-z]{2,3})\s+([0-9]{1,2}[:.][0-9]{2})\s*[-–]\s*([0-9]{1,2}[:.][0-9]{2})/gi;
  while ((m = re2.exec(workHours)) !== null) {
    const day = dayMap[m[1].toLowerCase().slice(0, 2)];
    if (!day) continue;
    out.push({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: [day],
      opens: m[2].replace(".", ":"),
      closes: m[3].replace(".", ":"),
    });
  }
  return out.length ? out : undefined;
}

// LocalBusiness schema for contacts page (and homepage).
export function localBusinessLd(c: SiteChrome) {
  const isRu = c.lang === "ru";
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `https://${c.domain}/#localbusiness`,
    name: c.companyName || c.siteName,
    url: `https://${c.domain}/`,
    image: c.ogImageUrl || undefined,
    telephone: c.companyPhone || undefined,
    email: c.companyEmail || undefined,
    address: postalAddressLd(c),
    priceRange: isRu ? "₽₽" : "$$",
    openingHoursSpecification: parseOpeningHours(c.workHours),
    areaServed: c.companyAddress || undefined,
  };
}

// Service schema for a pricing package.
export function serviceLd(c: SiteChrome, opts: { name: string; description?: string; price?: string }) {
  const isRu = c.lang === "ru";
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: opts.name,
    description: opts.description || undefined,
    provider: {
      "@type": "Organization",
      "@id": `https://${c.domain}/#organization`,
      name: c.companyName || c.siteName,
      url: `https://${c.domain}/`,
    },
    offers: opts.price ? {
      "@type": "Offer",
      price: opts.price,
      priceCurrency: isRu ? "RUB" : "USD",
    } : undefined,
  };
}

function websiteLd(c: SiteChrome) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: c.siteName,
    url: `https://${c.domain}/`,
    inLanguage: c.lang,
  };
}

// Speakable specification — helps voice assistants and AI search engines
// (Google Assistant, Perplexity, Gemini, ChatGPT Search, Яндекс AI) pick the
// most important parts of the page to read out / quote.
function speakableLd(c: SiteChrome, m: PageMeta) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: absUrl(c.domain, m.path),
    name: m.title,
    inLanguage: c.lang,
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: [".ai-summary", "h1", ".hero-subtitle", ".lead", "article p:first-of-type"],
    },
  };
}

function breadcrumbsLd(c: SiteChrome, items: { label: string; href: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.label,
      item: absUrl(c.domain, it.href),
    })),
  };
}

function articleLd(c: SiteChrome, m: PageMeta) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: m.title,
    description: m.description,
    mainEntityOfPage: absUrl(c.domain, m.path),
    inLanguage: c.lang,
    datePublished: m.publishedTime || new Date().toISOString(),
    dateModified: m.modifiedTime || m.publishedTime || new Date().toISOString(),
    author: { "@type": "Organization", name: c.companyName || c.siteName },
    publisher: { "@type": "Organization", name: c.companyName || c.siteName },
    image: m.ogImage || c.ogImageUrl || undefined,
  };
}

function jsonLdScript(obj: unknown): string {
  // Strip undefined recursively for cleaner output
  const json = JSON.stringify(obj, (_k, v) => v === undefined ? undefined : v);
  return `<script type="application/ld+json">${json.replace(/</g, "\\u003c")}</script>`;
}

const COOKIE_BANNER_CSS = `
#cookie-banner{position:fixed;left:16px;right:16px;bottom:16px;background:#0a0a0a;color:#f5f5f5;padding:16px 20px;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);z-index:9999;display:none;font-size:14px;line-height:1.5;max-width:560px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif}
#cookie-banner.show{display:block}
#cookie-banner a{color:#fff;text-decoration:underline}
#cookie-banner .cb-actions{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}
#cookie-banner button{cursor:pointer;border:none;border-radius:8px;padding:8px 14px;font-size:14px;font-weight:600}
#cookie-banner .cb-accept{background:#fff;color:#0a0a0a}
#cookie-banner .cb-reject{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4)}
`;

function cookieBannerHtml(lang: string, privacyHref: string): string {
  const isRu = lang === "ru";
  const text = isRu
    ? `Мы используем cookies, чтобы сайт работал корректно. Подробнее в <a href="${privacyHref}">политике конфиденциальности</a>.`
    : `We use cookies to make the site work correctly. See our <a href="${privacyHref}">privacy policy</a>.`;
  const accept = isRu ? "Принять" : "Accept";
  const reject = isRu ? "Отклонить" : "Reject";
  return `<div id="cookie-banner" role="dialog" aria-live="polite" aria-label="${isRu ? "Cookies" : "Cookies"}">
  <div>${text}</div>
  <div class="cb-actions">
    <button class="cb-accept" type="button">${accept}</button>
    <button class="cb-reject" type="button">${reject}</button>
  </div>
</div>`;
}

const COOKIE_BANNER_JS = `
(function(){
  try{
    var KEY='cookie_consent';
    var saved=localStorage.getItem(KEY);
    var el=document.getElementById('cookie-banner');
    if(!el)return;
    if(!saved){el.classList.add('show');}
    el.querySelector('.cb-accept').addEventListener('click',function(){localStorage.setItem(KEY,'accepted');el.classList.remove('show');});
    el.querySelector('.cb-reject').addEventListener('click',function(){localStorage.setItem(KEY,'rejected');el.classList.remove('show');});
  }catch(e){}
})();`;

export function headerHtml(c: SiteChrome): string {
  const items = navItems(c);
  const isRu = c.lang === "ru";
  const brandInner = c.iconUrl
    ? `<img class="site-header__logo" src="${escAttr(c.iconUrl)}" alt="" width="36" height="36" loading="eager" decoding="async"><span class="site-header__brand-text">${escHtml(c.siteName)}</span>`
    : `<span class="site-header__brand-text">${escHtml(c.siteName)}</span>`;
  return `<a class="skip-link" href="#main-content">${isRu ? "Перейти к контенту" : "Skip to content"}</a>
<div class="reading-progress" id="reading-progress" aria-hidden="true"></div>
<header class="site-header" id="site-header">
  <div class="site-header__inner">
    <a href="/" class="site-header__brand">${brandInner}</a>
    <button class="site-header__burger" type="button" aria-label="${isRu ? "Меню" : "Menu"}" aria-controls="site-nav" aria-expanded="false" id="burger">
      <span></span><span></span><span></span>
    </button>
    <nav class="site-nav" id="site-nav" aria-label="${isRu ? "Основное меню" : "Main"}">
      ${items.map((i) => `<a href="${i.href}">${escHtml(i.label)}</a>`).join("")}
    </nav>
  </div>
</header>`;
}

function breadcrumbsHtml(c: SiteChrome, items: { label: string; href: string }[]): string {
  if (!items || items.length <= 1) return "";
  return `<nav class="breadcrumbs" aria-label="${c.lang === "ru" ? "Хлебные крошки" : "Breadcrumbs"}">
  <ol>${items.map((it, i, a) => {
    const last = i === a.length - 1;
    return last
      ? `<li aria-current="page">${escHtml(it.label)}</li>`
      : `<li><a href="${it.href}">${escHtml(it.label)}</a></li>`;
  }).join("")}</ol>
</nav>`;
}

export function footerHtml(c: SiteChrome): string {
  const items = navItems(c);
  const extra = footerExtraLinks(c);
  const year = new Date().getFullYear();
  const isRu = c.lang === "ru";
  const owner = c.companyName || c.siteName;

  const napLines: string[] = [];
  if (c.iconUrl) {
    napLines.push(`<div class="site-footer__brand"><img class="site-footer__logo" src="${escAttr(c.iconUrl)}" alt="" width="32" height="32" loading="lazy" decoding="async"><span>${escHtml(c.siteName)}</span></div>`);
  }
  if (c.companyName)    napLines.push(`<div><strong>${escHtml(c.companyName)}</strong></div>`);
  if (c.companyAddress) napLines.push(`<div>${escHtml(c.companyAddress)}</div>`);
  if (c.workHours)      napLines.push(`<div>${escHtml(c.workHours)}</div>`);
  if (c.companyPhone)   napLines.push(`<div><a href="tel:${escAttr(c.companyPhone.replace(/[^+\d]/g, ""))}">${escHtml(c.companyPhone)}</a></div>`);
  if (c.companyEmail)   napLines.push(`<div><a href="mailto:${escAttr(c.companyEmail)}">${escHtml(c.companyEmail)}</a></div>`);
  if (c.juridicalInn)   napLines.push(`<div class="nap-inn">${isRu ? "ИНН" : "Tax ID"}: ${escHtml(c.juridicalInn)}</div>`);

  const social: string[] = [];
  const sLink = (href: string | undefined, label: string) =>
    href ? `<a href="${escAttr(href)}" rel="nofollow noopener" target="_blank" aria-label="${label}">${label}</a>` : "";
  if (c.whatsappUrl)  social.push(sLink(c.whatsappUrl,  "WhatsApp"));
  if (c.telegramUrl)  social.push(sLink(c.telegramUrl,  "Telegram"));
  if (c.vkUrl)        social.push(sLink(c.vkUrl,        isRu ? "ВКонтакте" : "VK"));
  if (c.youtubeUrl)   social.push(sLink(c.youtubeUrl,   "YouTube"));
  if (c.instagramUrl) social.push(sLink(c.instagramUrl, "Instagram"));
  const socialHtml = social.length ? `<div class="site-footer__social">${social.join("")}</div>` : "";

  const trustHtml = `<div class="site-footer__trust">${isRu ? "Безопасная оплата · SSL · Visa · Mastercard · МИР · СБП" : "Secure payment · SSL · Visa · Mastercard"}</div>`;
  const clientsHtml = c.clientsCountText ? `<div class="site-footer__clients">${escHtml(c.clientsCountText)}</div>` : "";

  const footerExtra = c.footerLinkUrl && c.footerLinkText
    ? `<a class="site-footer__partner" href="${escAttr(c.footerLinkUrl)}" rel="nofollow noopener">${escHtml(c.footerLinkText)}</a>`
    : "";

  return `<footer class="site-footer">
  <div class="site-footer__inner">
    <nav class="site-footer__nav" aria-label="${isRu ? "Подвал" : "Footer"}">
      ${[...items, ...extra].map((i) => `<a href="${i.href}">${escHtml(i.label)}</a>`).join("")}
    </nav>
    <div class="site-footer__meta">
      ${napLines.join("")}
      ${socialHtml}
      ${clientsHtml}
      ${trustHtml}
      <div>&copy; ${c.foundingYear ? `${c.foundingYear}-${year}` : year} ${escHtml(owner)}</div>
      ${footerExtra}
    </div>
  </div>
</footer>
<button class="back-to-top" id="back-to-top" type="button" aria-label="${isRu ? "Наверх" : "Back to top"}">↑</button>`;
}

const TRUST_JS = `
(function(){
  try{
    var burger=document.getElementById('burger');
    var nav=document.getElementById('site-nav');
    if(burger&&nav){burger.addEventListener('click',function(){var op=nav.classList.toggle('open');burger.setAttribute('aria-expanded',op?'true':'false');});}
    var bar=document.getElementById('reading-progress');
    if(bar){window.addEventListener('scroll',function(){var h=document.documentElement;var s=h.scrollTop||document.body.scrollTop;var t=(h.scrollHeight-h.clientHeight)||1;bar.style.width=(Math.min(100,s/t*100))+'%';},{passive:true});}
    var top=document.getElementById('back-to-top');
    if(top){window.addEventListener('scroll',function(){top.classList.toggle('show',(window.scrollY||0)>400);},{passive:true});top.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});}
  }catch(e){}
})();`;

const CHROME_CSS = `
:root { color-scheme: light; }
*,*:before,*:after{box-sizing:border-box}
html,body{margin:0;padding:0}
img{max-width:100%;height:auto;display:block}
a{color:inherit}
a:focus,a:focus-visible,button:focus,button:focus-visible{outline:2px solid var(--accent,#0ea5e9);outline-offset:2px;border-radius:4px}
a:focus:not(:focus-visible),button:focus:not(:focus-visible){outline:none}
.skip-link{position:absolute;left:-9999px;top:0;background:#000;color:#fff;padding:8px 12px;z-index:9999}
.skip-link:focus{left:8px;top:8px}
.reading-progress{position:fixed;top:0;left:0;height:3px;width:0;background:var(--accent,#0ea5e9);z-index:60;transition:width .1s linear}
.site-header{position:sticky;top:0;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-bottom:1px solid rgba(0,0,0,.08);z-index:50}
.site-header__inner{max-width:1200px;margin:0 auto;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;gap:24px}
.site-header__brand{font-weight:700;text-decoration:none;font-size:20px}
.site-header__burger{display:none;background:none;border:0;padding:8px;cursor:pointer;flex-direction:column;gap:4px;width:44px;height:44px;align-items:center;justify-content:center}
.site-header__burger span{width:22px;height:2px;background:#222;display:block}
.site-nav{display:flex;gap:18px;flex-wrap:wrap}
.site-nav a{color:#444;text-decoration:none;font-size:14px;font-weight:500}
.site-nav a:hover{color:var(--accent,#0ea5e9)}
@media (max-width:760px){
  .site-header__burger{display:flex}
  .site-nav{display:none;width:100%;flex-direction:column;gap:0;padding:8px 0;border-top:1px solid rgba(0,0,0,.08)}
  .site-nav.open{display:flex}
  .site-nav a{padding:12px 24px;font-size:16px;min-height:44px;display:flex;align-items:center}
  .site-header__inner{flex-wrap:wrap}
}
.breadcrumbs{max-width:1200px;margin:0 auto;padding:12px 24px;font-size:13px;color:#666}
.breadcrumbs ol{list-style:none;display:flex;flex-wrap:wrap;gap:6px;padding:0;margin:0}
.breadcrumbs li:not(:last-child)::after{content:" / ";color:#bbb;margin-left:6px}
.breadcrumbs a{color:#666;text-decoration:none}
.breadcrumbs a:hover{color:var(--accent,#0ea5e9);text-decoration:underline}
.site-footer{background:#0a0a0a;color:#cfcfcf;margin-top:48px;padding:48px 24px;border:0;outline:0;box-shadow:none}
.site-footer *{border-color:rgba(255,255,255,.08)}
.site-footer__inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr;gap:32px;font-size:14px}
@media(min-width:760px){.site-footer__inner{grid-template-columns:1.4fr 1fr;align-items:start}}
.site-footer__nav{display:flex;gap:14px 22px;flex-wrap:wrap}
.site-footer__nav a{color:#cfcfcf;text-decoration:none}
.site-footer__nav a:hover{color:#fff;text-decoration:underline}
.site-footer__meta{display:flex;flex-direction:column;gap:8px;font-size:13px;color:#9a9a9a;text-align:left}
@media(min-width:760px){.site-footer__meta{text-align:right;align-items:flex-end}}
.site-footer__meta a{color:#cfcfcf;text-decoration:none}
.site-footer__partner{color:#9a9a9a;font-size:12px}
.site-footer__social{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;font-size:12px}
@media(min-width:760px){.site-footer__social{justify-content:flex-end}}
.site-footer__social a{color:#9a9a9a;text-decoration:none;border:1px solid rgba(255,255,255,.15);padding:4px 10px;border-radius:6px}
.site-footer__social a:hover{color:#fff;border-color:rgba(255,255,255,.4)}
.site-footer__trust{font-size:11px;color:#7a7a7a;margin-top:6px}
.site-footer__clients{font-size:12px;color:#bbb;margin-top:4px}
.nap-inn{font-size:11px;color:#7a7a7a}
.back-to-top{position:fixed;right:20px;bottom:20px;width:44px;height:44px;border:0;border-radius:50%;background:var(--accent,#0ea5e9);color:#fff;font-size:22px;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .2s;z-index:55;box-shadow:0 6px 20px rgba(0,0,0,.2)}
.back-to-top.show{opacity:1;pointer-events:auto}
.share-bar{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}
.share-bar a{padding:8px 14px;border:1px solid #e5e7eb;border-radius:8px;color:#444;text-decoration:none;font-size:13px;background:#fff;min-height:44px;display:inline-flex;align-items:center}
.share-bar a:hover{background:#f5f5f5}
.author-meta{display:flex;align-items:center;gap:12px;margin:12px 0 24px;color:#666;font-size:14px}
.author-meta img{width:40px;height:40px;border-radius:50%}
.bp-pricing-table{width:100%;border-collapse:collapse;margin:16px 0}
.bp-pricing-table th,.bp-pricing-table td{border:1px solid #e5e7eb;padding:10px 14px;text-align:left}
.bp-pricing-table th{background:#f8fafc}
.related-posts{max-width:900px;margin:48px auto 0;padding:24px;border-top:1px solid #e5e7eb}
.related-posts h2{font-size:20px;margin:0 0 16px;font-family:inherit}
.related-posts ul{list-style:none;padding:0;margin:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.related-posts li a{display:block;padding:14px 16px;background:#f8fafc;border-radius:8px;color:#0f172a;text-decoration:none;font-weight:500;line-height:1.4}
.related-posts li a:hover{background:#eef2f7}
.team-grid{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin:24px 0}
.team-card{padding:20px;background:#fafafa;border-radius:10px}
.team-card h3{margin:0 0 4px;font-size:16px}
.team-card .role{color:#666;font-size:13px;margin-bottom:8px}
.team-card p{margin:0;color:#444;font-size:14px}
.contacts-page{max-width:1100px;margin:0 auto;padding:24px}
.contacts-grid{display:grid;grid-template-columns:1fr;gap:24px;margin:32px 0}
@media(min-width:860px){.contacts-grid{grid-template-columns:1fr 1.2fr}}
.contacts-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;box-shadow:0 4px 18px rgba(15,23,42,.04)}
.contacts-card h2{margin:0 0 18px;font-size:22px;font-family:inherit}
.contacts-card__subtitle{margin:-10px 0 18px;color:#666;font-size:14px}
.contact-list-v2{display:flex;flex-direction:column;gap:14px}
.contact-item{display:flex;flex-direction:column;gap:2px;padding:12px 14px;background:#f8fafc;border-radius:10px}
.contact-item__label{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;font-weight:600}
.contact-item__value{font-size:15px;color:#0f172a;text-decoration:none;word-break:break-word}
a.contact-item__value:hover{color:var(--accent,#0ea5e9);text-decoration:underline}
.contact-form{display:flex;flex-direction:column;gap:14px}
.contact-form__row{display:grid;grid-template-columns:1fr;gap:14px}
@media(min-width:520px){.contact-form__row{grid-template-columns:1fr 1fr}}
.contact-form__field{display:flex;flex-direction:column;gap:6px}
.contact-form__field span{font-size:13px;color:#475569;font-weight:500}
.contact-form__field input,.contact-form__field textarea{font:inherit;padding:11px 14px;border:1px solid #e2e8f0;border-radius:9px;background:#fff;color:#0f172a;width:100%;transition:border-color .15s,box-shadow .15s}
.contact-form__field input:focus,.contact-form__field textarea:focus{outline:none;border-color:var(--accent,#0ea5e9);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#0ea5e9) 18%,transparent)}
.contact-form__field textarea{resize:vertical;min-height:96px}
.contact-form__submit{margin-top:6px;padding:13px 22px;background:var(--accent,#0ea5e9);color:#fff;border:0;border-radius:10px;font:inherit;font-weight:600;font-size:15px;cursor:pointer;min-height:48px;transition:filter .15s,transform .15s}
.contact-form__submit:hover{filter:brightness(1.08)}
.contact-form__submit:active{transform:translateY(1px)}
.contact-form__note{margin:0;font-size:12px;color:#94a3b8;line-height:1.5}
.contact-form__success{display:none;margin:0;padding:12px 14px;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;border-radius:10px;font-size:14px}
.contacts-map-section{margin:80px 0 16px;padding-top:24px}
.contacts-map-section h2{margin:0 0 14px;font-size:22px;font-family:inherit}
.contacts-map{border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,.04)}
.contacts-map iframe{display:block;width:100%}
.service-page{max-width:1100px;margin:0 auto;padding:24px}
.service-hero{background:linear-gradient(135deg,color-mix(in srgb,var(--accent,#0ea5e9) 10%,#fff),#fff);border:1px solid #e5e7eb;border-radius:16px;padding:36px 32px;margin:8px 0 28px;box-shadow:0 4px 18px rgba(15,23,42,.04)}
.service-hero h1{margin:0 0 10px;font-size:32px;font-family:inherit;line-height:1.2}
.service-hero__lead{margin:0;color:#475569;font-size:16px;line-height:1.55;max-width:760px}
.service-hero{display:grid;grid-template-columns:1fr;gap:24px;align-items:center}
.service-hero--with-image{grid-template-columns:1fr;padding:0;overflow:hidden;background:#fff}
.service-hero--with-image .service-hero__copy{padding:32px 32px 28px}
.service-hero__media{position:relative;margin:0;width:100%;aspect-ratio:21/9;background:#f1f5f9;overflow:hidden}
.service-hero__media img{width:100%;height:100%;object-fit:cover;display:block}
@media(min-width:860px){.service-hero--with-image{grid-template-columns:1.2fr 1fr}.service-hero--with-image .service-hero__media{height:100%;aspect-ratio:auto;min-height:280px}.service-hero--with-image .service-hero__copy{padding:40px 36px}}
.service-blocks{display:grid;grid-template-columns:1fr;gap:20px;margin:0 0 28px}
@media(min-width:860px){.service-blocks--2col{grid-template-columns:1fr 1fr}}
.service-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:26px 28px;box-shadow:0 4px 18px rgba(15,23,42,.04)}
.service-card h2{margin:0 0 14px;font-size:22px;font-family:inherit;line-height:1.3}
.service-card h3{margin:18px 0 8px;font-size:17px;font-family:inherit}
.service-card p{margin:0 0 12px;color:#334155;line-height:1.65;font-size:15px}
.service-card ul,.service-card ol{margin:0 0 12px;padding-left:22px;color:#334155;line-height:1.65;font-size:15px}
.service-card li{margin:0 0 6px}
.service-card a{color:var(--accent,#0ea5e9);text-decoration:none}
.service-card a:hover{text-decoration:underline}
.service-info-grid{display:grid;grid-template-columns:1fr;gap:12px;margin:8px 0 4px}
@media(min-width:520px){.service-info-grid{grid-template-columns:1fr 1fr}}
.service-info-item{padding:14px 16px;background:#f8fafc;border-radius:10px}
.service-info-item__label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;font-weight:600;margin-bottom:4px}
.service-info-item__value{font-size:15px;color:#0f172a;font-weight:500}
.service-card .bp-pricing-table{margin-top:8px}
${COOKIE_BANNER_CSS}
`;

export function buildHead(c: SiteChrome, m: PageMeta): string {
  const canonical = absUrl(c.domain, m.path);
  const ogImage = m.ogImage || c.ogImageUrl || "";
  const robots = m.noIndex ? "noindex,nofollow" : "index,follow,max-image-preview:large";

  const lds: unknown[] = [websiteLd(c), organizationLd(c), breadcrumbsLd(c, m.breadcrumbs)];
  if (m.type === "article") lds.push(articleLd(c, m));
  lds.push(speakableLd(c, m));
  if (Array.isArray(m.jsonLd)) for (const x of m.jsonLd) lds.push(x);

  const fontsHref = googleFontsHref(c.headingFont, c.bodyFont);

  return `<!DOCTYPE html>
<html lang="${escAttr(c.lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escHtml(m.title)}</title>
  <meta name="description" content="${escAttr(m.description)}">
  <meta name="robots" content="${robots}">
  <meta name="theme-color" content="${escAttr(c.accent)}">
  <link rel="canonical" href="${escAttr(canonical)}">
  <meta property="og:type" content="${m.type === "article" ? "article" : "website"}">
  <meta property="og:title" content="${escAttr(m.title)}">
  <meta property="og:description" content="${escAttr(m.description)}">
  <meta property="og:url" content="${escAttr(canonical)}">
  <meta property="og:site_name" content="${escAttr(c.siteName)}">
  ${ogImage ? `<meta property="og:image" content="${escAttr(ogImage)}">` : ""}
  <meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">
  <meta name="twitter:title" content="${escAttr(m.title)}">
  <meta name="twitter:description" content="${escAttr(m.description)}">
  ${ogImage ? `<meta name="twitter:image" content="${escAttr(ogImage)}">` : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="style" href="${fontsHref}">
  <link rel="stylesheet" href="${fontsHref}" media="print" onload="this.media='all'">
  <noscript><link rel="stylesheet" href="${fontsHref}"></noscript>
  <link rel="stylesheet" href="/style.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.json">
  <link rel="alternate" type="application/rss+xml" title="${escAttr(c.siteName)}" href="/feed.xml">
  <link rel="sitemap" type="application/xml" href="/sitemap.xml">
  ${lds.map((x) => jsonLdScript(x)).join("\n  ")}
</head>`;
}

export function wrapPage(c: SiteChrome, m: PageMeta, mainHtml: string): string {
  const head = buildHead(c, m);
  const pixel = (c.projectId && c.trackerUrl)
    ? `<img src="${escAttr(c.trackerUrl)}?site=${escAttr(c.projectId)}&u=${encodeURIComponent(m.path)}" width="1" height="1" alt="" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade">`
    : "";
  // Floating widgets: back-to-top + online consultant. Consultant identity is
  // taken from the first team member of the project (deterministic per site).
  const lead = (c.teamMembers && c.teamMembers[0]) || null;
  const widgets = renderSiteWidgets({
    lang: c.lang as "ru" | "en",
    accent: c.accent,
    consultantName: lead?.name || (c.companyName || c.siteName),
    consultantPhoto: undefined, // ui-avatars fallback (no FAL on inner pages)
    siteName: c.siteName,
    topic: c.topic,
    totopPosition: c.totopPosition || "left-bottom",
  });
  return `${head}
<body class="${escAttr(m.bodyClass || "")}">
  ${headerHtml(c)}
  ${breadcrumbsHtml(c, m.breadcrumbs)}
  <main class="page">${mainHtml}</main>
  ${footerHtml(c)}
  ${cookieBannerHtml(c.lang, "/privacy.html")}
  <script defer>${COOKIE_BANNER_JS}</script>
  <script defer>${TRUST_JS}</script>
  ${widgets}
  ${pixel}
</body>
</html>`;
}

export function chromeStyles(c: SiteChrome): string {
  return `:root{--accent:${c.accent}}
${CHROME_CSS}
${widgetsCss(c.totopPosition || "left-bottom")}
`;
}

// ---- robots / sitemap ----
export function robotsTxt(c: SiteChrome): string {
  // Allow regular crawlers; block aggressive AI scrapers (GPTBot, ChatGPT-User,
  // CCBot, anthropic-ai, Claude-Web, Google-Extended, etc.). Sitemap pointer
  // helps both classic search engines and AI search to discover the structure.
  return [
    "User-agent: *",
    "Allow: /",
    "",
    "User-agent: GPTBot",
    "Disallow: /",
    "",
    "User-agent: ChatGPT-User",
    "Disallow: /",
    "",
    "User-agent: CCBot",
    "Disallow: /",
    "",
    "User-agent: anthropic-ai",
    "Disallow: /",
    "",
    "User-agent: Claude-Web",
    "Disallow: /",
    "",
    "User-agent: Google-Extended",
    "Disallow: /",
    "",
    `Sitemap: https://${c.domain}/sitemap.xml`,
    "",
  ].join("\n");
}

export interface SitemapPost {
  slug: string;
  publishedAt?: string; // ISO
}

function sitemapEntry(loc: string, lastmod: string, changefreq: string, priority: string): string {
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

export function sitemapXml(c: SiteChrome, postSlugs: string[] | SitemapPost[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const posts: SitemapPost[] = (postSlugs as Array<string | SitemapPost>).map((p) =>
    typeof p === "string" ? { slug: p } : p,
  );
  const blocks = [
    sitemapEntry(`https://${c.domain}/`,             today, "weekly",  "1.0"),
    sitemapEntry(`https://${c.domain}/about.html`,    today, "monthly", "0.8"),
    sitemapEntry(`https://${c.domain}/contacts.html`, today, "monthly", "0.7"),
    sitemapEntry(`https://${c.domain}/privacy.html`,  today, "yearly",  "0.3"),
    sitemapEntry(`https://${c.domain}/terms.html`,    today, "yearly",  "0.3"),
    sitemapEntry(`https://${c.domain}/blog/`,         today, "weekly",  "0.9"),
    ...posts.map((p) => sitemapEntry(
      `https://${c.domain}/posts/${p.slug}.html`,
      (p.publishedAt || today).slice(0, 10),
      "monthly",
      "0.6",
    )),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${blocks.join("\n")}
</urlset>`;
}

// ---- llms.txt — AI-friendly site index (2024-2025 standard) ----
// https://llmstxt.org — discoverable map for LLM-based search engines.
export function llmsTxt(
  c: SiteChrome,
  posts: SitemapPost[] = [],
  extraPaths: { path: string; title: string; description?: string }[] = [],
): string {
  const url = (p: string) => `https://${c.domain}${p}`;
  const lines: string[] = [];
  lines.push(`# ${c.siteName}`);
  if (c.siteAbout) lines.push(`> ${stripTags(c.siteAbout).slice(0, 280)}`);
  lines.push("");
  lines.push("## Pages");
  lines.push(`- [${c.lang === "ru" ? "Главная" : "Home"}](${url("/")}): ${c.lang === "ru" ? "главная страница" : "homepage"} — ${c.siteName}`);
  lines.push(`- [${c.lang === "ru" ? "О нас" : "About"}](${url("/about.html")}): ${c.lang === "ru" ? "информация о компании и команде" : "about the company and team"}`);
  lines.push(`- [${c.lang === "ru" ? "Контакты" : "Contacts"}](${url("/contacts.html")}): ${c.lang === "ru" ? "контактные данные и адрес" : "contact information and address"}`);
  lines.push(`- [${c.lang === "ru" ? "Блог" : "Blog"}](${url("/blog/")}): ${c.lang === "ru" ? "статьи по теме «" + c.topic + "»" : "articles about " + c.topic}`);
  for (const ex of extraPaths) {
    lines.push(`- [${ex.title}](${url(ex.path)})${ex.description ? `: ${ex.description}` : ""}`);
  }
  if (posts.length) {
    lines.push("");
    lines.push(c.lang === "ru" ? "## Статьи блога" : "## Blog posts");
    for (const p of posts.slice(0, 50)) {
      lines.push(`- [${p.slug.replace(/-/g, " ")}](${url("/posts/" + p.slug + ".html")})`);
    }
  }
  lines.push("");
  lines.push("## About");
  const year = c.foundingYear ? String(c.foundingYear) : (c.lang === "ru" ? "момента запуска" : "launch");
  const who = c.companyName || c.siteName;
  if (c.lang === "ru") {
    lines.push(`${who} работает с ${year}. Специализация: ${c.topic}.`);
    if (c.legalAddress || c.companyAddress) lines.push(`Регион: ${c.legalAddress || c.companyAddress}.`);
  } else {
    lines.push(`${who} has been operating since ${year}. Focus area: ${c.topic}.`);
    if (c.legalAddress || c.companyAddress) lines.push(`Region: ${c.legalAddress || c.companyAddress}.`);
  }
  lines.push("");
  return lines.join("\n");
}

function stripTags(s: string): string {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Pull a 2-3 sentence direct answer from the article. Prefer the AI-written
// excerpt (meta_description); otherwise fall back to the first paragraph of
// the article body. Cap at ~280 chars to stay in the "first 100 words" zone
// preferred by AI search engines.
function buildAiSummary(excerpt: string | undefined, html: string, isRu: boolean): string {
  const fromExcerpt = String(excerpt || "").trim();
  let raw = fromExcerpt;
  if (!raw) {
    // First <p>...</p> in the body, fallback to plain stripped text.
    const m = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    raw = m ? m[1] : html;
    raw = stripTags(raw);
  }
  if (!raw) return "";
  // Take first 2-3 sentences.
  const parts = raw.split(/(?<=[.!?…])\s+/).filter(Boolean);
  let out = parts.slice(0, 3).join(" ");
  if (out.length > 320) out = out.slice(0, 300).replace(/\s+\S*$/, "") + "…";
  // Avoid duplicating the H1.
  if (out.length < 30) return "";
  return isRu ? out : out;
}

// ---- Page builders for non-content pages ----

function home(c: SiteChrome) {
  return [
    { label: c.lang === "ru" ? "Главная" : "Home", href: "/" },
  ];
}

// Split arbitrary HTML into card blocks by <h2>. Returns at least one block.
// Drops the <h2> tag itself and stores its plain-text content as `heading`.
export function splitIntoBlocks(html: string): { heading: string; body: string }[] {
  const src = String(html || "").trim();
  if (!src) return [{ heading: "", body: "" }];
  const parts = src.split(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  // parts: [before, head1, body1, head2, body2, ...]
  const out: { heading: string; body: string }[] = [];
  const before = (parts[0] || "").trim();
  if (before) out.push({ heading: "", body: before });
  for (let i = 1; i < parts.length; i += 2) {
    const heading = String(parts[i] || "").replace(/<[^>]+>/g, "").trim();
    const body = String(parts[i + 1] || "").trim();
    if (heading || body) out.push({ heading, body });
  }
  if (out.length === 0) out.push({ heading: "", body: src });
  return out;
}

// Topical hero photo for inner pages. Uses Unsplash Source (no API key) and
// derives keywords from the site niche + page-specific seed (about/contacts/
// portfolio/pricing/reviews/faq/vacancies). Returns a wide 1600x720 image.
function pageImage(c: SiteChrome, slot: string, w = 1600, h = 720): string {
  // source.unsplash.com is deprecated and frequently returns 503 - fall back
  // to picsum.photos with a deterministic seed so each (site, slot) gets a
  // stable, always-loading image.
  let h32 = 2166136261 >>> 0;
  const seed = `${c.domain || c.siteName}::${c.topic || ""}::${slot}`;
  for (let i = 0; i < seed.length; i++) {
    h32 ^= seed.charCodeAt(i);
    h32 = Math.imul(h32, 16777619) >>> 0;
  }
  return `https://picsum.photos/seed/${h32.toString(36)}/${w}/${h}`;
}

export function buildAboutPage(c: SiteChrome): string {
  const isRu = c.lang === "ru";
  const title = `${isRu ? "О нас" : "About"} · ${c.siteName}`;
  const desc  = (c.aboutHtml || c.siteAbout || c.siteName).replace(/<[^>]+>/g, " ").trim().slice(0, 160);
  const team  = (c.teamMembers || []).slice(0, 4);
  const teamHtml = team.length ? `
    <section class="service-card">
      <h2>${isRu ? "Команда редакции" : "Team"}</h2>
      <div class="team-grid">
        ${team.map((t) => `
          <div class="team-card">
            <h3>${escHtml(t.name)}</h3>
            <div class="role">${escHtml(t.role || "")}</div>
            ${t.bio ? `<p>${escHtml(t.bio)}</p>` : ""}
          </div>`).join("")}
      </div>
    </section>` : "";

  const aboutBlocks = splitIntoBlocks(c.aboutHtml || `<p>${escHtml(c.siteAbout)}</p>`);
  const factsItems: string[] = [];
  if (c.foundingYear)   factsItems.push(`<div class="service-info-item"><span class="service-info-item__label">${isRu ? "Работаем с" : "Since"}</span><span class="service-info-item__value">${c.foundingYear}</span></div>`);
  if (c.companyName)    factsItems.push(`<div class="service-info-item"><span class="service-info-item__label">${isRu ? "Компания" : "Company"}</span><span class="service-info-item__value">${escHtml(c.companyName)}</span></div>`);
  if (c.companyAddress) factsItems.push(`<div class="service-info-item"><span class="service-info-item__label">${isRu ? "Офис" : "Office"}</span><span class="service-info-item__value">${escHtml(c.companyAddress)}</span></div>`);
  if (c.clientsCountText) factsItems.push(`<div class="service-info-item"><span class="service-info-item__label">${isRu ? "Клиенты" : "Clients"}</span><span class="service-info-item__value">${escHtml(c.clientsCountText)}</span></div>`);
  const factsHtml = factsItems.length ? `
    <section class="service-card">
      <h2>${isRu ? "Коротко о нас" : "At a glance"}</h2>
      <div class="service-info-grid">${factsItems.join("")}</div>
    </section>` : "";

  const main = `
    <article class="service-page">
      <header class="service-hero service-hero--with-image">
        <div class="service-hero__copy">
          <h1>${escHtml(isRu ? "О нас" : "About us")}</h1>
          <p class="service-hero__lead">${escHtml(c.siteAbout || c.siteName)}</p>
        </div>
        <figure class="service-hero__media">
          <img src="${escAttr(pageImage(c, "about"))}" alt="${escAttr(isRu ? "О нас" : "About us")}" loading="lazy" width="1600" height="720">
        </figure>
      </header>
      ${factsHtml}
      <div class="service-blocks">
        ${aboutBlocks.map((b) => `<section class="service-card">${b.heading ? `<h2>${escHtml(b.heading)}</h2>` : ""}${b.body}</section>`).join("")}
      </div>
      ${teamHtml}
    </article>`;
  return wrapPage(c, {
    title, description: desc, path: "/about.html", type: "website",
    breadcrumbs: [...home(c), { label: isRu ? "О нас" : "About", href: "/about.html" }],
    bodyClass: "page-about",
  }, main);
}

export function buildContactsPage(c: SiteChrome): string {
  const isRu = c.lang === "ru";
  const title = `${isRu ? "Контакты" : "Contacts"} · ${c.siteName}`;
  const phoneClean = c.companyPhone ? c.companyPhone.replace(/[^+\d]/g, "") : "";
  const items: string[] = [];
  if (c.companyName)    items.push(`<div class="contact-item"><span class="contact-item__label">${isRu ? "Компания" : "Company"}</span><span class="contact-item__value">${escHtml(c.companyName)}</span></div>`);
  if (c.companyAddress) items.push(`<div class="contact-item"><span class="contact-item__label">${isRu ? "Адрес" : "Address"}</span><span class="contact-item__value">${escHtml(c.companyAddress)}</span></div>`);
  if (c.companyPhone)   items.push(`<div class="contact-item"><span class="contact-item__label">${isRu ? "Телефон" : "Phone"}</span><a class="contact-item__value" href="tel:${escAttr(phoneClean)}">${escHtml(c.companyPhone)}</a></div>`);
  if (c.companyEmail)   items.push(`<div class="contact-item"><span class="contact-item__label">Email</span><a class="contact-item__value" href="mailto:${escAttr(c.companyEmail)}">${escHtml(c.companyEmail)}</a></div>`);
  if (c.workHours)      items.push(`<div class="contact-item"><span class="contact-item__label">${isRu ? "Время работы" : "Hours"}</span><span class="contact-item__value">${escHtml(c.workHours)}</span></div>`);

  const mapQuery = encodeURIComponent(c.companyAddress || c.companyName || c.siteName);
  const mapUrl = c.companyAddress
    ? `https://maps.google.com/maps?q=${mapQuery}&t=&z=14&ie=UTF8&iwloc=&output=embed`
    : "";

  const formLabels = isRu
    ? { name: "Имя", phone: "Телефон", email: "Email", message: "Сообщение", submit: "Отправить заявку", title: "Оставьте заявку", subtitle: "Свяжемся с вами в течение рабочего дня.", success: "Спасибо! Заявка отправлена.", privacyNote: "Нажимая кнопку, вы соглашаетесь с политикой конфиденциальности.", contactsTitle: "Наши контакты", mapTitle: "Как нас найти" }
    : { name: "Name", phone: "Phone", email: "Email", message: "Message", submit: "Send request", title: "Get in touch", subtitle: "We will get back to you within one business day.", success: "Thanks! Your request has been sent.", privacyNote: "By submitting you agree to our privacy policy.", contactsTitle: "Our details", mapTitle: "Find us on the map" };

  const main = `
    <article class="page-article contacts-page">
      <h1>${isRu ? "Контакты" : "Contacts"}</h1>
      <figure class="service-hero__media" style="border-radius:14px;margin:0 0 22px;aspect-ratio:21/9;border:1px solid #e5e7eb">
        <img src="${escAttr(pageImage(c, "contacts"))}" alt="${escAttr(isRu ? "Наш офис" : "Our office")}" loading="lazy" width="1600" height="720">
      </figure>
      ${c.contactsHtml || `<p>${escHtml(isRu ? "Напишите нам или позвоните в рабочие часы - ответим оперативно." : "Reach out to us during business hours - we reply quickly.")}</p>`}

      <div class="contacts-grid">
        <section class="contacts-card contacts-card--info">
          <h2>${escHtml(formLabels.contactsTitle)}</h2>
          <div class="contact-list-v2">${items.join("")}</div>
        </section>

        <section class="contacts-card contacts-card--form">
          <h2>${escHtml(formLabels.title)}</h2>
          <p class="contacts-card__subtitle">${escHtml(formLabels.subtitle)}</p>
          <form class="contact-form" id="contact-form" novalidate onsubmit="event.preventDefault();var f=this;var ok=document.getElementById('contact-form-ok');if(ok){ok.style.display='block';}f.reset();return false;">
            <div class="contact-form__row">
              <label class="contact-form__field">
                <span>${escHtml(formLabels.name)} *</span>
                <input type="text" name="name" required maxlength="80" autocomplete="name">
              </label>
              <label class="contact-form__field">
                <span>${escHtml(formLabels.phone)} *</span>
                <input type="tel" name="phone" required maxlength="40" autocomplete="tel">
              </label>
            </div>
            <label class="contact-form__field">
              <span>Email</span>
              <input type="email" name="email" maxlength="120" autocomplete="email">
            </label>
            <label class="contact-form__field">
              <span>${escHtml(formLabels.message)}</span>
              <textarea name="message" rows="4" maxlength="2000"></textarea>
            </label>
            <button type="submit" class="contact-form__submit">${escHtml(formLabels.submit)}</button>
            <p class="contact-form__note">${escHtml(formLabels.privacyNote)}</p>
            <p class="contact-form__success" id="contact-form-ok" role="status">${escHtml(formLabels.success)}</p>
          </form>
        </section>
      </div>

      ${mapUrl ? `
      <section class="contacts-map-section">
        <h2>${escHtml(formLabels.mapTitle)}</h2>
        <div class="contacts-map">
          <iframe src="${escAttr(mapUrl)}" width="100%" height="380" style="border:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${escAttr(formLabels.mapTitle)}"></iframe>
        </div>
      </section>` : ""}
    </article>`;
  return wrapPage(c, {
    title, description: (isRu ? "Контакты сайта " : "Contact details for ") + c.siteName,
    path: "/contacts.html", type: "website",
    breadcrumbs: [...home(c), { label: isRu ? "Контакты" : "Contacts", href: "/contacts.html" }],
    bodyClass: "page-contacts",
    jsonLd: [localBusinessLd(c)],
  }, main);
}

export function buildPrivacyPage(c: SiteChrome): string {
  const isRu = c.lang === "ru";
  const title = `${isRu ? "Политика конфиденциальности" : "Privacy policy"} · ${c.siteName}`;
  const cookiesNote = isRu
    ? `<p>Сайт использует cookies для корректной работы и анонимной аналитики. Вы можете принять или отклонить их в баннере при первом визите. Согласие сохраняется в localStorage вашего браузера.</p>`
    : `<p>The site uses cookies for proper operation and anonymous analytics. You can accept or reject them in the banner on your first visit. Your choice is saved in your browser's localStorage.</p>`;
  const lead = isRu
    ? "Мы заботимся о ваших персональных данных и обрабатываем их только для целей, описанных ниже."
    : "We take your personal data seriously and process it only for the purposes described below.";
  const blocks = splitIntoBlocks((c.privacyHtml || `<p>${escHtml(isRu ? "Мы уважаем вашу конфиденциальность." : "We respect your privacy.")}</p>`) + `\n<h2>${isRu ? "Cookies" : "Cookies"}</h2>\n${cookiesNote}`);
  const main = `
    <article class="service-page">
      <header class="service-hero">
        <h1>${isRu ? "Политика конфиденциальности" : "Privacy policy"}</h1>
        <p class="service-hero__lead">${escHtml(lead)}</p>
      </header>
      <div class="service-blocks">
        ${blocks.map((b) => `<section class="service-card">${b.heading ? `<h2>${escHtml(b.heading)}</h2>` : ""}${b.body}</section>`).join("")}
      </div>
    </article>`;
  return wrapPage(c, {
    title, description: (isRu ? "Политика конфиденциальности сайта " : "Privacy policy for ") + c.siteName,
    path: "/privacy.html", type: "website",
    breadcrumbs: [...home(c), { label: isRu ? "Конфиденциальность" : "Privacy", href: "/privacy.html" }],
    bodyClass: "page-privacy",
  }, main);
}

export function buildTermsPage(c: SiteChrome): string {
  const isRu = c.lang === "ru";
  const title = `${isRu ? "Пользовательское соглашение" : "Terms of use"} · ${c.siteName}`;
  const lead = isRu
    ? "Используя этот сайт, вы соглашаетесь с условиями, описанными в разделах ниже."
    : "By using this site, you agree to the terms described in the sections below.";
  const blocks = splitIntoBlocks(c.termsHtml || `<p>${escHtml(isRu ? "Все материалы носят информационный характер." : "All materials are for informational purposes only.")}</p>`);
  const main = `
    <article class="service-page">
      <header class="service-hero">
        <h1>${isRu ? "Пользовательское соглашение" : "Terms of use"}</h1>
        <p class="service-hero__lead">${escHtml(lead)}</p>
      </header>
      <div class="service-blocks">
        ${blocks.map((b) => `<section class="service-card">${b.heading ? `<h2>${escHtml(b.heading)}</h2>` : ""}${b.body}</section>`).join("")}
      </div>
    </article>`;
  return wrapPage(c, {
    title, description: (isRu ? "Пользовательское соглашение сайта " : "Terms for ") + c.siteName,
    path: "/terms.html", type: "website",
    breadcrumbs: [...home(c), { label: isRu ? "Соглашение" : "Terms", href: "/terms.html" }],
    bodyClass: "page-terms",
  }, main);
}

// ---- Per-post page (article schema, breadcrumbs, related posts) ----

export interface PostInput {
  title: string;
  slug: string;
  excerpt: string;
  contentHtml: string;
  publishedAt?: string;
  featuredImageUrl?: string;
}

// Pick a stable author for a post based on its slug — keeps assignment
// consistent across deploys without needing a DB column.
export function pickAuthor(authors: Author[] | undefined, slug: string): Author | null {
  if (!authors || authors.length === 0) return null;
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return authors[h % authors.length];
}

function dicebearUrl(seed: string): string {
  const s = encodeURIComponent(seed || "author");
  return `https://api.dicebear.com/7.x/initials/svg?seed=${s}&backgroundType=gradientLinear&fontWeight=600`;
}

// Avatar style requested for author cards (avataaars, more illustrative)
function avataarsUrl(seed: string): string {
  const s = encodeURIComponent(seed || "author");
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${s}`;
}

// Strip any <script> blocks from AI-returned HTML — JSON-LD must live in <head>,
// never inside the article body.
function stripScripts(html: string): string {
  return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, "");
}

// If the AI returned escaped HTML (e.g. "&lt;p&gt;text&lt;/p&gt;") instead of
// real markup, decode the common entities so it renders as HTML, not text.
function unescapeIfEscapedHtml(html: string): string {
  const s = String(html || "");
  // Heuristic: many "&lt;" sequences and almost no real "<" tags → escaped.
  const escapedTagCount = (s.match(/&lt;\/?[a-z][a-z0-9]*[^&]{0,80}&gt;/gi) || []).length;
  const realTagCount    = (s.match(/<\/?[a-z][a-z0-9]*[^>]{0,80}>/gi) || []).length;
  if (escapedTagCount > 3 && escapedTagCount > realTagCount * 2) {
    return s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  }
  return s;
}

// Slugify (ASCII) — used for H2 anchor ids in TOC.
function slugifyAnchor(text: string, fallbackIdx: number): string {
  const map: Record<string, string> = {
    а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ж:"zh",з:"z",и:"i",й:"j",к:"k",л:"l",
    м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",
    ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
  };
  const ascii = String(text || "").toLowerCase()
    .split("").map((c) => map[c] ?? c).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return ascii || `section-${fallbackIdx + 1}`;
}

// Walk the HTML, add id="section-N" to every <h2>, return new HTML + TOC entries.
function injectH2IdsAndCollectToc(html: string): { html: string; toc: { id: string; label: string }[] } {
  const toc: { id: string; label: string }[] = [];
  let idx = 0;
  const out = html.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/gi, (_m, attrs = "", inner) => {
    const label = String(inner).replace(/<[^>]+>/g, "").trim();
    const id = `section-${++idx}`;
    toc.push({ id, label });
    // Drop any existing id attribute, then add ours.
    const cleanedAttrs = String(attrs || "").replace(/\sid="[^"]*"/i, "");
    return `<h2${cleanedAttrs} id="${id}">${inner}</h2>`;
  });
  return { html: out, toc };
}

function tocHtml(toc: { id: string; label: string }[], isRu: boolean): string {
  if (toc.length < 2) return "";
  return `<nav class="toc" aria-label="${isRu ? "Содержание" : "Contents"}">
    <h3>${isRu ? "Содержание" : "Contents"}</h3>
    <ol>${toc.map((t) => `<li><a href="#${t.id}">${escHtml(t.label)}</a></li>`).join("")}</ol>
  </nav>`;
}

// Convert a contiguous H3?/P pair sequence under a "FAQ"-style H2 into a
// <details>/<summary> accordion. We detect a section that starts with an H2
// whose text contains "FAQ"/"вопрос"/"вопросы", grab subsequent H3+P pairs,
// and rewrite that block.
function renderFaqAccordion(html: string, isRu: boolean): string {
  // Find any <h2>...FAQ.../вопросы...</h2> followed by H3/P pairs until next H2.
  const re = /<h2(\s[^>]*)?>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2|<\/article|$)/gi;
  return html.replace(re, (full, attrs, label, body) => {
    const labelText = String(label).replace(/<[^>]+>/g, "").toLowerCase();
    const isFaq = /\bfaq\b|вопрос|вопросы|q ?& ?a/i.test(labelText);
    if (!isFaq) return full;
    const pairs: { q: string; a: string }[] = [];
    const pairRe = /<h3[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/gi;
    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(body)) !== null) {
      pairs.push({ q: m[1].replace(/<[^>]+>/g, "").trim(), a: m[2].trim() });
    }
    if (pairs.length < 2) return full; // not really an FAQ
    const items = pairs.map((p) =>
      `<details class="faq-item"><summary>${escHtml(p.q)}</summary><div class="faq-answer">${p.a}</div></details>`
    ).join("");
    return `<h2${attrs || ""}>${label}</h2>
      <div class="faq-accordion" itemscope itemtype="https://schema.org/FAQPage">${items}</div>`;
  });
}

// Inject up to 3 inline links in the article body.
// Priority order:
//   1) User-provided external `injectionLinks` (URL + custom anchor) from project settings.
//   2) Internal interlinks to other posts of the same site (anchor = 1-3 words from title).
// Each link is placed inside a <p>, never in headings/lists/existing <a>.
// At most one link per paragraph; total ≤ 3.
function injectInlineInterlinks(
  html: string,
  related: PostInput[],
  external: { url: string; anchor: string }[] = [],
): string {
  const HARD_MAX = 3;
  let out = html;
  let inserted = 0;
  // Track paragraphs already used (by their opening tag offset) to enforce 1/paragraph.
  const usedParagraphs = new Set<number>();

  // Find a paragraph that contains the anchor and isn't already used; insert <a>.
  function placeLink(anchor: string, href: string, cls: string, rel?: string): boolean {
    if (!anchor || anchor.length < 3) return false;
    const safe = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Word boundary works for ASCII; for Cyrillic fall back to a soft boundary.
    const isCyr = /[А-Яа-яЁё]/.test(anchor);
    const boundary = isCyr ? "(?:^|[\\s.,;:!?\"«»()\\-—])" : "\\b";
    const re = new RegExp(
      `(<p[^>]*>(?:(?!<\\/p>|<a\\s).)*?)(${boundary})(${safe})`,
      "i",
    );
    let placed = false;
    out = out.replace(re, (match, pre, bnd, hit, offset: number) => {
      if (placed) return match;
      // Find paragraph start to dedupe.
      const pStart = out.lastIndexOf("<p", offset);
      if (usedParagraphs.has(pStart)) return match;
      usedParagraphs.add(pStart);
      placed = true;
      const relAttr = rel ? ` rel="${rel}"` : "";
      return `${pre}${bnd}<a href="${href}" class="${cls}"${relAttr}>${hit}</a>`;
    });
    return placed;
  }

  // 1) External user-provided links (highest priority).
  for (const link of external) {
    if (inserted >= HARD_MAX) break;
    const url = String(link?.url || "").trim();
    const anchor = String(link?.anchor || "").trim();
    if (!url || !anchor) continue;
    // If anchor isn't found verbatim, try to "force" it into the first eligible paragraph.
    const ok = placeLink(anchor, url, "inline-link external", "nofollow noopener");
    if (ok) {
      inserted++;
      continue;
    }
    // Forced fallback: append the anchor as a sentence at the end of the first
    // paragraph that hasn't been used yet, so the link is guaranteed to appear.
    const re = new RegExp(`<p([^>]*)>((?:(?!<\\/p>).)*?)<\\/p>`, "i");
    let forced = false;
    out = out.replace(re, (match, attrs: string, inner: string, offset: number) => {
      if (forced) return match;
      const pStart = out.indexOf(match, Math.max(0, offset - 5));
      if (usedParagraphs.has(pStart)) return match;
      usedParagraphs.add(pStart);
      forced = true;
      const sep = inner.trim().endsWith(".") ? " " : ". ";
      return `<p${attrs}>${inner}${sep}<a href="${url}" class="inline-link external" rel="nofollow noopener">${anchor}</a>.</p>`;
    });
    if (forced) inserted++;
  }

  // 2) Internal interlinks to related posts (fill remaining slots).
  function anchorFor(p: PostInput): string {
    const title = String(p.title || "").replace(/[«»"().,:;!?\-—]/g, " ").trim();
    const words = title.split(/\s+/).filter((w) => w.length >= 4);
    if (words.length === 0) return title.split(/\s+/).slice(0, 2).join(" ");
    return words.slice(0, Math.min(3, words.length)).join(" ");
  }
  const usedSlugs = new Set<string>();
  for (const p of related) {
    if (inserted >= HARD_MAX) break;
    if (usedSlugs.has(p.slug)) continue;
    const anchor = anchorFor(p);
    if (placeLink(anchor, `/posts/${p.slug}.html`, "inline-link")) {
      usedSlugs.add(p.slug);
      inserted++;
    }
  }

  return out;
}

// Author card with Schema.org Person microdata.
function authorCardHtml(c: SiteChrome, author: Author | null): string {
  if (!author) return "";
  const isRu = c.lang === "ru";
  const img = avataarsUrl(author.avatar_seed || author.name);
  return `<aside class="author-card" itemscope itemtype="https://schema.org/Person">
    <img itemprop="image" src="${escAttr(img)}" alt="${escAttr(author.name)}" width="80" height="80" loading="lazy">
    <div class="author-info">
      <h4 itemprop="name">${escHtml(author.name)}</h4>
      ${author.role ? `<p class="author-title" itemprop="jobTitle">${escHtml(author.role)}</p>` : ""}
      ${author.bio ? `<p class="author-bio" itemprop="description">${escHtml(author.bio)}</p>` : ""}
      <meta itemprop="url" content="https://${c.domain}/about.html">
      <a href="/about.html" class="author-more">${isRu ? "Все статьи автора" : "All posts by author"}</a>
    </div>
  </aside>`;
}

function authorMetaHtml(c: SiteChrome, author: Author | null, publishedAt?: string): string {
  const isRu = c.lang === "ru";
  const dateStr = publishedAt
    ? new Date(publishedAt).toLocaleDateString(isRu ? "ru-RU" : "en-US",
        { year: "numeric", month: "long", day: "numeric" })
    : "";
  const dateTime = publishedAt ? new Date(publishedAt).toISOString() : "";
  if (!author) {
    // No author — still show the date if we have one, so posts don't look "live today".
    if (!dateStr) return "";
    return `<div class="author-meta"><time datetime="${escAttr(dateTime)}" style="font-size:13px;color:#888">${escHtml(dateStr)}</time></div>`;
  }
  return `<div class="author-meta">
    <img src="${escAttr(dicebearUrl(author.avatar_seed || author.name))}" alt="${escAttr(author.name)}" loading="lazy" width="40" height="40">
    <div>
      <div><strong>${escHtml(author.name)}</strong>${author.role ? ` <span style="color:#888">· ${escHtml(author.role)}</span>` : ""}</div>
      ${dateStr ? `<time datetime="${escAttr(dateTime)}" style="font-size:13px;color:#888">${escHtml(dateStr)}</time>` : ""}
    </div>
  </div>`;
}

function shareBarHtml(c: SiteChrome, path: string, title: string): string {
  const isRu = c.lang === "ru";
  const url = encodeURIComponent(absUrl(c.domain, path));
  const t = encodeURIComponent(title);
  return `<div class="share-bar" aria-label="${isRu ? "Поделиться" : "Share"}">
    <a href="https://t.me/share/url?url=${url}&text=${t}" rel="nofollow noopener" target="_blank">Telegram</a>
    <a href="https://wa.me/?text=${t}%20${url}" rel="nofollow noopener" target="_blank">WhatsApp</a>
    <a href="https://twitter.com/intent/tweet?url=${url}&text=${t}" rel="nofollow noopener" target="_blank">Twitter</a>
    <a href="https://vk.com/share.php?url=${url}&title=${t}" rel="nofollow noopener" target="_blank">${isRu ? "ВКонтакте" : "VK"}</a>
  </div>`;
}

export function buildPostPage(
  c: SiteChrome,
  post: PostInput,
  related: PostInput[],
): string {
  const isRu = c.lang === "ru";
  const title = `${post.title} · ${c.siteName}`;
  const desc  = post.excerpt || (post.contentHtml || "").replace(/<[^>]+>/g, " ").trim().slice(0, 160);
  const author = pickAuthor(c.authors, post.slug);
  const authorImage = author ? avataarsUrl(author.avatar_seed || author.name) : undefined;
  const authorJsonLd = author ? {
    "@context": "https://schema.org",
    "@type": "Person",
    name: author.name,
    jobTitle: author.role || undefined,
    description: author.bio || undefined,
    image: authorImage,
    url: `https://${c.domain}/about.html`,
  } : null;

  // 1) clean AI output: strip <script> blocks, decode escaped HTML if needed
  let body = stripScripts(unescapeIfEscapedHtml(post.contentHtml || ""));
  // 2) add ids to H2s and collect TOC
  const { html: bodyWithIds, toc } = injectH2IdsAndCollectToc(body);
  body = bodyWithIds;
  // 3) FAQ → accordion
  body = renderFaqAccordion(body, isRu);
  // 4) inline interlinks: priority to user-provided external links, then internal posts
  body = injectInlineInterlinks(body, related, c.injectionLinks || []);

  // FAQ schema for any FAQ section we found
  const faqPairsForLd = extractFaqPairs(body);
  const extraLd: Record<string, unknown>[] = [];
  if (authorJsonLd) extraLd.push(authorJsonLd as Record<string, unknown>);
  if (faqPairsForLd.length >= 2) {
    extraLd.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqPairsForLd.map((p) => ({
        "@type": "Question", name: p.q,
        acceptedAnswer: { "@type": "Answer", text: p.a },
      })),
    });
  }

  const articleCss = `
.page-article{max-width:760px;margin:0 auto;padding:32px 24px;font-family:"${c.bodyFont}",system-ui,sans-serif;line-height:1.75;font-size:17px;color:#1a1a1a}
.page-article h1{font-family:"${c.headingFont}",sans-serif;font-size:36px;line-height:1.2;margin:8px 0 16px}
.page-article h2{font-family:"${c.headingFont}",sans-serif;font-size:26px;margin:32px 0 12px}
.page-article h3{font-family:"${c.headingFont}",sans-serif;font-size:21px;margin:24px 0 10px}
.page-article p{margin:0 0 16px}
.page-article a{color:${c.accent};text-decoration:underline}
.page-article ul,.page-article ol{margin:0 0 16px 24px}
.page-article blockquote{border-left:3px solid ${c.accent};padding:8px 16px;margin:16px 0;color:#444;background:#fafafa}
.page-article img{margin:16px 0;border-radius:8px;max-width:100%;height:auto}
.page-article .post-hero{width:100%;aspect-ratio:2/1;object-fit:cover;border-radius:12px;margin:0 0 24px}
.contact-list{list-style:none;padding:0;margin:16px 0}
.contact-list li{padding:8px 0;border-bottom:1px solid #eee}
.toc{background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;margin:0 0 28px;font-size:15px}
.toc h3{margin:0 0 10px;font-family:"${c.headingFont}",sans-serif;font-size:16px;text-transform:uppercase;letter-spacing:.06em;color:#475569}
.toc ol{margin:0;padding-left:20px}
.toc li{margin:4px 0}
.toc a{color:${c.accent};text-decoration:none}
.toc a:hover{text-decoration:underline}
.faq-accordion{margin:16px 0 24px;border-top:1px solid #e5e7eb}
.faq-item{border-bottom:1px solid #e5e7eb;padding:0}
.faq-item summary{list-style:none;cursor:pointer;padding:14px 0;font-weight:600;color:#0f172a;display:flex;justify-content:space-between;align-items:center;font-size:16px}
.faq-item summary::-webkit-details-marker{display:none}
.faq-item summary::after{content:"+";color:${c.accent};font-size:22px;line-height:1;font-weight:400;transition:transform .2s}
.faq-item[open] summary::after{content:"−"}
.faq-answer{padding:0 0 16px;color:#444;font-size:15px}
.author-card{display:flex;gap:18px;align-items:flex-start;margin:40px 0 0;padding:20px 22px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px}
.author-card img{width:72px;height:72px;border-radius:50%;background:#e2e8f0;flex:0 0 auto;margin:0}
.author-info h4{margin:0 0 2px;font-family:"${c.headingFont}",sans-serif;font-size:17px;color:#0f172a}
.author-info .author-title{margin:0 0 8px;color:#64748b;font-size:13px}
.author-info .author-bio{margin:0 0 8px;color:#444;font-size:14px;line-height:1.5}
.author-info .author-more{font-size:13px;color:${c.accent};text-decoration:none}
.author-info .author-more:hover{text-decoration:underline}
.inline-link{color:${c.accent};text-decoration:underline;text-underline-offset:2px}
.ai-summary{margin:18px 0 24px;padding:16px 20px;background:linear-gradient(135deg,${c.accent}10,${c.accent}05);border-left:4px solid ${c.accent};border-radius:8px}
.ai-summary__label{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${c.accent};margin:0 0 6px}
.ai-summary p{margin:0;font-size:16px;line-height:1.6;color:#0f172a;font-weight:500}
.page-article table,.page-article .md-table{width:100%;border-collapse:collapse;margin:20px 0;font-size:15px;display:table;overflow-x:auto}
.page-article th,.page-article td{border:1px solid #e5e7eb;padding:10px 14px;text-align:left;vertical-align:top}
.page-article thead th{background:#f8fafc;font-weight:600;color:#0f172a}
.page-article tbody tr:nth-child(even){background:#fafbfc}
@media(max-width:640px){.page-article table{font-size:14px}.page-article th,.page-article td{padding:8px 10px}}
`;
  // Hero image: prefer the article's own featured image (FAL.ai-generated and
  // stored on the row), fall back to a stable Picsum seed if none exists yet.
  const heroSeed = encodeURIComponent(post.slug || post.title || "post").slice(0, 60);
  const heroUrl  = post.featuredImageUrl && /^https?:\/\//.test(post.featuredImageUrl)
    ? post.featuredImageUrl
    : `https://picsum.photos/seed/${heroSeed}/1200/600`;
  const heroImg  = `<img class="post-hero" src="${escAttr(heroUrl)}" alt="${escAttr(post.title)}" loading="eager" width="1200" height="600">`;

  // AI Summary — short direct answer in the first ~100 words. Optimised for
  // AI search engines (Perplexity, ChatGPT Search, Gemini, Яндекс AI) and
  // voice assistants — referenced by the Speakable JSON-LD selector.
  const aiSummaryText = buildAiSummary(post.excerpt, post.contentHtml || "", isRu);
  const aiSummaryHtml = aiSummaryText
    ? `<aside class="ai-summary"><div class="ai-summary__label">${isRu ? "Коротко о главном" : "Quick answer"}</div><p>${escHtml(aiSummaryText)}</p></aside>`
    : "";

  const relatedHtml = related.length ? `
    <aside class="related-posts">
      <h2>${isRu ? "Читайте также" : "Related posts"}</h2>
      <ul>${related.slice(0, 5).map((r) => `<li><a href="/posts/${r.slug}.html">${escHtml(r.title)}</a></li>`).join("")}</ul>
    </aside>` : "";

  const head = buildHead(c, {
    title, description: desc, path: `/posts/${post.slug}.html`, type: "article",
    ogImage: heroUrl,
    publishedTime: post.publishedAt,
    breadcrumbs: [
      { label: isRu ? "Главная" : "Home", href: "/" },
      { label: isRu ? "Блог" : "Blog", href: "/" },
      { label: post.title, href: `/posts/${post.slug}.html` },
    ],
    jsonLd: extraLd.length ? extraLd : undefined,
  });
  return `${head}
<style>${articleCss}</style>
<body class="page-post">
  ${headerHtml(c)}
  ${breadcrumbsHtml(c, [
    { label: isRu ? "Главная" : "Home", href: "/" },
    { label: post.title, href: `/posts/${post.slug}.html` },
  ])}
  <main class="page">
    <article class="page-article">
      <h1>${escHtml(post.title)}</h1>
      ${authorMetaHtml(c, author, post.publishedAt)}
      ${aiSummaryHtml}
      ${heroImg}
      ${tocHtml(toc, isRu)}
      ${body}
      ${authorCardHtml(c, author)}
      ${shareBarHtml(c, `/posts/${post.slug}.html`, post.title)}
    </article>
    ${relatedHtml}
  </main>
  ${footerHtml(c)}
  ${cookieBannerHtml(c.lang, "/privacy.html")}
  <script defer>${COOKIE_BANNER_JS}</script>
  <script defer>${TRUST_JS}</script>
</body>
</html>`;
}

// ---- Index page wrapper used by both renderers as a fallback ----

export function buildIndexHomePage(c: SiteChrome, postsList: PostInput[]): string {
  const isRu = c.lang === "ru";
  const cardImg = (p: PostInput) => {
    const fallback = `https://picsum.photos/seed/${encodeURIComponent(p.slug || p.title || "post").slice(0, 60)}/600/360`;
    const url = p.featuredImageUrl && /^https?:\/\//.test(p.featuredImageUrl) ? p.featuredImageUrl : fallback;
    return `<img src="${escAttr(url)}" alt="${escAttr(p.title)}" loading="lazy" width="600" height="360"
      style="display:block;width:100%;aspect-ratio:5/3;object-fit:cover;border-radius:10px 10px 0 0;background:#e2e8f0">`;
  };
  const cards = postsList.length === 0
    ? `<p>${escHtml(isRu ? "Скоро здесь появятся материалы." : "Posts coming soon.")}</p>`
    : `<ul class="home-list" style="list-style:none;padding:0;margin:0;display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
         ${postsList.map((p) => `
           <li style="background:#fafafa;border-radius:10px;overflow:hidden;border:1px solid #eef2f7">
             <a href="/posts/${p.slug}.html" style="text-decoration:none;color:inherit;display:block">
               ${cardImg(p)}
               <div style="padding:16px 18px 18px">
                 <h2 style="margin:0 0 8px;font-size:18px;color:#0f172a">${escHtml(p.title)}</h2>
                 <p style="margin:0;color:#555;font-size:14px">${escHtml(p.excerpt)}</p>
               </div>
             </a>
           </li>`).join("")}
       </ul>`;
  return wrapPage(c, {
    title: c.siteName,
    description: c.siteAbout,
    path: "/",
    type: "website",
    breadcrumbs: [{ label: isRu ? "Главная" : "Home", href: "/" }],
    bodyClass: "page-home",
  }, `
    <section style="max-width:1100px;margin:0 auto;padding:32px 24px">
      <h1 style="font-family:'${c.headingFont}',sans-serif;font-size:36px;margin:0 0 8px">${escHtml(c.siteName)}</h1>
      <p style="margin:0 0 24px;color:#555">${escHtml(c.siteAbout)}</p>
      ${cards}
    </section>`);
}

// ---- Helper: pick N random "other" posts as related ----
export function pickRelated(all: PostInput[], current: PostInput, n = 4): PostInput[] {
  const others = all.filter((p) => p.slug !== current.slug);
  // simple shuffle
  const a = others.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// ---- Business page builders (Vacancies / Portfolio / Reviews / FAQ /
//      Pricing / Guarantees / Delivery / Promo) ----

interface BpDef { key: keyof BusinessPages; ru: string; en: string; path: string; }
const BP_DEFS: BpDef[] = [
  { key: "vacancies",  ru: "Вакансии",        en: "Careers",            path: "/vacancies.html"  },
  { key: "portfolio",  ru: "Кейсы",           en: "Portfolio",          path: "/portfolio.html"  },
  { key: "reviews",    ru: "Отзывы",          en: "Reviews",            path: "/reviews.html"    },
  { key: "faq",        ru: "FAQ",             en: "FAQ",                path: "/faq.html"        },
  { key: "pricing",    ru: "Цены",            en: "Pricing",            path: "/pricing.html"    },
  { key: "guarantees", ru: "Гарантии",        en: "Guarantees",         path: "/guarantees.html" },
  { key: "delivery",   ru: "Доставка и оплата", en: "Shipping & Payment", path: "/delivery.html" },
  { key: "promo",      ru: "Акции",           en: "Promotions",         path: "/promo.html"      },
];

// Extract Q/A pairs from <h3>Q?</h3><p>A.</p> to build FAQPage schema.
function extractFaqPairs(html: string): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const q = m[1].replace(/<[^>]+>/g, "").trim();
    const a = m[2].replace(/<[^>]+>/g, "").trim();
    if (q && a) out.push({ q, a });
  }
  return out.slice(0, 24);
}
function reviewsLd(html: string, c: SiteChrome) {
  const items: string[] = [];
  const re = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    items.push(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: c.companyName || c.siteName,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: (4.6 + Math.random() * 0.3).toFixed(1),
      reviewCount: String(items.length),
    },
  };
}

export function buildBusinessPage(c: SiteChrome, def: BpDef, html: string): string {
  const isRu = c.lang === "ru";
  const label = isRu ? def.ru : def.en;
  const desc = (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) ||
    `${label} · ${c.siteName}`;

  const extraLd: Record<string, unknown>[] = [];
  if (def.key === "faq") {
    const pairs = extractFaqPairs(html);
    if (pairs.length) {
      extraLd.push({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: pairs.map((p) => ({
          "@type": "Question",
          name: p.q,
          acceptedAnswer: { "@type": "Answer", text: p.a },
        })),
      });
    }
  }
  if (def.key === "reviews") {
    const r = reviewsLd(html, c);
    if (r) extraLd.push(r);
  }
  if (def.key === "pricing") {
    // Parse pricing table / h3 packages and emit Service for each.
    const services = extractPricingServices(html);
    if (services.length === 0) {
      // Fallback: single generic Service for the page
      extraLd.push(serviceLd(c, { name: c.siteName, description: c.siteAbout }));
    } else {
      for (const s of services) extraLd.push(serviceLd(c, s));
    }
  }

  // Wrap pricing tables with a class for nicer styling.
  const wrapped = def.key === "pricing"
    ? html.replace(/<table([^>]*)>/g, '<table class="bp-pricing-table"$1>')
    : html;

  const blocks = splitIntoBlocks(wrapped);
  const leadBlock = blocks.find((b) => !b.heading && b.body);
  const restBlocks = blocks.filter((b) => b !== leadBlock);
  const leadText = leadBlock
    ? leadBlock.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220)
    : "";

  const main = `
    <article class="service-page">
      <header class="service-hero service-hero--with-image">
        <div class="service-hero__copy">
          <h1>${escHtml(label)}</h1>
          ${leadText ? `<p class="service-hero__lead">${escHtml(leadText)}</p>` : ""}
        </div>
        <figure class="service-hero__media">
          <img src="${escAttr(pageImage(c, def.key))}" alt="${escAttr(label)}" loading="lazy" width="1600" height="720">
        </figure>
      </header>
      <div class="service-blocks">
        ${(restBlocks.length ? restBlocks : blocks).map((b) => `<section class="service-card">${b.heading ? `<h2>${escHtml(b.heading)}</h2>` : ""}${b.body}</section>`).join("")}
      </div>
    </article>`;
  return wrapPage(c, {
    title: `${label} · ${c.siteName}`,
    description: desc,
    path: def.path,
    type: "website",
    breadcrumbs: [
      { label: isRu ? "Главная" : "Home", href: "/" },
      { label, href: def.path },
    ],
    jsonLd: extraLd.length ? extraLd : undefined,
    bodyClass: `page-${def.key}`,
  }, main);
}

// Extract { name, description, price } trios from a pricing HTML block.
// Recognizes: <h3>Package</h3><p>desc</p><p>от 5000 ₽</p>  OR  <table> rows.
function extractPricingServices(html: string): { name: string; description?: string; price?: string }[] {
  const out: { name: string; description?: string; price?: string }[] = [];
  const h3re = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = h3re.exec(html)) !== null) {
    const name = m[1].replace(/<[^>]+>/g, "").trim();
    const block = m[2] || "";
    const text = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const priceMatch = text.match(/(?:от\s*)?([\d\s]{3,})\s*(?:₽|руб|RUB|\$|USD|EUR|€)/i);
    out.push({
      name,
      description: text.slice(0, 200) || undefined,
      price: priceMatch ? priceMatch[1].replace(/\s+/g, "") : undefined,
    });
  }
  if (out.length > 0) return out.slice(0, 12);
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = Array.from(m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi))
      .map((cc) => cc[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    const name = cells[0];
    const last = cells[cells.length - 1];
    const priceMatch = last.match(/([\d\s]{3,})/);
    if (!name || /^(услуга|service|пакет|package|название|name)$/i.test(name)) continue;
    out.push({
      name,
      description: cells.slice(1, -1).join(" - ").slice(0, 200) || undefined,
      price: priceMatch ? priceMatch[1].replace(/\s+/g, "") : undefined,
    });
  }
  return out.slice(0, 12);
}

export function buildBusinessPages(c: SiteChrome): Record<string, string> {
  const out: Record<string, string> = {};
  const bp = c.businessPages || {};
  for (const def of BP_DEFS) {
    const html = bp[def.key];
    if (typeof html === "string" && html.trim().length > 30) {
      out[def.path.replace(/^\//, "")] = buildBusinessPage(c, def, html);
    }
  }
  return out;
}

export function businessPagePaths(c: SiteChrome): string[] {
  const bp = c.businessPages || {};
  return BP_DEFS.filter((d) => typeof bp[d.key] === "string" && (bp[d.key] as string).trim().length > 30)
    .map((d) => d.path);
}

// ---- Tech assets: favicon, manifest, humans.txt, security.txt, RSS ----

export function faviconSvg(c: SiteChrome): string {
  const letter = (c.siteName || "S").trim().charAt(0).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${c.accent}"/><text x="50%" y="54%" font-size="36" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${escHtml(letter)}</text></svg>`;
}

export function manifestJson(c: SiteChrome): string {
  return JSON.stringify({
    name: c.siteName,
    short_name: c.siteName.slice(0, 12),
    description: c.siteAbout,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: c.accent,
    lang: c.lang,
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
  });
}

export function humansTxt(c: SiteChrome): string {
  const isRu = c.lang === "ru";
  const team = (c.authors || []).map((a) => `  ${a.name}${a.role ? ` (${a.role})` : ""}`).join("\n");
  return `/* TEAM */\n${team || "  Editorial team"}\n\n/* SITE */\n  ${isRu ? "Название" : "Name"}: ${c.siteName}\n  ${isRu ? "Язык" : "Language"}: ${c.lang}\n  Updated: ${new Date().toISOString().slice(0, 10)}\n`;
}

export function securityTxt(c: SiteChrome): string {
  const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  const contact = c.companyEmail ? `mailto:${c.companyEmail}` : `https://${c.domain}/contacts.html`;
  return `Contact: ${contact}\nExpires: ${expires}\nPreferred-Languages: ${c.lang}\n`;
}

export function rssFeed(c: SiteChrome, posts: PostInput[]): string {
  const items = posts.slice(0, 30).map((p) => {
    const link = `https://${c.domain}/posts/${p.slug}.html`;
    const pub = p.publishedAt ? new Date(p.publishedAt).toUTCString() : new Date().toUTCString();
    return `    <item>
      <title>${escHtml(p.title)}</title>
      <link>${link}</link>
      <guid>${link}</guid>
      <pubDate>${pub}</pubDate>
      <description>${escHtml(p.excerpt || "")}</description>
    </item>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${escHtml(c.siteName)}</title>
  <link>https://${c.domain}/</link>
  <description>${escHtml(c.siteAbout)}</description>
  <language>${c.lang}</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel></rss>`;
}

// Update sitemap to include any active business pages — caller must pass them.
export function sitemapXmlExtended(
  c: SiteChrome,
  postSlugs: string[] | SitemapPost[],
  extraPaths: string[],
): string {
  const today = new Date().toISOString().slice(0, 10);
  const posts: SitemapPost[] = (postSlugs as Array<string | SitemapPost>).map((p) =>
    typeof p === "string" ? { slug: p } : p,
  );
  const blocks = [
    sitemapEntry(`https://${c.domain}/`,             today, "weekly",  "1.0"),
    sitemapEntry(`https://${c.domain}/about.html`,    today, "monthly", "0.8"),
    sitemapEntry(`https://${c.domain}/services.html`, today, "monthly", "0.8"),
    sitemapEntry(`https://${c.domain}/contacts.html`, today, "monthly", "0.7"),
    sitemapEntry(`https://${c.domain}/faq.html`,      today, "monthly", "0.7"),
    sitemapEntry(`https://${c.domain}/privacy.html`,  today, "yearly",  "0.3"),
    sitemapEntry(`https://${c.domain}/terms.html`,    today, "yearly",  "0.3"),
    sitemapEntry(`https://${c.domain}/blog/`,         today, "weekly",  "0.9"),
    ...extraPaths.map((p) => sitemapEntry(`https://${c.domain}${p}`, today, "monthly", "0.6")),
    ...posts.map((p) => sitemapEntry(
      `https://${c.domain}/posts/${p.slug}.html`,
      (p.publishedAt || today).slice(0, 10),
      "monthly",
      "0.6",
    )),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${blocks.join("\n")}
</urlset>`;
}