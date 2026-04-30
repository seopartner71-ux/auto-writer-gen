// News portal homepage + article page generator (Site Factory template №3).
// Different HTML skeleton from landing (№1) and magazine (№2). Class
// namespace is `.news-*` / `.brk-*` to avoid CSS collisions.

import {
  type SiteChrome, type PostInput, type Author,
  buildHead, headerHtml, footerHtml,
  pickAuthor, pickAuthorByIndex, portraitUrl, uniqueImageAlt, siteSeed,
} from "./seoChrome.ts";
import { pickPhrase, intFromSeed } from "./phrasePools.ts";
import { widgetsHtml as renderSiteWidgets } from "./siteWidgets.ts";

function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escAttr(s: string): string { return escHtml(s); }

interface NewsRubric { key: string; label: string; color: string; }
function buildRubrics(c: SiteChrome): NewsRubric[] {
  const isRu = c.lang === "ru";
  return [
    { key: "main",      label: isRu ? "Главное"   : "Top",        color: "#e63946" },
    { key: "market",    label: isRu ? "Рынок"     : "Market",     color: "#1d3557" },
    { key: "tips",      label: isRu ? "Советы"    : "Tips",       color: "#2563eb" },
    { key: "reviews",   label: isRu ? "Обзоры"    : "Reviews",    color: "#16a34a" },
    { key: "interview", label: isRu ? "Интервью"  : "Interviews", color: "#ea580c" },
    { key: "analytics", label: isRu ? "Аналитика" : "Analytics",  color: "#7c3aed" },
  ];
}
function rubricByIndex(idx: number, list: NewsRubric[]): NewsRubric {
  const n = list.length;
  return list[((idx % n) + n) % n];
}

