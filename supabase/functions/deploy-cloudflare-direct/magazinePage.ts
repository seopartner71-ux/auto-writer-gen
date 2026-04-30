// ============================================================================
// Magazine homepage + article page generator (Site Factory template №2).
//
// Different HTML skeleton from the bundled "landing" template:
//  - Editorial / online-magazine vibe (vc.ru / habr.com style for a niche).
//  - Light theme, content-first, no lead-capture form on the home page.
//  - Semantic tags: <header>/<main>/<article>/<aside>/<figure>/<time>.
//  - Sticky sidebar on the post page; serif headings; 720px reading column.
//
// Re-uses the existing chrome (head, header, footer, widgets, cookie banner,
// breadcrumbs, JSON-LD, anti-fingerprint, WP emulation, custom 404 etc.) so
// that EVERY anti-footprint and SEO feature already wired into the factory
// works automatically — only the middle section of the page is bespoke.
// ============================================================================
//
// Deterministic by projectId — every random pick passes through `seed`, so
// a redeploy produces byte-identical HTML and different sites in the same
// PBN look distinct to fingerprint scanners.

import {
  type SiteChrome, type PostInput, type Author,
  buildHead, headerHtml, footerHtml, chromeStyles,
  pickAuthor, pickAuthorByIndex, portraitUrl, uniqueImageAlt, siteSeed,
} from "./seoChrome.ts";
import { pickPhrase, pickFromSeed, intFromSeed, seedRng } from "./phrasePools.ts";
import { widgetsHtml as renderSiteWidgets } from "./siteWidgets.ts";

function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escAttr(s: string): string { return escHtml(s); }

// ---------------------------------------------------------------------------
// Categories — derived from posts (rotated through 4 fixed buckets so every
// site shows the same 4 sections regardless of how many posts are seeded).
// ---------------------------------------------------------------------------

interface MagCategory { key: string; label: string; icon: string; }

function buildCategories(c: SiteChrome): MagCategory[] {
  const seed = siteSeed(c);
  const isRu = c.lang === "ru";
  return [
    { key: "tips",    label: pickPhrase("magCategoryTips",    c.lang, seed), icon: "💡" },
    { key: "reviews", label: pickPhrase("magCategoryReviews", c.lang, seed), icon: "⚖" },
    { key: "news",    label: pickPhrase("magCategoryNews",    c.lang, seed), icon: "📰" },
    { key: "guides",  label: pickPhrase("magCategoryGuides", c.lang, seed), icon: "📖" },
  ];
}

// Round-robin category assignment by post index — guarantees an even
// distribution across all rubrics (slug-hash variant could cluster every
// post in 1-2 categories and leave the rest empty).
function postCategoryByIndex(idx: number, cats: MagCategory[]): MagCategory {
  const n = cats.length;
  return cats[((idx % n) + n) % n];
}

// ---------------------------------------------------------------------------
// Reading time (≈ 220 wpm) and a stable pseudo-views number per post.
// ---------------------------------------------------------------------------
function readingTime(html: string): number {
  const text = String(html || "").replace(/<[^>]+>/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.round(words / 220));
}
function fakeViews(slug: string, seed: string): number {
  // 480..18 700 — believable range for an indie blog post
  const n = intFromSeed(480, 18700, `${seed}:views:${slug}`);
  return n;
}
function fmtViews(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}
function fmtDate(iso: string | undefined, isRu: boolean): { label: string; dt: string } {
  if (!iso) return { label: "", dt: "" };
  const d = new Date(iso);
  const dt = d.toISOString();
  const label = d.toLocaleDateString(isRu ? "ru-RU" : "en-US", { year: "numeric", month: "long", day: "numeric" });
  return { label, dt };
}

