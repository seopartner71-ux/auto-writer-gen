// Renders a site from a DB-stored pbn_templates row using simple mustache-like
// placeholders: {{var}} and {{#posts}}...{{/posts}} blocks.

import {
  type SiteChrome, type PostInput as ChromePost,
  buildAboutPage, buildContactsPage, buildPrivacyPage, buildTermsPage,
  buildPostPage, robotsTxt, sitemapXml, chromeStyles, pickRelated,
} from "./seoChrome.ts";

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
  // Optional SEO/legal/branding context (forwarded from edge function)
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

  // Build SEO chrome from opts (used for legal pages, sitemap, post pages).
  const chrome: SiteChrome = {
    domain, siteName, siteAbout, topic, lang, accent, headingFont, bodyFont,
    companyName: opts.companyName,
    companyAddress: opts.companyAddress,
    companyPhone: opts.companyPhone,
    companyEmail: opts.companyEmail,
    foundingYear: opts.foundingYear,
    teamMembers: opts.teamMembers,
    ogImageUrl: opts.ogImageUrl,
    aboutHtml: opts.aboutHtml,
    contactsHtml: opts.contactsHtml,
    privacyHtml: opts.privacyHtml,
    termsHtml: opts.termsHtml,
    footerLinkUrl: opts.footerLinkUrl,
    footerLinkText: opts.footerLinkText,
  };
  const chromePosts: ChromePost[] = posts.map((p) => ({
    title: p.title, slug: p.slug, excerpt: p.excerpt, contentHtml: p.contentHtml,
  }));

  const files: Record<string, string> = {
    "index.html": indexHtml,
    "about.html": buildAboutPage(chrome),
    "contacts.html": buildContactsPage(chrome),
    "privacy.html": buildPrivacyPage(chrome),
    "terms.html": buildTermsPage(chrome),
    "style.css": css + "\n" + chromeStyles(chrome),
    "robots.txt": robotsTxt(chrome),
    "_headers": `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`,
  };
  for (const p of chromePosts) {
    files[`posts/${p.slug}.html`] = buildPostPage(chrome, p, pickRelated(chromePosts, p, 4));
  }
  files["sitemap.xml"] = sitemapXml(chrome, chromePosts.map((p) => p.slug));
  return files;
}
