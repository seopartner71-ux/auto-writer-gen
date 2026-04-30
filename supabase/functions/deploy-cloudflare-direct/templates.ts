import { googleFontsHref, type TemplateType } from "./styles.ts";
import {
  type SiteChrome, type PostInput as ChromePost,
  buildAboutPage, buildContactsPage, buildPrivacyPage, buildTermsPage,
  buildPostPage, buildIndexHomePage, robotsTxt, sitemapXml,
  chromeStyles, pickRelated,
  buildBusinessPages, businessPagePaths, sitemapXmlExtended,
  faviconSvg, manifestJson, humansTxt, securityTxt, rssFeed,
  llmsTxt,
} from "./seoChrome.ts";

export interface PostInput {
  title: string;
  excerpt: string;
  slug: string;
  contentHtml: string; // already-rendered HTML body for the post page
  featuredImageUrl?: string;
}

export interface RenderCtx {
  siteName: string;
  siteAbout: string;
  topic: string;
  accent: string;
  headingFont: string;
  bodyFont: string;
  template: TemplateType;
  domain: string; // e.g. "foo.pages.dev"
  posts?: PostInput[]; // real articles from DB; if empty, fakePosts() is used
  // New optional SEO/legal/branding context (passed from edge function)
  lang?: string;
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  foundingYear?: number;
  teamMembers?: { name: string; role: string; bio?: string }[];
  ogImageUrl?: string;
  aboutHtml?: string;
  contactsHtml?: string;
  privacyHtml?: string;
  termsHtml?: string;
  footerLinkUrl?: string;
  footerLinkText?: string;
  injectionLinks?: { url: string; anchor: string }[];
  projectId?: string;
  trackerUrl?: string;
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
  authors?: { name: string; role?: string; bio?: string; avatar_seed?: string }[];
  businessPages?: Record<string, string>;
  iconUrl?: string;
  totopPosition?: "left-bottom" | "right-bottom" | "left-top" | "right-top" | "hidden";
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle<T>(arr: T[]): T[] { return [...arr].sort(() => Math.random() - 0.5); }

function navLabels(): { home: string; about: string } {
  return {
    home: pick(["Главная", "Старт", "Лента"]),
    about: pick(["О нас", "О сайте", "О проекте", "Контакты"]),
  };
}

function fakePosts(topic: string, n: number): { title: string; excerpt: string }[] {
  const verbs = ["Как выбрать", "Обзор", "Топ-10", "Гид по", "Зачем нужен", "Сравнение", "Простой способ", "Все секреты"];
  const tails = ["в 2026 году", "для новичков", "от практиков", "пошагово", "без переплат", "за час", "своими руками"];
  const result: { title: string; excerpt: string }[] = [];
  for (let i = 0; i < n; i++) {
    const title = `${pick(verbs)} ${topic} ${pick(tails)}`;
    const excerpt = `Практика показывает: разобраться с темой "${topic}" проще, чем кажется. В материале - конкретные шаги, без воды.`;
    result.push({ title, excerpt });
  }
  return result;
}

// Pick real posts if present, otherwise fall back to fake ones.
function getPosts(ctx: RenderCtx, n: number): { title: string; excerpt: string; href: string; image: string }[] {
  const placeholder = (slug: string) =>
    `https://picsum.photos/seed/${encodeURIComponent(slug || "post").slice(0, 60)}/600/360`;
  if (ctx.posts && ctx.posts.length > 0) {
    return ctx.posts.slice(0, n).map((p) => ({
      title: p.title,
      excerpt: p.excerpt,
      href: `/posts/${p.slug}.html`,
      image: p.featuredImageUrl && /^https?:\/\//.test(p.featuredImageUrl) ? p.featuredImageUrl : placeholder(p.slug),
    }));
  }
  return fakePosts(ctx.topic, n).map((p, i) => ({ ...p, href: "#", image: placeholder(`fake-${i}`) }));
}

function commonHead(ctx: RenderCtx, extraCss = ""): string {
  const fontsHref = googleFontsHref(ctx.headingFont, ctx.bodyFont);
  const meta = shuffle([
    `<meta name="description" content="${esc(ctx.siteAbout)}">`,
    `<meta name="theme-color" content="${ctx.accent}">`,
    `<meta name="robots" content="index,follow">`,
    `<meta property="og:title" content="${esc(ctx.siteName)}">`,
    `<meta property="og:description" content="${esc(ctx.siteAbout)}">`,
    `<meta property="og:type" content="website">`,
  ]).join("\n  ");
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(ctx.siteName)}</title>
  ${meta}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${fontsHref}" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  ${extraCss}
</head>`;
}

function robots(ctx: RenderCtx): string {
  return `User-agent: *\nAllow: /\nSitemap: https://${ctx.domain}/sitemap.xml\n`;
}