function readingTime(html: string): number {
  const text = String(html || "").replace(/<[^>]+>/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.round(words / 220));
}
function fakeViews(slug: string, seed: string): number {
  return intFromSeed(500, 50000, `${seed}:nv:${slug}`);
}
function fmtViews(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}
function postImage(p: PostInput, w = 800, h = 480): string {
  if (p.featuredImageUrl && /^https?:\/\//.test(p.featuredImageUrl)) return p.featuredImageUrl;
  const seed = encodeURIComponent(p.slug || p.title || "post").slice(0, 60);
  return `https://picsum.photos/seed/${seed}/${w}/${h}`;
}
function timeOnly(iso: string | undefined): { hhmm: string; dt: string; dateKey: string } {
  if (!iso) return { hhmm: "", dt: "", dateKey: "" };
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { hhmm: `${hh}:${mm}`, dt: d.toISOString(), dateKey: d.toISOString().slice(0, 10) };
}
function fmtFullDate(iso: string | undefined, isRu: boolean): { label: string; dt: string } {
  if (!iso) return { label: "", dt: "" };
  const d = new Date(iso);
  return { dt: d.toISOString(), label: d.toLocaleDateString(isRu ? "ru-RU" : "en-US", { year: "numeric", month: "long", day: "numeric" }) };
}
function relativeTime(iso: string | undefined, isRu: boolean): string {
  if (!iso) return "";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (isRu) {
    if (m < 60)  return m <= 1 ? "только что" : `${m} мин назад`;
    if (h < 24)  return `${h} ч назад`;
    if (d === 1) return "вчера";
    if (d < 7)   return `${d} дн назад`;
    if (d < 30)  return `${Math.floor(d / 7)} нед назад`;
    if (d < 365) return `${Math.floor(d / 30)} мес назад`;
    return `${Math.floor(d / 365)} г назад`;
  }
  if (m < 60)  return m <= 1 ? "just now" : `${m} min ago`;
  if (h < 24)  return `${h}h ago`;
  if (d === 1) return "yesterday";
  if (d < 7)   return `${d}d ago`;
  if (d < 30)  return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function newsCss(c: SiteChrome): string {
  const acc = c.accent || "#e63946";
  return `
:root{--news-accent:${acc};--news-text:#1a1a2e;--news-bg:#fff;--news-soft:#f8f8f8;--news-side:#f0f0f0;--news-border:#e3e6ec}
body.page-news{background:var(--news-bg);color:var(--news-text);font-family:'${c.bodyFont}','Roboto','PT Sans',system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.55}
.news-shell{max-width:1240px;margin:0 auto;padding:0 20px}
.news-utility{background:#1a1a2e;color:#cfd5e2;font-size:12px}
.news-utility .news-shell{display:flex;gap:18px;padding:6px 20px;flex-wrap:wrap;align-items:center}
.news-utility b{color:#fff;font-weight:600}
.news-utility-fx{display:flex;gap:14px;margin-left:auto;flex-wrap:wrap}
.news-rubric-nav{background:var(--news-soft);border-bottom:1px solid var(--news-border);position:sticky;top:0;z-index:50}
.news-rubric-nav nav{display:flex;gap:2px;overflow-x:auto;padding:2px 0;font-size:14px;font-weight:600}
.news-rubric-nav a{padding:12px 16px;color:var(--news-text);text-decoration:none;white-space:nowrap;border-bottom:3px solid transparent;transition:.15s}
.news-rubric-nav a:hover,.news-rubric-nav a.is-active{color:var(--news-accent);border-bottom-color:var(--news-accent)}
.brk-bar{background:var(--news-accent);color:#fff;overflow:hidden}
.brk-bar__inner{display:flex;align-items:center;max-width:1240px;margin:0 auto;padding:0 20px}
.brk-label{flex:0 0 auto;background:#000;color:#fff;font-weight:700;font-size:11px;letter-spacing:.12em;padding:8px 14px;margin-right:14px;text-transform:uppercase}
.brk-track{flex:1;overflow:hidden;position:relative;height:34px}
.brk-track ul{display:inline-flex;gap:36px;list-style:none;padding:0;margin:0;animation:brkRoll 60s linear infinite;white-space:nowrap;line-height:34px;font-size:13px;font-weight:500}
.brk-track a{color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:10px}
.brk-track .brk-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#fff;opacity:.6}
@keyframes brkRoll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media(prefers-reduced-motion:reduce){.brk-track ul{animation:none;flex-wrap:wrap;white-space:normal}}
.news-top{display:grid;grid-template-columns:60% 40%;gap:24px;background:#fff;border:1px solid var(--news-border);margin:24px 0;overflow:hidden}
.news-top figure{margin:0;background:#f1f1f3}
.news-top figure img{width:100%;height:100%;min-height:340px;object-fit:cover;display:block}
.news-top__copy{padding:28px 30px;display:flex;flex-direction:column;justify-content:center}
.news-top__copy h1{font-family:'${c.headingFont}','PT Serif',Georgia,serif;font-size:34px;line-height:1.18;margin:0 0 14px;font-weight:700}
.news-top__copy p.news-lead{font-size:16px;line-height:1.55;margin:0 0 14px;color:#3a3f4b}
.news-top__copy .news-meta{font-size:12px;color:#7a7e88;display:flex;gap:14px;flex-wrap:wrap;margin-top:auto}
.news-top__copy a{color:inherit;text-decoration:none}
.news-top__copy a:hover h1{color:var(--news-accent)}
@media(max-width:880px){.news-top{grid-template-columns:1fr}.news-top figure img{min-height:220px;height:240px}.news-top__copy h1{font-size:26px}}
.news-grid{display:grid;grid-template-columns:1fr 320px;gap:32px;margin:0 0 48px}
@media(max-width:980px){.news-grid{grid-template-columns:1fr}}
.news-sec-head{display:flex;align-items:center;gap:14px;margin:8px 0 16px;border-top:3px solid var(--news-text);padding-top:12px}
.news-sec-head h2{font-family:'${c.headingFont}','PT Serif',Georgia,serif;font-size:18px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin:0}
.news-sec-head .news-sec-tail{flex:1;height:1px;background:var(--news-border)}
.news-card{background:#fff;border-bottom:1px solid var(--news-border);padding:18px 0;display:grid;grid-template-columns:200px 1fr;gap:18px}
.news-card figure.news-thumbnail{margin:0;background:#f1f1f3}
.news-card figure.news-thumbnail img{width:100%;height:130px;object-fit:cover;display:block}
.news-card__body h3{font-family:'${c.headingFont}','PT Serif',Georgia,serif;font-size:20px;line-height:1.25;margin:8px 0 8px;font-weight:700}
.news-card__body p{margin:0 0 10px;color:#454952;font-size:14px}
.news-card a{color:inherit;text-decoration:none}
.news-card a:hover h3{color:var(--news-accent)}
.article-meta{font-size:12px;color:#7a7e88;display:flex;gap:12px;flex-wrap:wrap;margin-top:auto;align-items:center}
@media(max-width:680px){.news-card{grid-template-columns:1fr}.news-card figure.news-thumbnail img{height:180px}}
.news-card--compact{display:block;padding:14px 0;border-bottom:1px dashed var(--news-border)}
.news-card--compact h3{font-family:'${c.headingFont}','PT Serif',Georgia,serif;font-size:17px;line-height:1.3;margin:0 0 6px;font-weight:600}
.news-card--compact a{color:var(--news-text);text-decoration:none}
.news-card--compact a:hover h3{color:var(--news-accent)}
.news-rubric-tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fff;padding:3px 10px;border-radius:2px;background:var(--news-accent);margin-bottom:6px}
.news-more{display:flex;justify-content:center;margin:24px 0 0}
.news-more button{background:transparent;border:1px solid var(--news-border);color:var(--news-text);padding:11px 30px;font-size:13px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;cursor:pointer}
.news-more button:hover{background:var(--news-text);color:#fff}
.sidebar{position:sticky;top:60px;align-self:start;display:flex;flex-direction:column;gap:22px}
.sidebar-widget{background:var(--news-side);padding:18px}
.sidebar-widget h4{font-family:'${c.headingFont}','PT Serif',Georgia,serif;font-size:13px;font-weight:700;margin:0 0 14px;text-transform:uppercase;letter-spacing:.06em;border-bottom:2px solid var(--news-text);padding-bottom:8px}
.sidebar-widget ol{list-style:none;padding:0;margin:0;counter-reset:n}
.sidebar-widget ol li{counter-increment:n;padding:10px 0;border-bottom:1px solid #d8dde3;display:grid;grid-template-columns:24px 1fr;gap:8px;font-size:14px;line-height:1.35}
.sidebar-widget ol li:last-child{border-bottom:none}
.sidebar-widget ol li::before{content:counter(n);font-family:'${c.headingFont}','PT Serif',Georgia,serif;font-size:18px;font-weight:700;color:var(--news-accent)}
.sidebar-widget ol a{color:var(--news-text);text-decoration:none}
.sidebar-widget--related ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:14px}
.sidebar-widget--related a{display:grid;grid-template-columns:80px 1fr;gap:10px;color:var(--news-text);text-decoration:none}
.sidebar-widget--related img{width:80px;height:60px;object-fit:cover;display:block;background:#dadde2}
.sidebar-widget--related h5{font-size:13px;line-height:1.3;margin:0;font-weight:600}
.sidebar-widget--newsletter p{font-size:13px;line-height:1.45;margin:0 0 12px;color:#3a3f4b}
.sidebar-widget--newsletter form{display:flex;flex-direction:column;gap:8px}
.sidebar-widget--newsletter input{padding:10px 12px;border:1px solid #c8ccd3;background:#fff;font-size:13px;font-family:inherit}
.sidebar-widget--newsletter button{background:var(--news-text);color:#fff;padding:11px;border:0;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
.sidebar-widget--newsletter button:hover{background:var(--news-accent)}
.news-feed{margin:48px 0}
.news-feed__day{font-family:'${c.headingFont}','PT Serif',Georgia,serif;font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#7a7e88;margin:24px 0 8px}
.news-feed ol{list-style:none;padding:0;margin:0}
.news-feed li{display:grid;grid-template-columns:60px 1fr 24px;gap:14px;padding:11px 0;border-bottom:1px solid var(--news-border);align-items:center}
.news-feed li:hover{background:var(--news-soft)}
.news-feed time{color:var(--news-accent);font-weight:700;font-size:13px}
.news-feed a{color:var(--news-text);text-decoration:none;font-size:15px;line-height:1.4}
.news-feed a:hover{color:var(--news-accent)}
.news-feed .news-feed__arrow{color:#bcc1c9;text-align:right}
.news-analytics{margin:48px 0}
.news-analytics__row{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
@media(max-width:760px){.news-analytics__row{grid-template-columns:1fr}}
.news-analytics-card{background:#fff;border:1px solid var(--news-border);padding:20px 22px;display:flex;flex-direction:column;gap:6px}
.news-analytics-card .news-an-cap{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a7e88;font-weight:600}
.news-analytics-card .news-an-num{font-family:'${c.headingFont}','PT Serif',Georgia,serif;font-size:30px;font-weight:700}
.news-analytics-card .news-an-delta{font-size:13px;font-weight:600}
.news-analytics-card .news-an-delta.is-up{color:#16a34a}
.news-analytics-card .news-an-delta.is-down{color:#dc2626}
.news-analytics-card svg{margin-top:6px;width:100%;height:42px}
.news-interview{background:#1a1a2e;color:#fff;padding:48px 32px;margin:48px 0;display:grid;grid-template-columns:160px 1fr;gap:30px;align-items:center}
@media(max-width:760px){.news-interview{grid-template-columns:1fr;text-align:center;padding:32px 22px}}
.news-interview img{width:160px;height:160px;border-radius:50%;object-fit:cover;border:4px solid var(--news-accent);justify-self:center}
.news-interview blockquote{font-family:'${c.headingFont}','PT Serif',Georgia,serif;font-size:22px;line-height:1.4;margin:0 0 16px;font-style:italic;color:#fff}
.news-interview cite{display:block;font-size:13px;color:#cfd5e2;font-style:normal;margin-bottom:12px}
.news-interview cite b{display:block;color:#fff;font-size:15px;font-weight:700;margin-bottom:2px}
.news-interview a.news-int-cta{color:var(--news-accent);text-decoration:none;font-size:13px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid var(--news-accent);padding-bottom:2px}
.page-news.page-post .news-shell{max-width:1180px}
.news-article-wrap{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:40px;margin:24px 0 48px}
@media(max-width:980px){.news-article-wrap{grid-template-columns:1fr}}
.news-article{max-width:720px;margin:0 auto;width:100%;background:#fff}
.news-article-head h1{font-family:'${c.headingFont}','PT Serif',Georgia,serif;font-size:38px;line-height:1.2;margin:0 0 18px;font-weight:700}
@media(max-width:680px){.news-article-head h1{font-size:28px}}
.news-article-lead{font-size:19px;line-height:1.55;font-weight:600;color:#1f2433;margin:0 0 22px;padding:18px 22px;background:#f4f6fa;border-left:4px solid var(--news-accent)}
.news-article-meta{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:#7a7e88;align-items:center;padding:14px 0;border-top:1px solid var(--news-border);border-bottom:1px solid var(--news-border);margin:0 0 28px}
.news-article-meta address{font-style:normal;color:var(--news-text);font-weight:600}
.news-share{display:inline-flex;gap:6px;margin-left:auto}
.news-share a{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;background:var(--news-soft);border-radius:50%;color:var(--news-text);text-decoration:none;font-size:12px;font-weight:700}
.news-share a:hover{background:var(--news-accent);color:#fff}
.news-article-figure{margin:0 0 26px}
.news-article-figure img{width:100%;height:auto;display:block;background:#f1f1f3}
.news-article-body{font-size:17px;line-height:1.65;color:#1c1f29}
.news-article-body p{margin:0 0 1.1em}
.news-article-body h2{font-family:'${c.headingFont}','PT Serif',Georgia,serif;font-size:26px;margin:1.6em 0 .6em;font-weight:700}
.news-article-body h3{font-family:'${c.headingFont}','PT Serif',Georgia,serif;font-size:21px;margin:1.4em 0 .5em;font-weight:700}
.news-article-body blockquote{margin:1.4em 0;padding:18px 22px;background:#f8f8f8;border-left:4px solid var(--news-accent);font-style:italic}
.news-article-inline{display:grid;grid-template-columns:120px 1fr;gap:14px;margin:1.6em 0;padding:14px;background:var(--news-soft);border-left:3px solid var(--news-text);text-decoration:none;color:inherit}
.news-article-inline img{width:120px;height:90px;object-fit:cover;display:block;background:#dadde2}
.news-article-inline h4{margin:0 0 4px;font-size:15px;font-weight:700;line-height:1.3;font-family:'${c.headingFont}','PT Serif',Georgia,serif}
.news-article-inline span{font-size:11px;color:#7a7e88;letter-spacing:.06em;text-transform:uppercase}
.news-tags{margin:32px 0 0;display:flex;gap:8px;flex-wrap:wrap}
.news-tags a{font-size:12px;padding:5px 11px;background:var(--news-soft);color:var(--news-text);text-decoration:none;border-radius:2px}
.news-tags a:hover{background:var(--news-accent);color:#fff}
.news-sources{margin:24px 0 0;padding:14px 18px;background:var(--news-soft);font-size:13px;color:#454952;border-left:3px solid var(--news-border)}
.news-sources b{color:var(--news-text)}
`;
}

export interface NewsHomeOpts { chrome: SiteChrome; posts: PostInput[]; expertAuthor?: Author | null; }

export function renderNewsHome(opts: NewsHomeOpts): string {
  const { chrome: c, posts } = opts;
  const isRu = c.lang === "ru";
  const seed = siteSeed(c);
  const rubrics = buildRubrics(c);
  const list = posts.slice(0, 24);
  const top = list[0];
  const mediumCards = list.slice(1, 3);
  const compactCards = list.slice(3, 7);
  const popular = list.slice(0, 5);
  const related = list.slice(7, 10);
  const feedItems = list.slice(0, 14);

  const idxBySlug = new Map<string, number>();
  posts.forEach((p, i) => idxBySlug.set(p.slug, i));
  const idxOf = (slug: string) => idxBySlug.get(slug) ?? 0;
  const rubOf = (slug: string) => rubricByIndex(idxOf(slug), rubrics);

  const rubricNav = `
    <div class="news-rubric-nav"><div class="news-shell">
      <nav role="navigation" aria-label="${escAttr(isRu ? "Рубрики" : "Sections")}">
        <a href="/" class="is-active">${escHtml(isRu ? "Главное" : "Top")}</a>
        ${rubrics.slice(1).map((r) => `<a href="/blog/">${escHtml(r.label)}</a>`).join("")}
        <a href="/blog/">${escHtml(isRu ? "Все новости" : "All news")}</a>
      </nav>
    </div></div>`;

  const today = new Date();
  const dateLabel = today.toLocaleDateString(isRu ? "ru-RU" : "en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const fxA = (88 + intFromSeed(0, 800, `${seed}:fxa`) / 100).toFixed(2);
  const fxB = (96 + intFromSeed(0, 700, `${seed}:fxb`) / 100).toFixed(2);
  const tempC = intFromSeed(-12, 28, `${seed}:wx`);
  const tempStr = `${tempC > 0 ? "+" : ""}${tempC}°C`;

  const utility = `
    <div class="news-utility"><div class="news-shell">
      <span><b>${escHtml(dateLabel)}</b></span>
      <div class="news-utility-fx">
        <span>USD <b>${fxA}</b></span><span>EUR <b>${fxB}</b></span>
        <span>${escHtml(isRu ? "Погода" : "Weather")}: <b>${tempStr}</b></span>
      </div>
    </div></div>`;

  const tickerItems = list.slice(0, 6).map((p) =>
    `<li><a href="/posts/${escAttr(p.slug)}.html"><span class="brk-dot"></span>${escHtml(p.title)}</a></li>`
  ).join("");
  const breaking = list.length ? `
    <div class="brk-bar" role="region" aria-label="${escAttr(isRu ? "Срочные новости" : "Breaking news")}">
      <div class="brk-bar__inner">
        <span class="brk-label">${escHtml(isRu ? "СРОЧНО" : "BREAKING")}</span>
        <div class="brk-track"><ul>${tickerItems}${tickerItems}</ul></div>
      </div>
    </div>` : "";

  const topRub = top ? rubOf(top.slug) : null;
  const topHtml = top && topRub ? `
    <article class="news-top news-card--featured" itemscope itemtype="https://schema.org/NewsArticle">
      <figure class="news-thumbnail">
        <a href="/posts/${escAttr(top.slug)}.html" aria-label="${escAttr(top.title)}">
          <img src="${escAttr(postImage(top, 1200, 720))}" alt="${escAttr(uniqueImageAlt(c, top.title, 0))}" width="1200" height="720" loading="eager" decoding="async" fetchpriority="high" itemprop="image">
        </a>
      </figure>
      <div class="news-top__copy">
        <span class="news-rubric-tag" style="background:${topRub.color}">${escHtml(isRu ? "Главное" : "Top")}</span>
        <a href="/posts/${escAttr(top.slug)}.html"><h1 itemprop="headline">${escHtml(top.title)}</h1></a>
        <p class="news-lead">${escHtml(top.excerpt || "")}</p>
        <div class="news-meta article-meta">
          ${top.publishedAt ? `<time datetime="${escAttr(timeOnly(top.publishedAt).dt)}" itemprop="datePublished">${escHtml(relativeTime(top.publishedAt, isRu))}</time>` : ""}
          <span>${fmtViews(fakeViews(top.slug, seed))} ${escHtml(isRu ? "просмотров" : "views")}</span>
        </div>
      </div>
    </article>` : "";

  const mediumCardsHtml = mediumCards.map((p) => {
    const r = rubOf(p.slug);
    return `
    <article class="news-card" itemscope itemtype="https://schema.org/NewsArticle">
      <figure class="news-thumbnail">
        <a href="/posts/${escAttr(p.slug)}.html"><img src="${escAttr(postImage(p, 400, 260))}" alt="${escAttr(uniqueImageAlt(c, p.title, 1))}" width="400" height="260" loading="lazy" decoding="async" itemprop="image"></a>
      </figure>
      <div class="news-card__body">
        <span class="news-rubric-tag" style="background:${r.color}">${escHtml(r.label)}</span>
        <a href="/posts/${escAttr(p.slug)}.html"><h3 itemprop="headline">${escHtml(p.title)}</h3></a>
        <p>${escHtml(p.excerpt || "")}</p>
        <div class="article-meta">
          ${p.publishedAt ? `<time datetime="${escAttr(timeOnly(p.publishedAt).dt)}">${escHtml(relativeTime(p.publishedAt, isRu))}</time>` : ""}
          <span>${fmtViews(fakeViews(p.slug, seed))} ${escHtml(isRu ? "просмотров" : "views")}</span>
        </div>
      </div>
    </article>`;
  }).join("");

  const compactCardsHtml = `
    <div class="news-sec-head"><h2>${escHtml(isRu ? "Популярное" : "Most popular")}</h2><span class="news-sec-tail"></span></div>
    ${compactCards.map((p) => {
      const r = rubOf(p.slug);
      return `
      <article class="news-card news-card--compact" itemscope itemtype="https://schema.org/NewsArticle">
        <span class="news-rubric-tag" style="background:${r.color}">${escHtml(r.label)}</span>
        <a href="/posts/${escAttr(p.slug)}.html"><h3 itemprop="headline">${escHtml(p.title)}</h3></a>
        <div class="article-meta">
          ${p.publishedAt ? `<time datetime="${escAttr(timeOnly(p.publishedAt).dt)}">${escHtml(relativeTime(p.publishedAt, isRu))}</time>` : ""}
          <span>${fmtViews(fakeViews(p.slug, seed))} ${escHtml(isRu ? "просмотров" : "views")}</span>
        </div>
      </article>`;
    }).join("")}
    <div class="news-more"><button type="button" onclick="location.href='/blog/'">${escHtml(isRu ? "Загрузить еще" : "Load more")}</button></div>`;

  const sidebarHtml = `
    <aside class="sidebar" role="complementary" aria-label="${escAttr(isRu ? "Боковая колонка" : "Sidebar")}">
      <div class="sidebar-widget"><h4>${escHtml(isRu ? "Читают прямо сейчас" : "Reading right now")}</h4>
        <ol>${popular.map((p) => `<li><a href="/posts/${escAttr(p.slug)}.html">${escHtml(p.title)}</a></li>`).join("")}</ol>
      </div>
      ${related.length ? `
      <div class="sidebar-widget sidebar-widget--related"><h4>${escHtml(isRu ? "По теме" : "Related")}</h4>
        <ul>${related.map((p) => `<li><a href="/posts/${escAttr(p.slug)}.html"><img src="${escAttr(postImage(p, 200, 150))}" alt="${escAttr(uniqueImageAlt(c, p.title, 3))}" width="80" height="60" loading="lazy" decoding="async"><h5>${escHtml(p.title)}</h5></a></li>`).join("")}</ul>
      </div>` : ""}
      <div class="sidebar-widget sidebar-widget--newsletter"><h4>${escHtml(isRu ? "Рассылка" : "Newsletter")}</h4>
        <p>${escHtml(isRu ? "Подпишитесь и получайте свежие материалы по теме раз в неделю." : "Get fresh stories on the topic delivered weekly.")}</p>
        <form onsubmit="event.preventDefault();this.querySelector('button').textContent='${escAttr(isRu ? "Готово!" : "Done!")}';return false">
          <input type="email" required placeholder="${escAttr(isRu ? "Ваш email" : "Your email")}" autocomplete="email">
          <button type="submit">${escHtml(isRu ? "Подписаться" : "Subscribe")}</button>
        </form>
      </div>
    </aside>`;

  const groups = new Map<string, PostInput[]>();
  for (const p of feedItems) {
    const key = timeOnly(p.publishedAt).dateKey || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const sortedKeys = Array.from(groups.keys()).sort().reverse();
  const todayKey = new Date().toISOString().slice(0, 10);
  const yesterdayKey = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const dayLabel = (k: string) => {
    if (k === todayKey)     return isRu ? "Сегодня"  : "Today";
    if (k === yesterdayKey) return isRu ? "Вчера"    : "Yesterday";
    const d = new Date(k);
    return d.toLocaleDateString(isRu ? "ru-RU" : "en-US", { day: "numeric", month: "long" });
  };
  const feedHtml = `
    <section class="news-feed" aria-labelledby="news-feed-h">
      <div class="news-sec-head"><h2 id="news-feed-h">${escHtml(isRu ? "Лента новостей" : "Newsfeed")}</h2><span class="news-sec-tail"></span></div>
      ${sortedKeys.map((k) => `
        <h3 class="news-feed__day">${escHtml(dayLabel(k))}</h3>
        <ol>${groups.get(k)!.map((p) => { const t = timeOnly(p.publishedAt); return `<li><time datetime="${escAttr(t.dt)}">${escHtml(t.hhmm || "—")}</time><a href="/posts/${escAttr(p.slug)}.html">${escHtml(p.title)}</a><span class="news-feed__arrow">→</span></li>`; }).join("")}</ol>`).join("")}
    </section>`;

  const sparkSvg = (key: string, accent: string) => {
    const pts: number[] = [];
    for (let i = 0; i < 8; i++) pts.push(intFromSeed(8, 38, `${seed}:spark:${key}:${i}`));
    const path = pts.map((y, i) => `${i === 0 ? "M" : "L"}${(i / (pts.length - 1)) * 100} ${42 - y}`).join(" ");
    return `<svg viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" fill="none" stroke="${accent}" stroke-width="2"/></svg>`;
  };
  const dr3 = intFromSeed(0, 1, `${seed}:dr3`);
  const analyticsCards = [
    { cap: isRu ? "Объем рынка" : "Market size",  num: `${intFromSeed(120, 980, `${seed}:an1`)} ${isRu ? "млрд" : "B"}`, delta: `+${intFromSeed(2, 18, `${seed}:dt1`)}%`, up: true },
    { cap: isRu ? "Средний чек" : "Avg ticket",   num: `${intFromSeed(1200, 9800, `${seed}:an2`)}`, delta: `+${intFromSeed(1, 9, `${seed}:dt2`)}%`, up: true },
    { cap: isRu ? "Доля онлайн" : "Online share", num: `${intFromSeed(18, 62, `${seed}:an3`)}%`, delta: `${dr3 === 0 ? "+" : "-"}${intFromSeed(1, 6, `${seed}:dt3`)}%`, up: dr3 === 0 },
  ];
  const analyticsHtml = `
    <section class="news-analytics" aria-labelledby="news-an-h">
      <div class="news-sec-head"><h2 id="news-an-h">${escHtml(isRu ? "Аналитика рынка" : "Market analytics")}</h2><span class="news-sec-tail"></span></div>
      <div class="news-analytics__row">
        ${analyticsCards.map((a) => `
          <div class="news-analytics-card">
            <div class="news-an-cap">${escHtml(a.cap)}</div>
            <div class="news-an-num">${escHtml(a.num)}</div>
            <div class="news-an-delta ${a.up ? "is-up" : "is-down"}">${a.up ? "▲" : "▼"} ${escHtml(a.delta)}</div>
            ${sparkSvg(a.cap, a.up ? "#16a34a" : "#dc2626")}
          </div>`).join("")}
      </div>
    </section>`;

  const expert = opts.expertAuthor || pickAuthorByIndex(c.authors || [], 0);
  const interviewHtml = expert ? `
    <section class="news-interview" aria-label="${escAttr(isRu ? "Экспертное мнение" : "Expert opinion")}">
      <img src="${escAttr(portraitUrl(expert, c.accent, seed))}" alt="${escAttr(expert.name)}" width="160" height="160" loading="lazy" decoding="async">
      <div>
        <blockquote>${escHtml(pickPhrase("expertQuote", c.lang, seed))}</blockquote>
        <cite><b>${escHtml(expert.name)}</b>${expert.role ? escHtml(expert.role) : ""}</cite>
        <a class="news-int-cta" href="/blog/">${escHtml(isRu ? "Читать интервью" : "Read interview")} →</a>
      </div>
    </section>` : "";

  const blogLd = { "@context": "https://schema.org", "@type": "WebSite", "url": `https://${c.domain}/`, "name": c.siteName };
  const head = buildHead(c, {
    title: `${c.siteName} — ${isRu ? "новости и аналитика" : "news and analytics"}`,
    description: c.siteAbout || `${c.siteName} — ${c.topic}`,
    path: "/", type: "website",
    breadcrumbs: [{ label: isRu ? "Главная" : "Home", href: "/" }],
    jsonLd: [blogLd as any],
  });

  const pixel = (c.projectId && c.trackerUrl)
    ? `<img src="${escAttr(c.trackerUrl)}?site=${escAttr(c.projectId)}&u=${encodeURIComponent("/")}" width="1" height="1" alt="" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade">`
    : "";
  const lead = (c.teamMembers && c.teamMembers[0]) || null;
  const widgets = renderSiteWidgets({
    lang: c.lang as "ru" | "en", accent: c.accent,
    consultantName: lead?.name || (c.companyName || c.siteName), consultantPhoto: undefined,
    siteName: c.siteName, topic: c.topic,
    totopPosition: c.totopPosition || "left-bottom", seed,
  });

  return `${head}
<body class="page-news page-home">
  ${headerHtml(c)}
  ${utility}
  ${rubricNav}
  ${breaking}
  <main class="news-shell" id="main-content" role="main">
    ${topHtml}
    <div class="news-grid">
      <div class="news-grid__main">${mediumCardsHtml}${compactCardsHtml}</div>
      ${sidebarHtml}
    </div>
    ${feedHtml}
    ${analyticsHtml}
    ${interviewHtml}
  </main>
  ${footerHtml(c)}
  ${widgets}
  ${pixel}
</body>
</html>`;
}

function injectInlineCards(html: string, related: PostInput[], c: SiteChrome, isRu: boolean): string {
  if (!related.length) return html;
  const parts = html.split(/(<\/p>)/i);
  let pCount = 0, inserted = 0;
  const buf: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    buf.push(parts[i]);
    if (parts[i].toLowerCase() === "</p>") {
      pCount++;
      if (pCount % 3 === 0 && inserted < related.length) {
        const r = related[inserted++];
        buf.push(`
          <a class="news-article-inline" href="/posts/${escAttr(r.slug)}.html">
            <img src="${escAttr(postImage(r, 240, 180))}" alt="${escAttr(uniqueImageAlt(c, r.title, 4))}" width="120" height="90" loading="lazy" decoding="async">
            <div><span>${escHtml(isRu ? "По теме" : "Related")}</span><h4>${escHtml(r.title)}</h4></div>
          </a>`);
      }
    }
  }
  return buf.join("");
}

export interface NewsArticleOpts { chrome: SiteChrome; post: PostInput; related: PostInput[]; popular: PostInput[]; postIndex?: number; }

export function renderNewsArticle(opts: NewsArticleOpts): string {
  const { chrome: c, post, related, popular } = opts;
  const isRu = c.lang === "ru";
  const seed = siteSeed(c);
  const rubrics = buildRubrics(c);
  const idx = typeof opts.postIndex === "number" ? opts.postIndex : 0;
  const rub = rubricByIndex(idx, rubrics);
  const author = pickAuthorByIndex(c.authors || [], idx) || pickAuthor(c.authors || [], post.slug);
  const minutes = readingTime(post.contentHtml);
  const views = fakeViews(post.slug, seed);
  const dateMain = fmtFullDate(post.publishedAt, isRu);
  const heroAlt = uniqueImageAlt(c, post.title, 0);
  const heroUrl = postImage(post, 1200, 720);

  const breadcrumbs = [
    { label: isRu ? "Главная" : "Home", href: "/" },
    { label: rub.label, href: "/blog/" },
    { label: post.title, href: `/posts/${post.slug}.html` },
  ];

  const head = buildHead(c, {
    title: `${post.title} — ${c.siteName}`,
    description: post.excerpt,
    path: `/posts/${post.slug}.html`,
    type: "article", ogImage: heroUrl,
    publishedTime: post.publishedAt,
    modifiedTime: post.modifiedAt || post.publishedAt,
    breadcrumbs,
  });

  const bodyWithInline = injectInlineCards(post.contentHtml, related, c, isRu);

  const tagPool = (c.topic || "").split(/[,\s]+/).filter((w) => w.length >= 3).slice(0, 5);
  const tagsHtml = tagPool.length ? `
    <nav class="news-tags" aria-label="${escAttr(isRu ? "Теги" : "Tags")}">
      ${tagPool.map((t) => `<a href="/blog/" rel="tag">#${escHtml(t)}</a>`).join("")}
    </nav>` : "";

  const sourcesHtml = `
    <div class="news-sources"><b>${escHtml(isRu ? "Источники:" : "Sources:")}</b>
      ${escHtml(isRu ? " данные отрасли, открытые публикации, экспертные интервью." : " industry data, public publications, expert interviews.")}
    </div>`;

  const shareUrl = `https://${c.domain}/posts/${post.slug}.html`;
  const shareHtml = `
    <span class="news-share" aria-label="${escAttr(isRu ? "Поделиться" : "Share")}">
      <a href="https://vk.com/share.php?url=${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener">VK</a>
      <a href="https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(post.title)}" target="_blank" rel="noopener">TG</a>
    </span>`;

  const breadcrumbsHtml = `
    <nav class="breadcrumbs news-shell" aria-label="${escAttr(isRu ? "Хлебные крошки" : "Breadcrumbs")}" style="padding-top:14px;font-size:13px;color:#7a7e88">
      <ol style="list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:6px">
        ${breadcrumbs.map((b, i, a) => i === a.length - 1
          ? `<li aria-current="page">${escHtml(b.label)}</li>`
          : `<li><a href="${escAttr(b.href)}" style="color:inherit">${escHtml(b.label)}</a> <span aria-hidden="true">›</span></li>`).join("")}
      </ol>
    </nav>`;

  const otherByAuthor = popular.filter((p) => p.slug !== post.slug).slice(0, 4);
  const asideHtml = `
    <aside class="sidebar" role="complementary" aria-label="${escAttr(isRu ? "Боковая колонка" : "Sidebar")}">
      ${author && otherByAuthor.length ? `
      <div class="sidebar-widget"><h4>${escHtml(isRu ? "Другие материалы автора" : "More from author")}</h4>
        <ol>${otherByAuthor.map((p) => `<li><a href="/posts/${escAttr(p.slug)}.html">${escHtml(p.title)}</a></li>`).join("")}</ol>
      </div>` : ""}
      ${popular.length ? `
      <div class="sidebar-widget"><h4>${escHtml(isRu ? "Самое читаемое сегодня" : "Most read today")}</h4>
        <ol>${popular.slice(0, 5).map((p) => `<li><a href="/posts/${escAttr(p.slug)}.html">${escHtml(p.title)}</a></li>`).join("")}</ol>
      </div>` : ""}
      <div class="sidebar-widget sidebar-widget--newsletter"><h4>${escHtml(isRu ? "Подписка на рубрику" : "Subscribe to topic")}</h4>
        <p>${escHtml(rub.label)}: ${escHtml(isRu ? "новые материалы раз в неделю." : "fresh stories once a week.")}</p>
        <form onsubmit="event.preventDefault();this.querySelector('button').textContent='${escAttr(isRu ? "Готово!" : "Done!")}';return false">
          <input type="email" required placeholder="${escAttr(isRu ? "Ваш email" : "Your email")}" autocomplete="email">
          <button type="submit">${escHtml(isRu ? "Подписаться" : "Subscribe")}</button>
        </form>
      </div>
    </aside>`;

  const pixel = (c.projectId && c.trackerUrl)
    ? `<img src="${escAttr(c.trackerUrl)}?site=${escAttr(c.projectId)}&u=${encodeURIComponent(`/posts/${post.slug}.html`)}" width="1" height="1" alt="" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade">`
    : "";
  const lead = (c.teamMembers && c.teamMembers[0]) || null;
  const widgets = renderSiteWidgets({
    lang: c.lang as "ru" | "en", accent: c.accent,
    consultantName: lead?.name || (c.companyName || c.siteName), consultantPhoto: undefined,
    siteName: c.siteName, topic: c.topic,
    totopPosition: c.totopPosition || "left-bottom", seed,
  });

  return `${head}
<body class="page-news page-post">
  ${headerHtml(c)}
  ${breadcrumbsHtml}
  <div class="news-shell">
    <div class="news-article-wrap">
      <article class="news-article" itemscope itemtype="https://schema.org/NewsArticle">
        <header class="news-article-head">
          <span class="news-rubric-tag" style="background:${rub.color}">${escHtml(rub.label)}</span>
          <h1 itemprop="headline">${escHtml(post.title)}</h1>
          ${post.excerpt ? `<p class="news-article-lead">${escHtml(post.excerpt)}</p>` : ""}
          <div class="news-article-meta">
            ${author ? `<address itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">${escHtml(author.name)}</span></address>` : ""}
            ${dateMain.label ? `<time datetime="${escAttr(dateMain.dt)}" itemprop="datePublished">${escHtml(dateMain.label)}</time>` : ""}
            <span>${minutes} ${escHtml(isRu ? "мин чтения" : "min read")}</span>
            <span>${fmtViews(views)} ${escHtml(isRu ? "просмотров" : "views")}</span>
            ${shareHtml}
          </div>
        </header>
        <figure class="news-article-figure">
          <img src="${escAttr(heroUrl)}" alt="${escAttr(heroAlt)}" width="1200" height="720" loading="eager" decoding="async" fetchpriority="high" itemprop="image">
        </figure>
        <div class="news-article-body" itemprop="articleBody">${bodyWithInline}</div>
        ${tagsHtml}
        ${sourcesHtml}
      </article>
      ${asideHtml}
    </div>
  </div>
  ${footerHtml(c)}
  ${widgets}
  ${pixel}
</body>
</html>`;
}

export function newsExtraCss(c: SiteChrome): string { return newsCss(c); }