// Picsum fallback for a post without a featured image.
function postImage(p: PostInput, w = 1200, h = 720): string {
  if (p.featuredImageUrl && /^https?:\/\//.test(p.featuredImageUrl)) return p.featuredImageUrl;
  const seed = encodeURIComponent(p.slug || p.title || "post").slice(0, 60);
  return `https://picsum.photos/seed/${seed}/${w}/${h}`;
}

// ---------------------------------------------------------------------------
// Magazine-specific CSS (scoped to .mag-* classes so it never collides with
// the landing template). Uses serif headings + sans body for editorial feel.
// ---------------------------------------------------------------------------
function magazineCss(c: SiteChrome): string {
  const acc = c.accent;
  return `
:root{--mag-accent:${acc}}
body{background:#fff;color:#1a1a1a;font-family:'${c.bodyFont}','Inter',system-ui,-apple-system,sans-serif;font-size:17px;line-height:1.65}
.mag-shell{max-width:1200px;margin:0 auto;padding:0 24px}
.mag-rubric-bar{border-bottom:1px solid #e8e8ea;background:#fafafa}
.mag-rubric-bar nav{display:flex;gap:6px;overflow-x:auto;padding:10px 0;font-size:13px;letter-spacing:.02em}
.mag-rubric-bar a{padding:6px 12px;border-radius:999px;color:#444;text-decoration:none;white-space:nowrap;font-weight:500;transition:.2s}
.mag-rubric-bar a:hover{background:${acc}14;color:${acc}}
.mag-rubric-bar a.is-active{background:#1a1a1a;color:#fff}
.mag-hero{position:relative;margin:32px 0 48px;border-radius:14px;overflow:hidden;background:#0f0f10;min-height:420px}
.mag-hero figure{margin:0;position:relative}
.mag-hero img{width:100%;height:520px;object-fit:cover;display:block;opacity:.78}
@media(max-width:760px){.mag-hero img{height:360px}}
.mag-hero figcaption{position:absolute;left:0;right:0;bottom:0;padding:48px 36px;color:#fff;background:linear-gradient(to top,rgba(0,0,0,.85) 30%,transparent)}
.mag-hero .mag-rubric-tag{display:inline-block;background:${acc};color:#fff;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:14px}
.mag-hero h1{font-family:'${c.headingFont}',Georgia,serif;font-size:46px;line-height:1.15;font-weight:700;margin:0 0 16px;max-width:820px;letter-spacing:-.01em}
@media(max-width:760px){.mag-hero h1{font-size:30px} .mag-hero figcaption{padding:24px 20px}}
.mag-hero .mag-meta{font-size:14px;color:rgba(255,255,255,.85);display:flex;flex-wrap:wrap;gap:14px;align-items:center}
.mag-hero a{color:inherit;text-decoration:none}
.mag-hero a:hover h1{text-decoration:underline}
.mag-grid{display:grid;grid-template-columns:2fr 1fr;gap:32px;margin:0 0 56px}
@media(max-width:880px){.mag-grid{grid-template-columns:1fr;gap:24px}}
.mag-grid__main{background:#fff;border:1px solid #ececef;border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.mag-grid__main figure{margin:0}
.mag-grid__main img{width:100%;height:340px;object-fit:cover;display:block}
.mag-grid__main .mag-card-body{padding:22px 26px 28px}
.mag-grid__main h2{font-family:'${c.headingFont}',Georgia,serif;font-size:28px;line-height:1.25;margin:6px 0 10px;color:#1a1a1a}
.mag-grid__main p{margin:0 0 12px;color:#454952;font-size:16px}
.mag-grid__side{display:grid;grid-template-rows:repeat(3,1fr);gap:14px}
.mag-side-card{background:#fff;border:1px solid #ececef;border-radius:10px;padding:14px 16px;display:flex;gap:14px;text-decoration:none;color:inherit;transition:.2s}
.mag-side-card:hover{border-color:${acc};transform:translateY(-2px)}
.mag-side-card img{width:96px;height:80px;object-fit:cover;border-radius:6px;flex-shrink:0}
.mag-side-card h3{font-family:'${c.headingFont}',Georgia,serif;font-size:16px;line-height:1.3;margin:0 0 6px;color:#1a1a1a;font-weight:600}
.mag-side-card .mag-side-meta{font-size:12px;color:#7a7e88}
.mag-row{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-bottom:64px}
@media(max-width:760px){.mag-row{grid-template-columns:1fr}}
.mag-row article{background:#fff;border:1px solid #ececef;border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.mag-row figure{margin:0}
.mag-row img{width:100%;height:200px;object-fit:cover;display:block}
.mag-row .mag-card-body{padding:18px 20px 22px;flex:1;display:flex;flex-direction:column}
.mag-row h3{font-family:'${c.headingFont}',Georgia,serif;font-size:19px;line-height:1.3;margin:0 0 8px;color:#1a1a1a}
.mag-row .mag-meta{margin-top:auto;padding-top:10px;font-size:12px;color:#7a7e88;display:flex;gap:10px;flex-wrap:wrap}
.mag-rubric-tag{display:inline-block;background:${acc}1f;color:${acc};padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin-bottom:8px}
.mag-meta{display:flex;gap:12px;flex-wrap:wrap;font-size:13px;color:#7a7e88;align-items:center}
.mag-meta time{color:inherit}
.mag-meta a{color:inherit}
.mag-card-body a{text-decoration:none;color:inherit}
.mag-card-body a:hover h2,.mag-card-body a:hover h3{color:${acc}}
.mag-about{background:#f5f5f4;border-top:1px solid #ececef;border-bottom:1px solid #ececef;padding:48px 24px;margin:0 -24px 64px;text-align:center}
.mag-about h2{font-family:'${c.headingFont}',Georgia,serif;font-size:28px;margin:0 0 12px;color:#1a1a1a;font-weight:700}
.mag-about p{max-width:680px;margin:0 auto 22px;color:#454952;font-size:17px;line-height:1.65}
.mag-about a.mag-btn{display:inline-block;background:#1a1a1a;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;transition:.2s}
.mag-about a.mag-btn:hover{background:${acc}}
.mag-categories{margin:0 0 64px}
.mag-categories h2{font-family:'${c.headingFont}',Georgia,serif;font-size:24px;margin:0 0 24px;color:#1a1a1a;text-align:center}
.mag-cats{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
@media(max-width:760px){.mag-cats{grid-template-columns:1fr}}
.mag-cats a{display:block;background:#fff;border:1px solid #ececef;border-radius:10px;padding:24px 22px;text-decoration:none;color:inherit;text-align:left;transition:.2s}
.mag-cats a:hover{border-color:${acc};transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.05)}
.mag-cats .mag-cat-ico{font-size:32px;line-height:1;margin-bottom:14px}
.mag-cats h3{font-family:'${c.headingFont}',Georgia,serif;font-size:18px;margin:0 0 4px;color:#1a1a1a}
.mag-cats .mag-cat-count{font-size:13px;color:#7a7e88}
.mag-popular{margin:0 0 64px;display:grid;grid-template-columns:1fr 1fr;gap:32px}
@media(max-width:760px){.mag-popular{grid-template-columns:1fr}}
.mag-popular__col h2{font-family:'${c.headingFont}',Georgia,serif;font-size:22px;margin:0 0 18px;padding-bottom:10px;border-bottom:2px solid #1a1a1a}
.mag-pop-list{list-style:none;padding:0;margin:0;counter-reset:pop}
.mag-pop-list li{counter-increment:pop;display:flex;gap:16px;padding:14px 0;border-bottom:1px solid #ececef}
.mag-pop-list li:last-child{border-bottom:0}
.mag-pop-list li::before{content:counter(pop);font-family:'${c.headingFont}',Georgia,serif;font-size:32px;line-height:1;font-weight:700;color:${acc};min-width:32px;opacity:.6}
.mag-pop-list a{color:#1a1a1a;text-decoration:none;font-weight:500;line-height:1.35}
.mag-pop-list a:hover{color:${acc}}
.mag-pop-list .mag-pop-meta{font-size:12px;color:#7a7e88;margin-top:4px}
.mag-expert{background:#1a1a1a;color:#fff;padding:48px 36px;border-radius:14px;display:grid;grid-template-columns:auto 1fr;gap:32px;align-items:center;margin:0 0 64px}
@media(max-width:760px){.mag-expert{grid-template-columns:1fr;text-align:center;padding:32px 24px}}
.mag-expert img{width:140px;height:140px;border-radius:50%;object-fit:cover;border:3px solid ${acc}}
.mag-expert h2{font-family:'${c.headingFont}',Georgia,serif;font-size:14px;letter-spacing:.1em;text-transform:uppercase;color:${acc};margin:0 0 12px;font-weight:700}
.mag-expert blockquote{font-family:'${c.headingFont}',Georgia,serif;font-size:22px;line-height:1.45;margin:0 0 14px;color:#fff;font-style:italic}
.mag-expert .mag-expert-name{font-weight:600;font-size:16px;color:#fff;margin:0 0 4px}
.mag-expert .mag-expert-role{font-size:13px;color:rgba(255,255,255,.6);margin:0 0 14px}
.mag-expert a{display:inline-block;color:${acc};text-decoration:none;font-weight:600;font-size:14px;border-bottom:1px solid ${acc}55;padding-bottom:2px}
.mag-expert a:hover{border-color:${acc}}
.mag-newsletter{background:linear-gradient(135deg,${acc}10,${acc}05);border:1px solid ${acc}33;border-radius:14px;padding:48px 32px;text-align:center;margin:0 0 64px}
.mag-newsletter h2{font-family:'${c.headingFont}',Georgia,serif;font-size:26px;margin:0 0 8px;color:#1a1a1a}
.mag-newsletter p{color:#454952;margin:0 0 22px;font-size:16px}
.mag-news-form{display:flex;gap:8px;max-width:480px;margin:0 auto;flex-wrap:wrap;justify-content:center}
.mag-news-form input{flex:1;min-width:220px;padding:12px 16px;border:1px solid #d4d4d4;border-radius:6px;font:inherit;background:#fff}
.mag-news-form input:focus{outline:0;border-color:${acc}}
.mag-news-form button{padding:12px 24px;border:0;border-radius:6px;background:${acc};color:#fff;font:inherit;font-weight:600;cursor:pointer;transition:.2s}
.mag-news-form button:hover{filter:brightness(1.1)}
.mag-news-msg{margin-top:14px;font-size:13px;color:#16a34a;display:none}
.mag-news-msg.show{display:block}
/* ---- Article page (magazine variant) ---- */
.mag-article-wrap{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:48px;max-width:1200px;margin:0 auto;padding:32px 24px 64px}
@media(max-width:980px){.mag-article-wrap{grid-template-columns:1fr;padding:24px 20px}}
.mag-article-head{margin:0 0 24px}
.mag-article-head .mag-rubric-tag{margin-bottom:14px}
.mag-article-head h1{font-family:'${c.headingFont}',Georgia,serif;font-size:44px;line-height:1.18;letter-spacing:-.01em;color:#1a1a1a;margin:0 0 18px;font-weight:700}
@media(max-width:760px){.mag-article-head h1{font-size:30px}}
.mag-article-head .mag-meta{font-size:13px;color:#7a7e88;margin-bottom:24px}
.mag-article-figure{margin:0 0 36px}
.mag-article-figure img{width:100%;height:auto;border-radius:10px;display:block}
.mag-article-figure figcaption{font-size:13px;color:#7a7e88;text-align:center;margin-top:10px;font-style:italic}
.mag-article-body{max-width:720px;font-size:18px;line-height:1.75;color:#222}
.mag-article-body h2{font-family:'${c.headingFont}',Georgia,serif;font-size:30px;margin:48px 0 16px;color:#1a1a1a;line-height:1.25;scroll-margin-top:80px}
.mag-article-body h3{font-family:'${c.headingFont}',Georgia,serif;font-size:22px;margin:32px 0 12px;color:#1a1a1a;line-height:1.3;scroll-margin-top:80px}
.mag-article-body p{margin:0 0 18px}
.mag-article-body blockquote{border-left:4px solid ${acc};padding:8px 0 8px 24px;margin:28px 0;font-family:'${c.headingFont}',Georgia,serif;font-size:21px;line-height:1.5;color:#1a1a1a;font-style:italic}
.mag-article-body ul,.mag-article-body ol{padding-left:24px;margin:0 0 22px}
.mag-article-body li{margin:0 0 8px}
.mag-article-body img{max-width:100%;height:auto;border-radius:8px;margin:24px 0}
.mag-article-body a{color:${acc};text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
.mag-article-body table{width:100%;border-collapse:collapse;margin:24px 0;font-size:15px}
.mag-article-body th,.mag-article-body td{border:1px solid #ececef;padding:10px 14px;text-align:left}
.mag-article-body thead th{background:#fafafa;font-weight:600}
.mag-toc{background:#fafafa;border:1px solid #ececef;border-radius:8px;padding:18px 22px;margin:0 0 32px}
.mag-toc h4{font-family:'${c.headingFont}',Georgia,serif;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#7a7e88;margin:0 0 10px;font-weight:700}
.mag-toc ol{margin:0;padding-left:22px;font-size:15px}
.mag-toc a{color:#1a1a1a;text-decoration:none}
.mag-toc a:hover{color:${acc}}
.mag-tags{margin:32px 0;display:flex;flex-wrap:wrap;gap:8px}
.mag-tags a{background:#f5f5f4;color:#454952;padding:6px 14px;border-radius:999px;font-size:13px;text-decoration:none;transition:.2s}
.mag-tags a:hover{background:${acc};color:#fff}
.mag-author-block{background:#f5f5f4;border-radius:12px;padding:28px;margin:40px 0;display:grid;grid-template-columns:auto 1fr;gap:22px;align-items:start}
@media(max-width:600px){.mag-author-block{grid-template-columns:1fr;text-align:center}}
.mag-author-block img{width:88px;height:88px;border-radius:50%;object-fit:cover}
.mag-author-block h4{font-family:'${c.headingFont}',Georgia,serif;font-size:18px;margin:0 0 4px;color:#1a1a1a}
.mag-author-block .mag-author-role{font-size:13px;color:#7a7e88;margin:0 0 10px}
.mag-author-block p{margin:0;font-size:15px;color:#454952;line-height:1.6}
.mag-related{margin:48px 0 0;border-top:1px solid #ececef;padding-top:32px}
.mag-related h3{font-family:'${c.headingFont}',Georgia,serif;font-size:20px;margin:0 0 20px;color:#1a1a1a}
.mag-related-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
@media(max-width:760px){.mag-related-grid{grid-template-columns:1fr}}
.mag-related-grid a{display:block;text-decoration:none;color:inherit;background:#fff;border:1px solid #ececef;border-radius:10px;overflow:hidden;transition:.2s}
.mag-related-grid a:hover{border-color:${acc};transform:translateY(-2px)}
.mag-related-grid img{width:100%;height:140px;object-fit:cover;display:block}
.mag-related-grid h4{font-family:'${c.headingFont}',Georgia,serif;font-size:15px;margin:0;padding:12px 14px;line-height:1.35;color:#1a1a1a;font-weight:600}
.mag-comments{background:#fafafa;border:1px solid #ececef;border-radius:10px;padding:28px;margin:48px 0 0;text-align:center}
.mag-comments h3{font-family:'${c.headingFont}',Georgia,serif;font-size:20px;margin:0 0 8px;color:#1a1a1a}
.mag-comments p{color:#7a7e88;margin:0 0 18px;font-size:14px}
.mag-comments form{display:grid;gap:10px;max-width:520px;margin:0 auto;text-align:left}
.mag-comments input,.mag-comments textarea{padding:10px 14px;border:1px solid #d4d4d4;border-radius:6px;font:inherit;background:#fff}
.mag-comments button{padding:10px 22px;border:0;border-radius:6px;background:#1a1a1a;color:#fff;font:inherit;font-weight:600;cursor:pointer;justify-self:start}
.mag-aside{position:sticky;top:24px;align-self:start;display:flex;flex-direction:column;gap:24px;font-size:14px}
@media(max-width:980px){.mag-aside{position:static}}
.mag-aside-block{background:#fff;border:1px solid #ececef;border-radius:10px;padding:20px}
.mag-aside-block h4{font-family:'${c.headingFont}',Georgia,serif;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#7a7e88;margin:0 0 12px;font-weight:700}
.mag-aside-block ul{list-style:none;padding:0;margin:0}
.mag-aside-block li{padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;line-height:1.4}
.mag-aside-block li:last-child{border-bottom:0}
.mag-aside-block a{color:#1a1a1a;text-decoration:none}
.mag-aside-block a:hover{color:${acc}}
.mag-aside-author{display:flex;gap:12px;align-items:center}
.mag-aside-author img{width:48px;height:48px;border-radius:50%;object-fit:cover}
.mag-aside-author strong{display:block;font-size:14px;color:#1a1a1a}
.mag-aside-author span{font-size:12px;color:#7a7e88}
.mag-aside-cta{background:linear-gradient(135deg,${acc},${acc}cc);color:#fff;border-radius:10px;padding:24px}
.mag-aside-cta h4{color:rgba(255,255,255,.85);margin:0 0 8px;font-size:12px}
.mag-aside-cta p{margin:0 0 14px;font-size:15px;color:#fff;line-height:1.45}
.mag-aside-cta a{display:inline-block;background:#fff;color:${acc};padding:8px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px}
`;
}

// ---------------------------------------------------------------------------
// Magazine HOMEPAGE
// ---------------------------------------------------------------------------

export interface MagazineHomeOpts {
  chrome: SiteChrome;
  posts: PostInput[];
  expertAuthor?: Author | null;
}

export function renderMagazineHome(opts: MagazineHomeOpts): string {
  const { chrome: c, posts } = opts;
  const isRu = c.lang === "ru";
  const seed = siteSeed(c);
  const cats = buildCategories(c);
  const list = posts.slice(0, 16);
  const hero    = list[0];
  const featured = list[1] || hero;
  const sideTop  = list.slice(2, 5);
  const rowMid   = list.slice(5, 8);
  const popular  = list.slice(0, 5);

  // Build a stable slug -> global-index map across the whole post array
  // so author/category rotation is consistent on the homepage AND on each
  // individual article page.
  const idxBySlug = new Map<string, number>();
  posts.forEach((p, i) => idxBySlug.set(p.slug, i));
  const idxOf = (slug: string) => idxBySlug.get(slug) ?? 0;
  const catOf = (slug: string) => postCategoryByIndex(idxOf(slug), cats);
  const authorOf = (slug: string) =>
    pickAuthorByIndex(c.authors || [], idxOf(slug));

  const minLabelPool = pickPhrase("magReadingTime", c.lang, seed);

  const heroHtml = hero ? `
    <section class="mag-hero" aria-label="${escAttr(isRu ? "Главный материал" : "Featured story")}">
      <a href="/posts/${escAttr(hero.slug)}.html">
        <figure>
          <img src="${escAttr(postImage(hero, 1600, 720))}" alt="${escAttr(uniqueImageAlt(c, hero.title, 0))}" width="1600" height="720" loading="eager" decoding="async" fetchpriority="high">
          <figcaption>
            <span class="mag-rubric-tag">${escHtml(catOf(hero.slug).label)}</span>
            <h1>${escHtml(hero.title)}</h1>
            <div class="mag-meta">
              ${(() => { const a = authorOf(hero.slug); return a ? `<address style="font-style:normal">${escHtml(a.name)}</address>` : ""; })()}
              ${hero.publishedAt ? (() => { const d = fmtDate(hero.publishedAt, isRu); return `<time datetime="${escAttr(d.dt)}">${escHtml(d.label)}</time>`; })() : ""}
              <span>${readingTime(hero.contentHtml)} ${escHtml(minLabelPool)}</span>
            </div>
          </figcaption>
        </figure>
      </a>
    </section>` : "";

  const sideCardHtml = (p: PostInput): string => {
    const cat = catOf(p.slug);
    const d = fmtDate(p.publishedAt, isRu);
    return `
      <a class="mag-side-card" href="/posts/${escAttr(p.slug)}.html">
        <img src="${escAttr(postImage(p, 240, 200))}" alt="${escAttr(uniqueImageAlt(c, p.title, 1))}" width="96" height="80" loading="lazy" decoding="async">
        <div>
          <span class="mag-rubric-tag">${escHtml(cat.label)}</span>
          <h3>${escHtml(p.title)}</h3>
          <div class="mag-side-meta">${d.label ? `<time datetime="${escAttr(d.dt)}">${escHtml(d.label)}</time>` : ""}</div>
        </div>
      </a>`;
  };

  const featuredHtml = featured ? `
    <article class="mag-grid__main">
      <a href="/posts/${escAttr(featured.slug)}.html">
        <figure>
          <img src="${escAttr(postImage(featured, 1200, 680))}" alt="${escAttr(uniqueImageAlt(c, featured.title, 2))}" width="1200" height="680" loading="lazy" decoding="async">
        </figure>
        <div class="mag-card-body">
          <span class="mag-rubric-tag">${escHtml(catOf(featured.slug).label)}</span>
          <h2>${escHtml(featured.title)}</h2>
          <p>${escHtml(featured.excerpt)}</p>
          <div class="mag-meta">
            ${(() => { const a = authorOf(featured.slug); return a ? `<address style="font-style:normal">${escHtml(a.name)}</address>` : ""; })()}
            ${featured.publishedAt ? (() => { const d = fmtDate(featured.publishedAt, isRu); return `<time datetime="${escAttr(d.dt)}">${escHtml(d.label)}</time>`; })() : ""}
            <span>${readingTime(featured.contentHtml)} ${escHtml(minLabelPool)}</span>
          </div>
        </div>
      </a>
    </article>` : "";

  const rowMidHtml = rowMid.map((p) => {
    const cat = catOf(p.slug);
    const a = authorOf(p.slug);
    const d = fmtDate(p.publishedAt, isRu);
    return `
      <article>
        <a href="/posts/${escAttr(p.slug)}.html">
          <figure>
            <img src="${escAttr(postImage(p, 600, 400))}" alt="${escAttr(uniqueImageAlt(c, p.title, 3))}" width="600" height="400" loading="lazy" decoding="async">
          </figure>
          <div class="mag-card-body">
            <span class="mag-rubric-tag">${escHtml(cat.label)}</span>
            <h3>${escHtml(p.title)}</h3>
            <div class="mag-meta">
              ${a ? `<address style="font-style:normal">${escHtml(a.name)}</address>` : ""}
              ${d.label ? `<time datetime="${escAttr(d.dt)}">${escHtml(d.label)}</time>` : ""}
              <span>${readingTime(p.contentHtml)} ${escHtml(minLabelPool)}</span>
            </div>
          </div>
        </a>
      </article>`;
  }).join("");

  const aboutHtml = `
    <section class="mag-about" aria-labelledby="mag-about-h">
      <h2 id="mag-about-h">${escHtml(pickPhrase("magAboutTitle", c.lang, seed))}</h2>
      <p>${escHtml(pickPhrase("magAboutText", c.lang, seed))}</p>
      <a class="mag-btn" href="/blog/">${escHtml(pickPhrase("magReadAll", c.lang, seed))}</a>
    </section>`;

  // count posts per category
  const counts: Record<string, number> = {};
  for (const p of posts) {
    const k = catOf(p.slug).key;
    counts[k] = (counts[k] || 0) + 1;
  }
  const catsHtml = `
    <section class="mag-categories" aria-labelledby="mag-cats-h">
      <h2 id="mag-cats-h">${escHtml(pickPhrase("magCategoriesTitle", c.lang, seed))}</h2>
      <div class="mag-cats">
        ${cats.slice(0, 3).map((cat) => `
          <a href="/blog/" aria-label="${escAttr(cat.label)}">
            <div class="mag-cat-ico" aria-hidden="true">${cat.icon}</div>
            <h3>${escHtml(cat.label)}</h3>
            <div class="mag-cat-count">${counts[cat.key] || 0} ${escHtml(isRu ? "материалов" : "stories")}</div>
          </a>`).join("")}
      </div>
    </section>`;

  const popularHtml = popular.length ? `
    <section class="mag-popular" aria-labelledby="mag-pop-h">
      <div class="mag-popular__col">
        <h2 id="mag-pop-h">${escHtml(pickPhrase("magPopularTitle", c.lang, seed))}</h2>
        <ol class="mag-pop-list">
          ${popular.map((p) => {
            const d = fmtDate(p.publishedAt, isRu);
            const v = fakeViews(p.slug, seed);
            return `
              <li>
                <div>
                  <a href="/posts/${escAttr(p.slug)}.html">${escHtml(p.title)}</a>
                  <div class="mag-pop-meta">
                    ${d.label ? `<time datetime="${escAttr(d.dt)}">${escHtml(d.label)}</time>` : ""}
                    · ${fmtViews(v)} ${escHtml(pickPhrase("magViews", c.lang, seed))}
                  </div>
                </div>
              </li>`;
          }).join("")}
        </ol>
      </div>
      <div class="mag-popular__col">
        <h2>${escHtml(pickPhrase("magCategoriesTitle", c.lang, seed))}</h2>
        <ol class="mag-pop-list" style="counter-reset:none">
          ${cats.map((cat) => `
            <li style="display:block">
              <a href="/blog/">${escHtml(cat.label)}</a>
              <div class="mag-pop-meta">${counts[cat.key] || 0} ${escHtml(isRu ? "материалов" : "stories")}</div>
            </li>`).join("")}
        </ol>
      </div>
    </section>` : "";

  const expert = opts.expertAuthor || (c.authors && c.authors[0]) || null;
  const expertHtml = expert ? (() => {
    const ava = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(expert.avatar_seed || expert.name)}`;
    const quote = expert.bio
      ? expert.bio.split(/[.!?]/).filter((s) => s.trim().length > 20)[0] || expert.bio
      : (isRu ? "Хороший материал — это материал, который помогает читателю принять решение." : "A good story is one that helps the reader decide.");
    return `
    <section class="mag-expert" aria-labelledby="mag-expert-h">
      <img src="${escAttr(ava)}" alt="${escAttr(expert.name)}" width="140" height="140" loading="lazy" decoding="async">
      <div>
        <h2 id="mag-expert-h">${escHtml(pickPhrase("magExpertTitle", c.lang, seed))}</h2>
        <blockquote>«${escHtml(quote.trim())}»</blockquote>
        <div class="mag-expert-name">${escHtml(expert.name)}</div>
        ${expert.role ? `<div class="mag-expert-role">${escHtml(expert.role)}</div>` : ""}
        <a href="/about.html">${escHtml(pickPhrase("magExpertCta", c.lang, seed))} →</a>
      </div>
    </section>`;
  })() : "";

  const newsletterHtml = `
    <section class="mag-newsletter" aria-labelledby="mag-news-h">
      <h2 id="mag-news-h">${escHtml(pickPhrase("magNewsletterTitle", c.lang, seed))}</h2>
      <p>${escHtml(isRu
        ? `Получайте лучшие материалы по теме «${c.topic}» раз в неделю.`
        : `Get the best stories on ${c.topic} once a week.`)}</p>
      <form class="mag-news-form" onsubmit="event.preventDefault();var m=this.parentNode.querySelector('.mag-news-msg');if(m){m.classList.add('show')}this.reset();return false">
        <label class="mag-vh" for="mag-news-email" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Email</label>
        <input id="mag-news-email" type="email" required placeholder="${escAttr(isRu ? "Ваш email" : "Your email")}" autocomplete="email">
        <button type="submit">${escHtml(pickPhrase("magNewsletterButton", c.lang, seed))}</button>
      </form>
      <div class="mag-news-msg" role="status">${escHtml(isRu ? "Готово! Проверьте почту." : "Done! Check your inbox.")}</div>
    </section>`;

  const rubricBar = `
    <div class="mag-rubric-bar">
      <div class="mag-shell">
        <nav aria-label="${escAttr(isRu ? "Рубрики" : "Categories")}">
          <a class="is-active" href="/">${escHtml(pickPhrase("magCategoryAll", c.lang, seed))}</a>
          ${cats.map((cat) => `<a href="/blog/">${escHtml(cat.label)}</a>`).join("")}
        </nav>
      </div>
    </div>`;

  // -- Blog JSON-LD with first 8 posts as blogPost ----------------------------
  const blogLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "name": c.siteName,
    "url": `https://${c.domain}/`,
    "inLanguage": c.lang,
    "blogPost": posts.slice(0, 8).map((p) => ({
      "@type": "BlogPosting",
      "headline": p.title,
      "description": p.excerpt,
      "url": `https://${c.domain}/posts/${p.slug}.html`,
      "datePublished": p.publishedAt || undefined,
      "image": p.featuredImageUrl || undefined,
    })),
  };

  const head = buildHead(c, {
    title: `${c.siteName} — ${isRu ? "журнал о теме" : "magazine"} ${c.topic}`,
    description: c.siteAbout || `${c.siteName} — ${c.topic}`,
    path: "/",
    type: "website",
    breadcrumbs: [{ label: isRu ? "Главная" : "Home", href: "/" }],
    jsonLd: [blogLd as any],
  });

  // Pixel + widgets — same building blocks as wrapPage uses.
  const pixel = (c.projectId && c.trackerUrl)
    ? `<img src="${escAttr(c.trackerUrl)}?site=${escAttr(c.projectId)}&u=${encodeURIComponent("/")}" width="1" height="1" alt="" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade">`
    : "";
  const lead = (c.teamMembers && c.teamMembers[0]) || null;
  const widgets = renderSiteWidgets({
    lang: c.lang as "ru" | "en",
    accent: c.accent,
    consultantName: lead?.name || (c.companyName || c.siteName),
    consultantPhoto: undefined,
    siteName: c.siteName,
    topic: c.topic,
    totopPosition: c.totopPosition || "left-bottom",
    seed,
  });

  return `${head}
<body class="page-magazine page-home">
  ${headerHtml(c)}
  ${rubricBar}
  <main class="mag-shell" id="main-content">
    ${heroHtml}
    <div class="mag-grid">
      ${featuredHtml}
      <aside class="mag-grid__side" aria-label="${escAttr(isRu ? "Свежие материалы" : "Recent posts")}">
        ${sideTop.map(sideCardHtml).join("")}
      </aside>
    </div>
    <section class="mag-row" aria-label="${escAttr(isRu ? "Ещё материалы" : "More stories")}">
      ${rowMidHtml}
    </section>
    ${aboutHtml}
    ${catsHtml}
    ${popularHtml}
    ${expertHtml}
    ${newsletterHtml}
  </main>
  ${footerHtml(c)}
  ${widgets}
  ${pixel}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Magazine ARTICLE PAGE (replaces seoChrome.buildPostPage when style=magazine)
// ---------------------------------------------------------------------------

function extractTocFromHtml(html: string): { id: string; text: string; level: number }[] {
  const out: { id: string; text: string; level: number }[] = [];
  const re = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const level = Number(m[1]);
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    if (!text) continue;
    const id = text.toLowerCase()
      .replace(/[^a-zа-яё0-9\s-]/gi, "")
      .replace(/\s+/g, "-")
      .slice(0, 80) || `h-${out.length}`;
    out.push({ id, text, level });
  }
  return out;
}

function injectHeadingIds(html: string, toc: { id: string; text: string; level: number }[]): string {
  let i = 0;
  return html.replace(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi, (m, lvl, attrs, inner) => {
    const item = toc[i++];
    if (!item) return m;
    if (/id\s*=/.test(attrs)) return m;
    return `<h${lvl}${attrs} id="${escAttr(item.id)}">${inner}</h${lvl}>`;
  });
}

export interface MagazineArticleOpts {
  chrome: SiteChrome;
  post: PostInput;
  related: PostInput[];
  popular: PostInput[];
}

export function renderMagazineArticle(opts: MagazineArticleOpts): string {
  const { chrome: c, post, related, popular } = opts;
  const isRu = c.lang === "ru";
  const seed = siteSeed(c);
  const cats = buildCategories(c);
  const cat = postCategory(post.slug, cats);
  const author = pickAuthor(c.authors || [], post.slug);
  const minutes = readingTime(post.contentHtml);
  const views = fakeViews(post.slug, seed);
  const toc = extractTocFromHtml(post.contentHtml);
  const bodyHtml = injectHeadingIds(post.contentHtml, toc);
  const dateMain = fmtDate(post.publishedAt, isRu);
  const heroAlt = uniqueImageAlt(c, post.title, 0);
  const heroUrl = postImage(post, 1200, 720);

  const breadcrumbs = [
    { label: isRu ? "Главная" : "Home", href: "/" },
    { label: cat.label, href: "/blog/" },
    { label: post.title, href: `/posts/${post.slug}.html` },
  ];

  const head = buildHead(c, {
    title: `${post.title} — ${c.siteName}`,
    description: post.excerpt,
    path: `/posts/${post.slug}.html`,
    type: "article",
    ogImage: heroUrl,
    publishedTime: post.publishedAt,
    modifiedTime: post.modifiedAt || post.publishedAt,
    breadcrumbs,
  });

  const tagPool = (c.topic || "").split(/[,\s]+/).filter((w) => w.length >= 3).slice(0, 5);
  const tagsHtml = tagPool.length ? `
    <nav class="mag-tags" aria-label="${escAttr(isRu ? "Теги" : "Tags")}">
      ${tagPool.map((t) => `<a href="/blog/" rel="tag">#${escHtml(t)}</a>`).join("")}
    </nav>` : "";

  const authorBlock = author ? `
    <aside class="mag-author-block" itemscope itemtype="https://schema.org/Person">
      <img src="${escAttr(`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(author.avatar_seed || author.name)}`)}" alt="${escAttr(author.name)}" width="88" height="88" loading="lazy" decoding="async" itemprop="image">
      <div>
        <h4 itemprop="name">${escHtml(author.name)}</h4>
        ${author.role ? `<div class="mag-author-role" itemprop="jobTitle">${escHtml(author.role)}</div>` : ""}
        ${author.bio ? `<p itemprop="description">${escHtml(author.bio)}</p>` : ""}
      </div>
    </aside>` : "";

  const relatedHtml = related.length ? `
    <section class="mag-related" aria-labelledby="mag-related-h">
      <h3 id="mag-related-h">${escHtml(pickPhrase("relatedTitle", c.lang, seed))}</h3>
      <div class="mag-related-grid">
        ${related.slice(0, 3).map((r) => `
          <a href="/posts/${escAttr(r.slug)}.html">
            <img src="${escAttr(postImage(r, 400, 240))}" alt="${escAttr(uniqueImageAlt(c, r.title, 2))}" width="400" height="240" loading="lazy" decoding="async">
            <h4>${escHtml(r.title)}</h4>
          </a>`).join("")}
      </div>
    </section>` : "";

  const commentsHtml = `
    <section class="mag-comments" aria-labelledby="mag-comments-h">
      <h3 id="mag-comments-h">${escHtml(pickPhrase("magCommentsTitle", c.lang, seed))}</h3>
      <p>${escHtml(isRu ? "Будьте первым, кто оставит комментарий." : "Be the first to leave a comment.")}</p>
      <form onsubmit="event.preventDefault();this.querySelector('button').textContent='${escAttr(isRu ? "Отправлено!" : "Sent!")}';return false">
        <input type="text" required placeholder="${escAttr(isRu ? "Имя" : "Name")}" autocomplete="name">
        <input type="email" required placeholder="Email" autocomplete="email">
        <textarea required placeholder="${escAttr(isRu ? "Ваш комментарий" : "Your comment")}" rows="4"></textarea>
        <button type="submit">${escHtml(isRu ? "Отправить" : "Send")}</button>
      </form>
    </section>`;

  const tocHtml = toc.length >= 2 ? `
    <nav class="mag-toc" aria-labelledby="mag-toc-h">
      <h4 id="mag-toc-h">${escHtml(isRu ? "Содержание" : "Contents")}</h4>
      <ol>
        ${toc.map((it) => `<li><a href="#${escAttr(it.id)}">${escHtml(it.text)}</a></li>`).join("")}
      </ol>
    </nav>` : "";

  const breadcrumbsHtml = `
    <nav class="breadcrumbs mag-shell" aria-label="${escAttr(isRu ? "Хлебные крошки" : "Breadcrumbs")}" style="padding-top:14px;font-size:13px;color:#7a7e88">
      <ol style="list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:6px">
        ${breadcrumbs.map((b, i, a) => i === a.length - 1
          ? `<li aria-current="page">${escHtml(b.label)}</li>`
          : `<li><a href="${escAttr(b.href)}" style="color:inherit">${escHtml(b.label)}</a> <span aria-hidden="true">›</span></li>`).join("")}
      </ol>
    </nav>`;

  const asideHtml = `
    <aside class="mag-aside" aria-label="${escAttr(isRu ? "Боковая колонка" : "Sidebar")}">
      ${author ? `
      <div class="mag-aside-block">
        <h4>${escHtml(isRu ? "Об авторе" : "About the author")}</h4>
        <div class="mag-aside-author">
          <img src="${escAttr(`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(author.avatar_seed || author.name)}`)}" alt="${escAttr(author.name)}" width="48" height="48" loading="lazy" decoding="async">
          <div><strong>${escHtml(author.name)}</strong>${author.role ? `<span>${escHtml(author.role)}</span>` : ""}</div>
        </div>
      </div>` : ""}
      ${popular.length ? `
      <div class="mag-aside-block">
        <h4>${escHtml(pickPhrase("magPopularTitle", c.lang, seed))}</h4>
        <ul>
          ${popular.slice(0, 5).map((p) => `<li><a href="/posts/${escAttr(p.slug)}.html">${escHtml(p.title)}</a></li>`).join("")}
        </ul>
      </div>` : ""}
      <div class="mag-aside-block">
        <h4>${escHtml(pickPhrase("magCategoriesTitle", c.lang, seed))}</h4>
        <ul>
          ${cats.map((ct) => `<li><a href="/blog/">${escHtml(ct.label)}</a></li>`).join("")}
        </ul>
      </div>
      <div class="mag-aside-cta">
        <h4>${escHtml(c.siteName)}</h4>
        <p>${escHtml(c.siteAbout || c.topic)}</p>
        <a href="/contacts.html">${escHtml(isRu ? "Связаться" : "Get in touch")}</a>
      </div>
    </aside>`;

  const pixel = (c.projectId && c.trackerUrl)
    ? `<img src="${escAttr(c.trackerUrl)}?site=${escAttr(c.projectId)}&u=${encodeURIComponent(`/posts/${post.slug}.html`)}" width="1" height="1" alt="" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade">`
    : "";
  const lead = (c.teamMembers && c.teamMembers[0]) || null;
  const widgets = renderSiteWidgets({
    lang: c.lang as "ru" | "en",
    accent: c.accent,
    consultantName: lead?.name || (c.companyName || c.siteName),
    consultantPhoto: undefined,
    siteName: c.siteName,
    topic: c.topic,
    totopPosition: c.totopPosition || "left-bottom",
    seed,
  });

  return `${head}
<body class="page-magazine page-post">
  ${headerHtml(c)}
  ${breadcrumbsHtml}
  <div class="mag-article-wrap">
    <article class="mag-article" itemscope itemtype="https://schema.org/Article">
      <header class="mag-article-head">
        <span class="mag-rubric-tag">${escHtml(cat.label)}</span>
        <h1 itemprop="headline">${escHtml(post.title)}</h1>
        <div class="mag-meta">
          ${author ? `<address style="font-style:normal" itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">${escHtml(author.name)}</span></address>` : ""}
          ${dateMain.label ? `<time datetime="${escAttr(dateMain.dt)}" itemprop="datePublished">${escHtml(dateMain.label)}</time>` : ""}
          <span>${minutes} ${escHtml(pickPhrase("magReadingTime", c.lang, seed))}</span>
          <span>${fmtViews(views)} ${escHtml(pickPhrase("magViews", c.lang, seed))}</span>
        </div>
      </header>
      <figure class="mag-article-figure">
        <img src="${escAttr(heroUrl)}" alt="${escAttr(heroAlt)}" width="1200" height="720" loading="eager" decoding="async" fetchpriority="high" itemprop="image">
        <figcaption>${escHtml(post.excerpt || post.title)}</figcaption>
      </figure>
      ${tocHtml}
      <div class="mag-article-body" itemprop="articleBody">
        ${bodyHtml}
      </div>
      ${tagsHtml}
      ${authorBlock}
      ${relatedHtml}
      ${commentsHtml}
    </article>
    ${asideHtml}
  </div>
  ${footerHtml(c)}
  ${widgets}
  ${pixel}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Bundle: returns the magazine-styled CSS that should be appended to style.css
// when this template is in use. (Chrome CSS is concatenated separately.)
// ---------------------------------------------------------------------------
export function magazineExtraCss(c: SiteChrome): string {
  return magazineCss(c);
}