function sitemap(ctx: RenderCtx): string {
  const today = new Date().toISOString().slice(0, 10);
  const postUrls = (ctx.posts || []).map((p) =>
    `  <url><loc>https://${ctx.domain}/posts/${p.slug}.html</loc><lastmod>${today}</lastmod></url>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://${ctx.domain}/</loc><lastmod>${today}</lastmod></url>
  <url><loc>https://${ctx.domain}/about.html</loc><lastmod>${today}</lastmod></url>
${postUrls}
</urlset>`;
}

// Per-post page renderer (uses same head/css; centered article body).
function renderPostPage(ctx: RenderCtx, post: PostInput): string {
  const nav = navLabels();
  return `${commonHead({ ...ctx, siteName: post.title }, `<style>
.post-wrap{max-width:720px;margin:0 auto;padding:48px 24px;font-family:"${ctx.bodyFont}",system-ui,sans-serif;color:#1a1a1a;line-height:1.75;font-size:17px}
.post-wrap header{padding-bottom:24px;border-bottom:1px solid #e5e7eb;margin-bottom:32px}
.post-wrap header a.brand{font-family:"${ctx.headingFont}",sans-serif;color:#0a0a0a;text-decoration:none;font-size:20px;font-weight:700}
.post-wrap h1{font-family:"${ctx.headingFont}",sans-serif;font-size:36px;line-height:1.2;margin:24px 0 16px;color:#0a0a0a}
.post-wrap h2{font-family:"${ctx.headingFont}",sans-serif;font-size:26px;line-height:1.3;margin:32px 0 12px;color:#0a0a0a}
.post-wrap h3{font-family:"${ctx.headingFont}",sans-serif;font-size:21px;line-height:1.3;margin:24px 0 10px;color:#0a0a0a}
.post-wrap p{margin:0 0 16px}
.post-wrap a{color:${ctx.accent};text-decoration:underline}
.post-wrap ul,.post-wrap ol{margin:0 0 16px 24px}
.post-wrap li{margin-bottom:8px}
.post-wrap blockquote{border-left:3px solid ${ctx.accent};padding:8px 16px;margin:16px 0;color:#444;background:#fafafa}
.post-wrap code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:.92em}
.post-wrap pre{background:#0f172a;color:#e2e8f0;padding:16px;border-radius:8px;overflow-x:auto;margin:16px 0}
.post-wrap pre code{background:transparent;color:inherit;padding:0}
.post-wrap img{max-width:100%;height:auto;border-radius:8px;margin:16px 0}
.post-wrap footer{margin-top:48px;padding-top:24px;border-top:1px solid #e5e7eb;color:#666;font-size:14px;text-align:center}
body{background:#fff;margin:0}
</style>`)}
<body>
  <article class="post-wrap">
    <header>
      <a href="/" class="brand">${esc(ctx.siteName)}</a>
      <nav style="margin-top:8px;font-size:14px"><a href="/" style="color:#666;text-decoration:none">${nav.home}</a> · <a href="/about.html" style="color:#666;text-decoration:none">${nav.about}</a></nav>
    </header>
    <h1>${esc(post.title)}</h1>
    ${post.contentHtml}
    <footer>&copy; ${new Date().getFullYear()} <a href="/" style="color:#666;text-decoration:none">${esc(ctx.siteName)}</a></footer>
  </article>
</body>
</html>`;
}

// ====================== TEMPLATE 1: MINIMAL (serif blog) ======================
function renderMinimal(ctx: RenderCtx): Record<string, string> {
  const nav = navLabels();
  const postClass = pick(["entry", "post", "note"]);
  const posts = getPosts(ctx, 12);

  const css = `:root{--accent:${ctx.accent};--bg:#fafaf7;--ink:#1a1a1a;--muted:#666}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"${ctx.bodyFont}",Georgia,serif;background:var(--bg);color:var(--ink);line-height:1.7;font-size:18px}
.wrap{max-width:680px;margin:0 auto;padding:48px 24px}
header{padding-bottom:32px;border-bottom:1px solid #e5e2dc;margin-bottom:48px}
h1,h2,h3{font-family:"${ctx.headingFont}",Georgia,serif;font-weight:700;line-height:1.25}
.brand{font-size:28px;color:var(--ink);text-decoration:none}
nav{margin-top:12px;display:flex;gap:20px}
nav a{color:var(--muted);text-decoration:none;font-size:15px}
nav a:hover{color:var(--accent)}
.${postClass}{margin-bottom:48px;padding-bottom:32px;border-bottom:1px dashed #d8d4cc}
.${postClass}:last-child{border:none}
.${postClass} h2{font-size:26px;margin-bottom:12px}
.${postClass} h2 a{color:var(--ink);text-decoration:none}
.${postClass} h2 a:hover{color:var(--accent)}
.${postClass} p{color:#444}
footer{margin-top:48px;padding-top:24px;border-top:1px solid #e5e2dc;color:var(--muted);font-size:14px;text-align:center}
`;

  const articles = posts.map((p) => `
    <article class="${postClass}">
      <a href="${p.href}" style="display:block;margin-bottom:14px"><img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" width="680" height="380" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;background:#eee"></a>
      <h2><a href="${p.href}">${esc(p.title)}</a></h2>
      <p>${esc(p.excerpt)}</p>
    </article>`).join("");

  const index = `${commonHead(ctx)}
<body>
  <div class="wrap">
    <header>
      <a href="/" class="brand">${esc(ctx.siteName)}</a>
      <nav><a href="/">${nav.home}</a><a href="/about.html">${nav.about}</a></nav>
    </header>
    <main>${articles}</main>
    <footer>&copy; ${new Date().getFullYear()} ${esc(ctx.siteName)}</footer>
  </div>
</body>
</html>`;

  const about = `${commonHead(ctx)}
<body>
  <div class="wrap">
    <header>
      <a href="/" class="brand">${esc(ctx.siteName)}</a>
      <nav><a href="/">${nav.home}</a><a href="/about.html">${nav.about}</a></nav>
    </header>
    <main>
      <h1 style="margin-bottom:24px">${nav.about}</h1>
      <p>${esc(ctx.siteAbout)}</p>
    </main>
    <footer>&copy; ${new Date().getFullYear()} ${esc(ctx.siteName)}</footer>
  </div>
</body>
</html>`;

  return { "index.html": index, "about.html": about, "style.css": css };
}

// ====================== TEMPLATE 2: MAGAZINE (2-col cards) ======================
function renderMagazine(ctx: RenderCtx): Record<string, string> {
  const nav = navLabels();
  const cardClass = pick(["card", "tile", "story"]);
  const posts = getPosts(ctx, 12);

  const css = `:root{--accent:${ctx.accent};--bg:#ffffff;--ink:#0f172a;--muted:#64748b;--surface:#f8fafc}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"${ctx.bodyFont}",system-ui,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6}
.shell{max-width:1100px;margin:0 auto;padding:32px 24px}
header.top{display:flex;justify-content:space-between;align-items:center;padding-bottom:24px;border-bottom:2px solid var(--accent);margin-bottom:40px}
.brand{font-family:"${ctx.headingFont}",sans-serif;font-size:24px;font-weight:700;color:var(--ink);text-decoration:none}
nav.menu{display:flex;gap:24px}
nav.menu a{color:var(--muted);text-decoration:none;font-weight:500}
nav.menu a:hover{color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}
.${cardClass}{background:var(--surface);border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);transition:transform .2s,box-shadow .2s}
.${cardClass}:hover{transform:translateY(-4px);box-shadow:0 8px 24px rgba(0,0,0,.08)}
.${cardClass} .body{padding:24px}
.${cardClass} h2{font-family:"${ctx.headingFont}",sans-serif;font-size:20px;margin-bottom:12px;line-height:1.3}
.${cardClass} h2 a{color:var(--ink);text-decoration:none}
.${cardClass} h2 a:hover{color:var(--accent)}
.${cardClass} p{color:var(--muted);font-size:15px}
.tag{display:inline-block;background:var(--accent);color:#fff;padding:4px 10px;border-radius:4px;font-size:12px;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px}
footer.bot{margin-top:64px;padding:24px 0;text-align:center;color:var(--muted);font-size:14px;border-top:1px solid #e2e8f0}
`;

  const cards = posts.map((p) => `
      <article class="${cardClass}">
        <a href="${p.href}" aria-hidden="true"><img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" width="600" height="360" style="display:block;width:100%;aspect-ratio:5/3;object-fit:cover;background:#eef2f7"></a>
        <div class="body">
          <span class="tag">${esc(ctx.topic)}</span>
          <h2><a href="${p.href}">${esc(p.title)}</a></h2>
          <p>${esc(p.excerpt)}</p>
        </div>
      </article>`).join("");

  const index = `${commonHead(ctx)}
<body>
  <div class="shell">
    <header class="top">
      <a href="/" class="brand">${esc(ctx.siteName)}</a>
      <nav class="menu"><a href="/">${nav.home}</a><a href="/about.html">${nav.about}</a></nav>
    </header>
    <main><div class="grid">${cards}</div></main>
    <footer class="bot">&copy; ${new Date().getFullYear()} ${esc(ctx.siteName)}</footer>
  </div>
</body>
</html>`;

  const about = `${commonHead(ctx)}
<body>
  <div class="shell">
    <header class="top">
      <a href="/" class="brand">${esc(ctx.siteName)}</a>
      <nav class="menu"><a href="/">${nav.home}</a><a href="/about.html">${nav.about}</a></nav>
    </header>
    <main style="max-width:680px">
      <h1 style="font-family:'${ctx.headingFont}',sans-serif;font-size:36px;margin-bottom:24px">${nav.about}</h1>
      <p style="font-size:18px;color:#334155">${esc(ctx.siteAbout)}</p>
    </main>
    <footer class="bot">&copy; ${new Date().getFullYear()} ${esc(ctx.siteName)}</footer>
  </div>
</body>
</html>`;

  return { "index.html": index, "about.html": about, "style.css": css };
}

// ====================== TEMPLATE 3: NEWS (compact dense grid) ======================
function renderNews(ctx: RenderCtx): Record<string, string> {
  const nav = navLabels();
  const itemClass = pick(["item", "row", "feed-item"]);
  const posts = getPosts(ctx, 18);

  const css = `:root{--accent:${ctx.accent};--bg:#fff;--ink:#111;--muted:#555;--line:#e5e7eb}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"${ctx.bodyFont}",sans-serif;background:var(--bg);color:var(--ink);font-size:15px;line-height:1.5}
.container{max-width:1200px;margin:0 auto;padding:16px}
.bar{background:var(--accent);color:#fff;padding:14px 24px;display:flex;justify-content:space-between;align-items:center}
.brand{font-family:"${ctx.headingFont}",sans-serif;font-size:22px;font-weight:700;color:#fff;text-decoration:none}
.bar nav a{color:#fff;text-decoration:none;margin-left:18px;font-size:14px;opacity:.9}
.bar nav a:hover{opacity:1;text-decoration:underline}
ul.news-list{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1px;background:var(--line);padding:1px;margin-top:24px}
ul.news-list li.${itemClass}{background:#fff;padding:18px}
ul.news-list li.${itemClass} h3{font-family:"${ctx.headingFont}",sans-serif;font-size:16px;font-weight:700;margin-bottom:8px;line-height:1.35}
ul.news-list li.${itemClass} h3 a{color:var(--ink);text-decoration:none}
ul.news-list li.${itemClass} h3 a:hover{color:var(--accent)}
ul.news-list li.${itemClass} p{color:var(--muted);font-size:13px}
.meta{font-size:11px;color:var(--accent);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px}
footer{margin-top:48px;padding:24px;text-align:center;color:var(--muted);font-size:13px;border-top:1px solid var(--line)}
`;

  const items = posts.map((p) => `
      <li class="${itemClass}">
        <a href="${p.href}" style="display:block;margin-bottom:8px"><img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" width="280" height="160" style="width:100%;aspect-ratio:7/4;object-fit:cover;background:#eef2f7"></a>
        <div class="meta">${esc(ctx.topic)}</div>
        <h3><a href="${p.href}">${esc(p.title)}</a></h3>
        <p>${esc(p.excerpt.slice(0, 120))}</p>
      </li>`).join("");

  const index = `${commonHead(ctx)}
<body>
  <div class="bar">
    <a href="/" class="brand">${esc(ctx.siteName)}</a>
    <nav><a href="/">${nav.home}</a><a href="/about.html">${nav.about}</a></nav>
  </div>
  <div class="container">
    <main><ul class="news-list">${items}</ul></main>
    <footer>&copy; ${new Date().getFullYear()} ${esc(ctx.siteName)}</footer>
  </div>
</body>
</html>`;

  const about = `${commonHead(ctx)}
<body>
  <div class="bar">
    <a href="/" class="brand">${esc(ctx.siteName)}</a>
    <nav><a href="/">${nav.home}</a><a href="/about.html">${nav.about}</a></nav>
  </div>
  <div class="container" style="max-width:680px;padding:32px 24px">
    <h1 style="font-family:'${ctx.headingFont}',sans-serif;font-size:32px;margin-bottom:20px">${nav.about}</h1>
    <p>${esc(ctx.siteAbout)}</p>
  </div>
</body>
</html>`;

  return { "index.html": index, "about.html": about, "style.css": css };
}

// ====================== TEMPLATE 4: LANDING (hero + posts) ======================
function renderLanding(ctx: RenderCtx): Record<string, string> {
  const nav = navLabels();
  const blockClass = pick(["block", "feature", "panel"]);
  const posts = getPosts(ctx, 9);

  const css = `:root{--accent:${ctx.accent};--bg:#fff;--ink:#0a0a0a;--muted:#525252;--soft:#fafafa}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"${ctx.bodyFont}",system-ui,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6}
header.nav{position:sticky;top:0;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);padding:18px 32px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #eee;z-index:10}
.brand{font-family:"${ctx.headingFont}",sans-serif;font-size:22px;font-weight:700;color:var(--ink);text-decoration:none}
header.nav nav a{color:var(--muted);text-decoration:none;margin-left:24px;font-weight:500}
header.nav nav a:hover{color:var(--accent)}
section.hero{padding:96px 32px;text-align:center;background:linear-gradient(180deg,var(--soft) 0%,#fff 100%)}
section.hero h1{font-family:"${ctx.headingFont}",sans-serif;font-size:clamp(40px,6vw,68px);font-weight:700;line-height:1.1;margin-bottom:24px;letter-spacing:-.02em}
section.hero p{font-size:20px;color:var(--muted);max-width:640px;margin:0 auto 32px}
section.hero .cta{display:inline-block;background:var(--accent);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px}
section.hero .cta:hover{opacity:.9}
section.posts{max-width:1100px;margin:0 auto;padding:80px 32px}
section.posts h2{font-family:"${ctx.headingFont}",sans-serif;font-size:36px;margin-bottom:48px;text-align:center}
.posts-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:32px}
.${blockClass}{padding:24px;border:1px solid #eee;border-radius:12px;transition:border-color .2s}
.${blockClass}:hover{border-color:var(--accent)}
.${blockClass} h3{font-family:"${ctx.headingFont}",sans-serif;font-size:18px;margin-bottom:10px}
.${blockClass} h3 a{color:var(--ink);text-decoration:none}
.${blockClass} p{color:var(--muted);font-size:15px}
footer{padding:32px;text-align:center;color:var(--muted);font-size:14px;border-top:1px solid #eee}
`;

  const blocks = posts.map((p) => `
      <article class="${blockClass}">
        <a href="${p.href}" style="display:block;margin:-24px -24px 16px"><img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" width="400" height="240" style="display:block;width:100%;aspect-ratio:5/3;object-fit:cover;border-radius:12px 12px 0 0;background:#eef2f7"></a>
        <h3><a href="${p.href}">${esc(p.title)}</a></h3>
        <p>${esc(p.excerpt)}</p>
      </article>`).join("");

  const index = `${commonHead(ctx)}
<body>
  <header class="nav">
    <a href="/" class="brand">${esc(ctx.siteName)}</a>
    <nav><a href="/">${nav.home}</a><a href="/about.html">${nav.about}</a></nav>
  </header>
  <section class="hero">
    <h1>${esc(ctx.siteName)}</h1>
    <p>${esc(ctx.siteAbout)}</p>
    <a href="/about.html" class="cta">Узнать больше</a>
  </section>
  <section class="posts">
    <h2>Свежие материалы</h2>
    <div class="posts-grid">${blocks}</div>
  </section>
  <footer>&copy; ${new Date().getFullYear()} ${esc(ctx.siteName)}</footer>
</body>
</html>`;

  const about = `${commonHead(ctx)}
<body>
  <header class="nav">
    <a href="/" class="brand">${esc(ctx.siteName)}</a>
    <nav><a href="/">${nav.home}</a><a href="/about.html">${nav.about}</a></nav>
  </header>
  <section style="max-width:680px;margin:0 auto;padding:80px 32px">
    <h1 style="font-family:'${ctx.headingFont}',sans-serif;font-size:48px;margin-bottom:24px">${nav.about}</h1>
    <p style="font-size:18px;color:#525252">${esc(ctx.siteAbout)}</p>
  </section>
  <footer>&copy; ${new Date().getFullYear()} ${esc(ctx.siteName)}</footer>
</body>
</html>`;

  return { "index.html": index, "about.html": about, "style.css": css };
}

// ====================== DISPATCHER ======================
export function renderTemplate(ctx: RenderCtx): Record<string, string> {
  let files: Record<string, string>;
  switch (ctx.template) {
    case "magazine": files = renderMagazine(ctx); break;
    case "news":     files = renderNews(ctx); break;
    case "landing":  files = renderLanding(ctx); break;
    case "minimal":
    default:         files = renderMinimal(ctx); break;
  }

  // Build SEO chrome from ctx (used for legal pages, sitemap, post pages,
  // and to append shared chrome CSS to the template's own stylesheet).
  const chrome: SiteChrome = {
    domain: ctx.domain,
    siteName: ctx.siteName,
    siteAbout: ctx.siteAbout,
    topic: ctx.topic,
    lang: ctx.lang || "ru",
    accent: ctx.accent,
    headingFont: ctx.headingFont,
    bodyFont: ctx.bodyFont,
    projectId: ctx.projectId,
    trackerUrl: ctx.trackerUrl,
    companyName: ctx.companyName,
    companyAddress: ctx.companyAddress,
    companyPhone: ctx.companyPhone,
    companyEmail: ctx.companyEmail,
    foundingYear: ctx.foundingYear,
    teamMembers: ctx.teamMembers,
    ogImageUrl: ctx.ogImageUrl,
    aboutHtml: ctx.aboutHtml,
    contactsHtml: ctx.contactsHtml,
    privacyHtml: ctx.privacyHtml,
    termsHtml: ctx.termsHtml,
    footerLinkUrl: ctx.footerLinkUrl,
    footerLinkText: ctx.footerLinkText,
    injectionLinks: ctx.injectionLinks,
    legalAddress: ctx.legalAddress,
    workHours: ctx.workHours,
    juridicalInn: ctx.juridicalInn,
    whatsappUrl: ctx.whatsappUrl,
    telegramUrl: ctx.telegramUrl,
    vkUrl: ctx.vkUrl,
    youtubeUrl: ctx.youtubeUrl,
    instagramUrl: ctx.instagramUrl,
    clientsCountText: ctx.clientsCountText,
    authors: ctx.authors,
    businessPages: ctx.businessPages as any,
    iconUrl: ctx.iconUrl,
    totopPosition: ctx.totopPosition,
  };

  const chromePosts: ChromePost[] = (ctx.posts || []).map((p) => ({
    title: p.title, slug: p.slug, excerpt: p.excerpt, contentHtml: p.contentHtml,
    publishedAt: (p as any).publishedAt,
    featuredImageUrl: p.featuredImageUrl,
  }));

  // Replace per-post pages with the SEO-rich version (canonical, OG,
  // Article schema, breadcrumbs, related posts, cookie banner, footer).
  for (const p of chromePosts) {
    const related = pickRelated(chromePosts, p, 4);
    files[`posts/${p.slug}.html`] = buildPostPage(chrome, p, related);
  }

  // Add legal + about + contacts pages (SEO chrome wrappers).
  files["about.html"]    = buildAboutPage(chrome);
  files["contacts.html"] = buildContactsPage(chrome);
  files["privacy.html"]  = buildPrivacyPage(chrome);
  files["terms.html"]    = buildTermsPage(chrome);

  // Business pages (Vacancies / Portfolio / Reviews / FAQ / Pricing /
  // Guarantees / Delivery / Promo). Only those generated by AI are emitted.
  const bp = buildBusinessPages(chrome);
  for (const [path, html] of Object.entries(bp)) files[path] = html;

  // Append shared chrome CSS so the new pages have header/footer/breadcrumbs/cookie styles.
  const sharedCss = chromeStyles(chrome);
  files["style.css"] = (files["style.css"] || "") + "\n" + sharedCss;

  // robots + sitemap (includes business pages).
  files["robots.txt"]   = robotsTxt(chrome);
  files["sitemap.xml"]  = sitemapXmlExtended(
    chrome,
    chromePosts.map((p) => ({ slug: p.slug, publishedAt: p.publishedAt })),
    businessPagePaths(chrome),
  );
  files["llms.txt"]     = llmsTxt(
    chrome,
    chromePosts.map((p) => ({ slug: p.slug, publishedAt: p.publishedAt })),
    businessPagePaths(chrome).map((p) => ({
      path: p,
      title: p.replace(/^\/|\.html$/g, "").replace(/-/g, " "),
    })),
  );
  files["favicon.svg"]  = faviconSvg(chrome);
  files["manifest.json"]= manifestJson(chrome);
  files["humans.txt"]   = humansTxt(chrome);
  files["security.txt"] = securityTxt(chrome);
  files[".well-known/security.txt"] = securityTxt(chrome);
  files["feed.xml"]     = rssFeed(chrome, chromePosts);

  return files;
}