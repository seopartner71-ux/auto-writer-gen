// Shared SEO + UX chrome for Site Factory pages.
// - Head with title, meta description, canonical, OG, Twitter, JSON-LD
// - Sticky header / menu / breadcrumbs
// - Footer with full link set + copyright
// - Cookie consent banner (GDPR) saved to localStorage
// - robots.txt and sitemap.xml builders

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
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: c.companyName || c.siteName,
    url: `https://${c.domain}/`,
    logo: c.ogImageUrl || undefined,
    foundingDate: c.foundingYear ? String(c.foundingYear) : undefined,
    address: c.companyAddress ? {
      "@type": "PostalAddress",
      streetAddress: c.companyAddress,
    } : undefined,
    contactPoint: (c.companyPhone || c.companyEmail) ? {
      "@type": "ContactPoint",
      telephone: c.companyPhone || undefined,
      email: c.companyEmail || undefined,
      contactType: "customer support",
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

function headerHtml(c: SiteChrome): string {
  const items = navItems(c);
  const isRu = c.lang === "ru";
  return `<a class="skip-link" href="#main-content">${isRu ? "Перейти к контенту" : "Skip to content"}</a>
<div class="reading-progress" id="reading-progress" aria-hidden="true"></div>
<header class="site-header" id="site-header">
  <div class="site-header__inner">
    <a href="/" class="site-header__brand">${escHtml(c.siteName)}</a>
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

function footerHtml(c: SiteChrome): string {
  const items = navItems(c);
  const extra = footerExtraLinks(c);
  const year = new Date().getFullYear();
  const isRu = c.lang === "ru";
  const owner = c.companyName || c.siteName;

  const napLines: string[] = [];
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
.site-footer{background:#0a0a0a;color:#cfcfcf;margin-top:48px;padding:32px 24px}
.site-footer__inner{max-width:1200px;margin:0 auto;display:flex;flex-wrap:wrap;justify-content:space-between;gap:24px;font-size:14px}
.site-footer__nav{display:flex;gap:18px;flex-wrap:wrap}
.site-footer__nav a{color:#cfcfcf;text-decoration:none}
.site-footer__nav a:hover{color:#fff;text-decoration:underline}
.site-footer__meta{display:flex;flex-direction:column;gap:6px;font-size:13px;color:#9a9a9a;text-align:right}
.site-footer__meta a{color:#cfcfcf;text-decoration:none}
.site-footer__partner{color:#9a9a9a;font-size:12px}
.site-footer__social{display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;margin-top:6px;font-size:12px}
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
${COOKIE_BANNER_CSS}
`;

export function buildHead(c: SiteChrome, m: PageMeta): string {
  const canonical = absUrl(c.domain, m.path);
  const ogImage = m.ogImage || c.ogImageUrl || "";
  const robots = m.noIndex ? "noindex,nofollow" : "index,follow,max-image-preview:large";

  const lds: unknown[] = [websiteLd(c), organizationLd(c), breadcrumbsLd(c, m.breadcrumbs)];
  if (m.type === "article") lds.push(articleLd(c, m));
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
  ${lds.map((x) => jsonLdScript(x)).join("\n  ")}
</head>`;
}

export function wrapPage(c: SiteChrome, m: PageMeta, mainHtml: string): string {
  const head = buildHead(c, m);
  const pixel = (c.projectId && c.trackerUrl)
    ? `<img src="${escAttr(c.trackerUrl)}?site=${escAttr(c.projectId)}&u=${encodeURIComponent(m.path)}" width="1" height="1" alt="" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade">`
    : "";
  return `${head}
<body class="${escAttr(m.bodyClass || "")}">
  ${headerHtml(c)}
  ${breadcrumbsHtml(c, m.breadcrumbs)}
  <main class="page">${mainHtml}</main>
  ${footerHtml(c)}
  ${cookieBannerHtml(c.lang, "/privacy.html")}
  <script defer>${COOKIE_BANNER_JS}</script>
  <script defer>${TRUST_JS}</script>
  ${pixel}
</body>
</html>`;
}

export function chromeStyles(c: SiteChrome): string {
  return `:root{--accent:${c.accent}}
${CHROME_CSS}
`;
}

// ---- robots / sitemap ----
export function robotsTxt(c: SiteChrome): string {
  return `User-agent: *\nAllow: /\nSitemap: https://${c.domain}/sitemap.xml\n`;
}

export function sitemapXml(c: SiteChrome, postSlugs: string[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const urls: { loc: string; lastmod: string; priority?: string }[] = [
    { loc: `https://${c.domain}/`,             lastmod: today, priority: "1.0" },
    { loc: `https://${c.domain}/about.html`,    lastmod: today, priority: "0.7" },
    { loc: `https://${c.domain}/contacts.html`, lastmod: today, priority: "0.5" },
    { loc: `https://${c.domain}/privacy.html`,  lastmod: today, priority: "0.3" },
    { loc: `https://${c.domain}/terms.html`,    lastmod: today, priority: "0.3" },
    ...postSlugs.map((s) => ({
      loc: `https://${c.domain}/posts/${s}.html`,
      lastmod: today,
      priority: "0.8",
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority || "0.5"}</priority></url>`).join("\n")}
</urlset>`;
}

// ---- Page builders for non-content pages ----

function home(c: SiteChrome) {
  return [
    { label: c.lang === "ru" ? "Главная" : "Home", href: "/" },
  ];
}

export function buildAboutPage(c: SiteChrome): string {
  const isRu = c.lang === "ru";
  const title = `${isRu ? "О нас" : "About"} · ${c.siteName}`;
  const desc  = (c.aboutHtml || c.siteAbout || c.siteName).replace(/<[^>]+>/g, " ").trim().slice(0, 160);
  const team  = (c.teamMembers || []).slice(0, 4);
  const teamHtml = team.length ? `
    <h2>${isRu ? "Команда редакции" : "Team"}</h2>
    <div class="team-grid">
      ${team.map((t) => `
        <div class="team-card">
          <h3>${escHtml(t.name)}</h3>
          <div class="role">${escHtml(t.role || "")}</div>
          ${t.bio ? `<p>${escHtml(t.bio)}</p>` : ""}
        </div>`).join("")}
    </div>` : "";

  const main = `
    <article class="page-article">
      <h1>${escHtml(isRu ? "О нас" : "About us")}</h1>
      ${c.aboutHtml || `<p>${escHtml(c.siteAbout)}</p>`}
      ${teamHtml}
      ${c.foundingYear ? `<p><em>${isRu ? "Работаем с" : "Working since"} ${c.foundingYear}.</em></p>` : ""}
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
  const lines: string[] = [];
  if (c.companyName)    lines.push(`<li><strong>${isRu ? "Компания" : "Company"}:</strong> ${escHtml(c.companyName)}</li>`);
  if (c.companyAddress) lines.push(`<li><strong>${isRu ? "Адрес" : "Address"}:</strong> ${escHtml(c.companyAddress)}</li>`);
  if (c.companyPhone)   lines.push(`<li><strong>${isRu ? "Телефон" : "Phone"}:</strong> <a href="tel:${escAttr(c.companyPhone.replace(/[^+\d]/g, ""))}">${escHtml(c.companyPhone)}</a></li>`);
  if (c.companyEmail)   lines.push(`<li><strong>Email:</strong> <a href="mailto:${escAttr(c.companyEmail)}">${escHtml(c.companyEmail)}</a></li>`);
  const main = `
    <article class="page-article">
      <h1>${isRu ? "Контакты" : "Contacts"}</h1>
      ${c.contactsHtml || `<p>${escHtml(isRu ? "Напишите нам или позвоните в рабочие часы." : "Reach out to us during business hours.")}</p>`}
      <ul class="contact-list">${lines.join("")}</ul>
    </article>`;
  return wrapPage(c, {
    title, description: (isRu ? "Контакты сайта " : "Contact details for ") + c.siteName,
    path: "/contacts.html", type: "website",
    breadcrumbs: [...home(c), { label: isRu ? "Контакты" : "Contacts", href: "/contacts.html" }],
    bodyClass: "page-contacts",
  }, main);
}

export function buildPrivacyPage(c: SiteChrome): string {
  const isRu = c.lang === "ru";
  const title = `${isRu ? "Политика конфиденциальности" : "Privacy policy"} · ${c.siteName}`;
  const cookiesNote = isRu
    ? `<p>Сайт использует cookies для корректной работы и анонимной аналитики. Вы можете принять или отклонить их в баннере при первом визите. Согласие сохраняется в localStorage вашего браузера.</p>`
    : `<p>The site uses cookies for proper operation and anonymous analytics. You can accept or reject them in the banner on your first visit. Your choice is saved in your browser's localStorage.</p>`;
  const main = `
    <article class="page-article">
      <h1>${isRu ? "Политика конфиденциальности" : "Privacy policy"}</h1>
      ${c.privacyHtml || `<p>${escHtml(isRu ? "Мы уважаем вашу конфиденциальность." : "We respect your privacy.")}</p>`}
      ${cookiesNote}
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
  const main = `
    <article class="page-article">
      <h1>${isRu ? "Пользовательское соглашение" : "Terms of use"}</h1>
      ${c.termsHtml || `<p>${escHtml(isRu ? "Все материалы носят информационный характер." : "All materials are for informational purposes only.")}</p>`}
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
  const authorJsonLd = author
    ? { "@context": "https://schema.org", "@type": "Person", name: author.name, jobTitle: author.role || undefined }
    : null;
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
`;
  // Stable hero image via Picsum, seeded by slug so each post gets a different
  // but consistent photo across rebuilds. No API key, no rate limits.
  const heroSeed = encodeURIComponent(post.slug || post.title || "post").slice(0, 60);
  const heroUrl  = `https://picsum.photos/seed/${heroSeed}/1200/600`;
  const heroImg  = `<img class="post-hero" src="${heroUrl}" alt="${escAttr(post.title)}" loading="eager" width="1200" height="600">`;

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
    jsonLd: authorJsonLd ? [authorJsonLd] : undefined,
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
      ${heroImg}
      ${post.contentHtml}
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
  const cards = postsList.length === 0
    ? `<p>${escHtml(isRu ? "Скоро здесь появятся материалы." : "Posts coming soon.")}</p>`
    : `<ul class="home-list" style="list-style:none;padding:0;margin:0;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
         ${postsList.map((p) => `
           <li style="padding:20px;background:#fafafa;border-radius:10px">
             <h2 style="margin:0 0 8px;font-size:18px"><a href="/posts/${p.slug}.html" style="color:#0f172a;text-decoration:none">${escHtml(p.title)}</a></h2>
             <p style="margin:0;color:#555;font-size:14px">${escHtml(p.excerpt)}</p>
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
    extraLd.push({
      "@context": "https://schema.org",
      "@type": "PriceSpecification",
      priceCurrency: isRu ? "RUB" : "USD",
    });
  }

  // Wrap pricing tables with a class for nicer styling.
  const wrapped = def.key === "pricing"
    ? html.replace(/<table([^>]*)>/g, '<table class="bp-pricing-table"$1>')
    : html;

  const main = `
    <article class="page-article">
      <h1>${escHtml(label)}</h1>
      ${wrapped}
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
export function sitemapXmlExtended(c: SiteChrome, postSlugs: string[], extraPaths: string[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const urls: { loc: string; lastmod: string; priority?: string }[] = [
    { loc: `https://${c.domain}/`,             lastmod: today, priority: "1.0" },
    { loc: `https://${c.domain}/about.html`,    lastmod: today, priority: "0.7" },
    { loc: `https://${c.domain}/contacts.html`, lastmod: today, priority: "0.5" },
    { loc: `https://${c.domain}/privacy.html`,  lastmod: today, priority: "0.3" },
    { loc: `https://${c.domain}/terms.html`,    lastmod: today, priority: "0.3" },
    ...extraPaths.map((p) => ({ loc: `https://${c.domain}${p}`, lastmod: today, priority: "0.6" })),
    ...postSlugs.map((s) => ({ loc: `https://${c.domain}/posts/${s}.html`, lastmod: today, priority: "0.8" })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority || "0.5"}</priority></url>`).join("\n")}
</urlset>`;
}