// Renders a site from a DB-stored pbn_templates row using simple mustache-like
// placeholders: {{var}} and {{#posts}}...{{/posts}} blocks.

export interface DbTemplate {
  template_key: string;
  name: string;
  html_structure: string;
  css_styles: string;
  font_pairs: [string, string][];
}

export interface PostItem {
  title: string;
  slug: string;
  contentHtml: string;
  excerpt: string;
}

export interface RenderOpts {
  tpl: DbTemplate;
  siteName: string;
  siteAbout: string;
  topic: string;
  accent: string;
  headingFont: string;
  bodyFont: string;
  domain: string;
  lang?: string;
  posts: PostItem[];
}

function escAttr(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function fontUrl(name: string): string {
  return name.replace(/\s+/g, "+");
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Render a single block of HTML with given vars (no #posts loops)
function renderVars(html: string, vars: Record<string, string>): string {
  return html.replace(/\{\{([\w_]+)\}\}/g, (_m, k) => (vars[k] ?? ""));
}

// Expand {{#posts}}...{{/posts}} loop, then substitute scalar vars.
function expand(html: string, vars: Record<string, string>, posts: PostItem[]): string {
  const looped = html.replace(/\{\{#posts\}\}([\s\S]*?)\{\{\/posts\}\}/g, (_m, body) => {
    return posts.map((p) => renderVars(body, {
      title: escAttr(p.title),
      url: `/posts/${p.slug}.html`,
      excerpt: escAttr(p.excerpt),
      date: todayIso(),
    })).join("");
  });
  return renderVars(looped, vars);
}

export function renderDbTemplate(opts: RenderOpts): Record<string, string> {
  const { tpl, siteName, siteAbout, topic, accent, headingFont, bodyFont, domain, posts } = opts;
  const lang = opts.lang || "ru";
  const year = String(new Date().getFullYear());

  const baseVars: Record<string, string> = {
    site_name: escAttr(siteName),
    site_about: escAttr(siteAbout),
    topic: escAttr(topic),
    accent,
    heading_font: headingFont,
    body_font: bodyFont,
    heading_font_url: fontUrl(headingFont),
    body_font_url: fontUrl(bodyFont),
    lang,
    year,
    title: escAttr(siteName),
    description: escAttr(siteAbout),
  };

  // Index page
  const indexHtml = expand(tpl.html_structure, baseVars, posts);

  // About page (reuse template, but no posts and a bio paragraph as the only "post")
  const aboutPosts: PostItem[] = [{
    title: "О проекте",
    slug: "about",
    contentHtml: `<p>${escAttr(siteAbout)}</p>`,
    excerpt: escAttr(siteAbout),
  }];
  const aboutHtml = expand(tpl.html_structure, {
    ...baseVars,
    title: `О сайте · ${siteName}`,
    description: `Об авторе сайта ${siteName}`,
  }, aboutPosts);

  // Contacts page (placeholder)
  const contactsPosts: PostItem[] = [{
    title: "Контакты",
    slug: "contacts",
    contentHtml: `<p>Связь с автором: через форму на сайте.</p>`,
    excerpt: "Связь с автором сайта",
  }];
  const contactsHtml = expand(tpl.html_structure, {
    ...baseVars,
    title: `Контакты · ${siteName}`,
    description: `Контакты сайта ${siteName}`,
  }, contactsPosts);

  // CSS — substitute accent + font names
  const css = renderVars(tpl.css_styles, baseVars);

  const files: Record<string, string> = {
    "index.html": indexHtml,
    "about.html": aboutHtml,
    "contacts.html": contactsHtml,
    "style.css": css,
    "robots.txt": `User-agent: *\nAllow: /\nSitemap: https://${domain}/sitemap.xml\n`,
    "_headers": `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`,
  };

  // Per-post pages: render full template but with a single-post mode showing the article body.
  for (const p of posts) {
    const singlePosts: PostItem[] = [p];
    // Reuse template - posts loop will render this single post block.
    // For the actual article body, append after the rendered template inside <main>?
    // Simpler: use template's own posts loop to render header card, then inject article body
    // by replacing first occurrence of {{excerpt}} doesn't work after rendering.
    // Instead, generate a dedicated minimal article page that links back to home.
    const postBody = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>${escAttr(p.title)} · ${escAttr(siteName)}</title>
<meta name="description" content="${escAttr(p.excerpt)}">
<link rel="stylesheet" href="/style.css">
<link href="https://fonts.googleapis.com/css2?family=${fontUrl(headingFont)}:wght@400;700&family=${fontUrl(bodyFont)}:wght@400;600&display=swap" rel="stylesheet">
</head><body>
<header class="post-page-head" style="padding:24px;border-bottom:1px solid rgba(0,0,0,.08)">
  <a href="/" style="color:${accent};text-decoration:none;font-family:'${headingFont}';font-weight:700">← ${escAttr(siteName)}</a>
</header>
<main style="max-width:760px;margin:0 auto;padding:48px 24px;font-family:'${bodyFont}',sans-serif;line-height:1.7">
  <h1 style="font-family:'${headingFont}';color:${accent};font-size:38px;margin-bottom:8px">${escAttr(p.title)}</h1>
  <p style="color:#666;margin-bottom:32px">${todayIso()}</p>
  <article>${p.contentHtml}</article>
  <p style="margin-top:48px"><a href="/" style="color:${accent}">← Все статьи</a></p>
</main>
<footer style="text-align:center;padding:32px;color:#999;font-size:13px">© ${year} ${escAttr(siteName)}</footer>
</body></html>`;
    files[`posts/${p.slug}.html`] = postBody;
  }

  // Sitemap
  const urls = [
    `https://${domain}/`,
    `https://${domain}/about.html`,
    `https://${domain}/contacts.html`,
    ...posts.map((p) => `https://${domain}/posts/${p.slug}.html`),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u}</loc><lastmod>${todayIso()}</lastmod></url>`).join("\n")}
</urlset>`;
  files["sitemap.xml"] = sitemap;

  return files;
}
