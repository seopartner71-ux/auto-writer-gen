// ============================================================================
// WordPress emulation for PBN sites.
//
// Goal: make crawlers (Google, Ahrefs, fingerprint scanners) believe each
// generated static site is powered by WordPress. All values are deterministic
// from a per-project seed so re-deploys are byte-identical, but different
// projects look like distinct WP installations.
//
// Public entry: applyWordPressEmulation(files, { seed, domain, siteName,
//   siteAbout, posts }) -> mutated files map.
//
// Transforms:
//   - Inject WP <meta name="generator">, RSD/wlwmanifest/api.w.org links,
//     WP-style body/article CSS classes into every HTML page.
//   - Add wp-content/themes/<theme>/style.css, wp-json index, xmlrpc.php,
//     wp-login.php redirect, wp-includes/wlwmanifest.xml.
//   - Generate /feed/ (RSS with posts) and /comments/feed/ (empty RSS).
//   - Replace robots.txt with WP-flavoured version (sitemap, GPTBot block,
//     wp-admin allow/disallow rules).
// ============================================================================

function fnv1a(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic PRNG factory keyed by string. */
function rngFromSeed(seed: string): () => number {
  let s = fnv1a(seed) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s >>> 0;
  };
}
function pickFrom<T>(arr: T[], rnd: () => number): T {
  return arr[rnd() % arr.length];
}
function intInRange(min: number, max: number, rnd: () => number): number {
  return min + (rnd() % (max - min + 1));
}

// ----------------------------- WP profile ------------------------------------

const WP_VERSIONS = ["6.3.1", "6.3.2", "6.4.0", "6.4.1", "6.4.2", "6.4.3", "6.5.0"];
const WP_THEMES = [
  { slug: "twentytwentyfour", name: "Twenty Twenty-Four", author: "the WordPress team" },
  { slug: "twentytwentythree", name: "Twenty Twenty-Three", author: "the WordPress team" },
  { slug: "astra", name: "Astra", author: "Brainstorm Force" },
  { slug: "kadence", name: "Kadence", author: "Kadence WP" },
  { slug: "generatepress", name: "GeneratePress", author: "Tom Usborne" },
  { slug: "blocksy", name: "Blocksy", author: "CreativeThemes" },
  { slug: "neve", name: "Neve", author: "ThemeIsle" },
  { slug: "oceanwp", name: "OceanWP", author: "OceanWP" },
];

export interface WpEmulationProfile {
  version: string;
  themeSlug: string;
  themeName: string;
  themeAuthor: string;
  themeVersion: string;
}

function buildProfile(seed: string): WpEmulationProfile {
  const rnd = rngFromSeed(seed + ":wp-profile");
  const theme = pickFrom(WP_THEMES, rnd);
  return {
    version: pickFrom(WP_VERSIONS, rnd),
    themeSlug: theme.slug,
    themeName: theme.name,
    themeAuthor: theme.author,
    themeVersion: `${intInRange(1, 4, rnd)}.${intInRange(0, 9, rnd)}.${intInRange(0, 9, rnd)}`,
  };
}

// ----------------------------- Helpers ---------------------------------------

function escAttr(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function escXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function stripHtml(s: string): string {
  return String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ----------------------------- HTML injectors --------------------------------

/** Inject WP-style <meta>/<link> tags right after <head>. */
function injectHeadTags(html: string, profile: WpEmulationProfile, domain: string): string {
  const base = `https://${domain}`;
  const tags = [
    `<meta name="generator" content="WordPress ${profile.version}">`,
    `<link rel="https://api.w.org/" href="${base}/wp-json/">`,
    `<link rel="EditURI" type="application/rsd+xml" title="RSD" href="${base}/xmlrpc.php?rsd">`,
    `<link rel="wlwmanifest" type="application/wlwmanifest+xml" href="${base}/wp-includes/wlwmanifest.xml">`,
    `<link rel="alternate" type="application/rss+xml" title="${escAttr(profile.themeName)} Feed" href="${base}/feed/">`,
    `<link rel="alternate" type="application/rss+xml" title="Comments Feed" href="${base}/comments/feed/">`,
  ].join("\n  ");
  return html.replace(/<head\b([^>]*)>/i, (m) => `${m}\n  ${tags}`);
}

/** Add WP-style classes to <body class="..."> (preserves existing classes). */
function injectBodyClasses(html: string, isHome: boolean, postId: number | null): string {
  const wpClasses = isHome
    ? ["home", "blog", "wp-embed-responsive", "no-sidebar"]
    : postId
      ? [`postid-${postId}`, "single", "single-post", "wp-embed-responsive"]
      : ["page", "page-template-default", `page-id-${postId ?? 2}`, "wp-embed-responsive"];

  const re = /<body\b([^>]*)>/i;
  if (!re.test(html)) {
    return html.replace(/<\/head>/i, (m) => `${m}\n<body class="${wpClasses.join(" ")}">`);
  }
  return html.replace(re, (_m, attrs) => {
    const classRe = /\sclass\s*=\s*("([^"]*)"|'([^']*)')/i;
    const cm = classRe.exec(attrs);
    if (cm) {
      const cur = (cm[2] ?? cm[3] ?? "").split(/\s+/).filter(Boolean);
      const merged = Array.from(new Set([...cur, ...wpClasses])).join(" ");
      const newAttrs = attrs.replace(classRe, ` class="${merged}"`);
      return `<body${newAttrs}>`;
    }
    return `<body${attrs} class="${wpClasses.join(" ")}">`;
  });
}

/** Wrap first <article> on post pages with WP article classes. Idempotent. */
function injectArticleClasses(html: string, postId: number): string {
  const re = /<article\b([^>]*)>/i;
  if (!re.test(html)) return html;
  const wpArticleClasses = [
    `post-${postId}`, "post", "type-post", "status-publish",
    "format-standard", "hentry",
  ];
  return html.replace(re, (_m, attrs) => {
    const classRe = /\sclass\s*=\s*("([^"]*)"|'([^']*)')/i;
    const cm = classRe.exec(attrs);
    if (cm) {
      const cur = (cm[2] ?? cm[3] ?? "").split(/\s+/).filter(Boolean);
      const merged = Array.from(new Set([...cur, ...wpArticleClasses])).join(" ");
      const newAttrs = attrs.replace(classRe, ` class="${merged}"`);
      return `<article${newAttrs}>`;
    }
    return `<article${attrs} class="${wpArticleClasses.join(" ")}">`;
  });
}

// ----------------------------- Static WP files -------------------------------

export function buildWpThemeStyleCss(profile: WpEmulationProfile, siteName: string): string {
  return `/*
Theme Name: ${profile.themeName}
Theme URI: https://wordpress.org/themes/${profile.themeSlug}/
Author: ${profile.themeAuthor}
Author URI: https://wordpress.org/
Description: ${profile.themeName} is a clean, fast, accessible WordPress theme used by ${siteName}.
Version: ${profile.themeVersion}
Requires at least: 6.0
Tested up to: ${profile.version}
Requires PHP: 7.4
License: GNU General Public License v2 or later
License URI: http://www.gnu.org/licenses/gpl-2.0.html
Text Domain: ${profile.themeSlug}
Tags: blog, two-columns, custom-colors, custom-menu, featured-images
*/

/* Theme entry stylesheet — block styles are loaded per-block. */
`;
}

export function buildWpJsonIndex(siteName: string, siteAbout: string, domain: string): string {
  const obj = {
    name: siteName,
    description: siteAbout,
    url: `https://${domain}`,
    home: `https://${domain}`,
    gmt_offset: "0",
    timezone_string: "",
    namespaces: ["oembed/1.0", "wp/v2", "wp-site-health/v1", "wp-block-editor/v1"],
    authentication: { "application-passwords": { endpoints: { authorization: `https://${domain}/wp-admin/authorize-application.php` } } },
    routes: {
      "/": { namespace: "", methods: ["GET"], _links: { self: [{ href: `https://${domain}/wp-json/` }] } },
    },
    _links: {
      help: [{ href: "https://developer.wordpress.org/rest-api/" }],
    },
  };
  return JSON.stringify(obj, null, 2);
}

export function buildWlwManifestXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://schemas.microsoft.com/wlw/manifest/weblog">
  <options>
    <supportsKeywords>Yes</supportsKeywords>
    <supportsGetTags>Yes</supportsGetTags>
  </options>
  <weblog>
    <serviceName>WordPress</serviceName>
  </weblog>
</manifest>
`;
}

/** Empty placeholder, mirrors what every WP install ships. */
export function buildXmlrpcStub(): string {
  return `<?xml version="1.0"?>
<methodResponse>
  <fault>
    <value>
      <struct>
        <member><name>faultCode</name><value><int>405</int></value></member>
        <member><name>faultString</name><value><string>XML-RPC services are disabled on this site.</string></value></member>
      </struct>
    </value>
  </fault>
</methodResponse>
`;
}

/** Static HTML that meta-redirects /wp-login.php and /wp-admin to home. */
export function buildWpLoginRedirect(domain: string): string {
  const target = `https://${domain}/`;
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0; url=${target}">
<link rel="canonical" href="${target}">
<title>Redirecting…</title>
</head>
<body>Redirecting to <a href="${target}">${target}</a>.</body>
</html>`;
}

// ----------------------------- RSS feeds -------------------------------------

export interface WpFeedPost {
  title: string;
  slug: string;
  excerpt: string;
  contentHtml: string;
  publishedAt?: string;
}

function rfc822(d: Date): string {
  // e.g. "Wed, 14 Nov 2024 10:00:00 +0000"
  return d.toUTCString();
}

export function buildMainFeed(
  domain: string,
  siteName: string,
  siteAbout: string,
  lang: string,
  posts: WpFeedPost[],
  profile: WpEmulationProfile,
): string {
  const base = `https://${domain}`;
  const items = posts.slice(0, 25).map((p) => {
    const date = p.publishedAt ? new Date(p.publishedAt) : new Date();
    return `    <item>
      <title>${escXml(p.title)}</title>
      <link>${base}/posts/${escXml(p.slug)}.html</link>
      <pubDate>${rfc822(date)}</pubDate>
      <dc:creator><![CDATA[${escXml(siteName)}]]></dc:creator>
      <guid isPermaLink="false">${base}/?p=${Math.abs(fnv1a(p.slug)) % 99999}</guid>
      <description><![CDATA[${stripHtml(p.excerpt).slice(0, 500)}]]></description>
      <content:encoded><![CDATA[${p.contentHtml}]]></content:encoded>
    </item>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wfw="http://wellformedweb.org/CommentAPI/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:sy="http://purl.org/rss/1.0/modules/syndication/"
  xmlns:slash="http://purl.org/rss/1.0/modules/slash/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>${escXml(siteName)}</title>
    <atom:link href="${base}/feed/" rel="self" type="application/rss+xml" />
    <link>${base}/</link>
    <description>${escXml(siteAbout)}</description>
    <lastBuildDate>${rfc822(new Date())}</lastBuildDate>
    <language>${escXml(lang)}</language>
    <sy:updatePeriod>hourly</sy:updatePeriod>
    <sy:updateFrequency>1</sy:updateFrequency>
    <generator>https://wordpress.org/?v=${profile.version}</generator>
${items}
  </channel>
</rss>
`;
}

export function buildCommentsFeed(domain: string, siteName: string, lang: string): string {
  const base = `https://${domain}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Comments for ${escXml(siteName)}</title>
    <atom:link href="${base}/comments/feed/" rel="self" type="application/rss+xml" />
    <link>${base}/</link>
    <description>Latest comments</description>
    <lastBuildDate>${rfc822(new Date())}</lastBuildDate>
    <language>${escXml(lang)}</language>
  </channel>
</rss>
`;
}

// ----------------------------- robots.txt ------------------------------------

export function buildWpRobotsTxt(domain: string): string {
  return [
    "User-agent: *",
    "Disallow: /wp-admin/",
    "Allow: /wp-admin/admin-ajax.php",
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
    `Sitemap: https://${domain}/sitemap.xml`,
    "",
  ].join("\n");
}

// ----------------------------- Public entry ----------------------------------

export interface WpEmulationOpts {
  seed: string;
  domain: string;
  siteName: string;
  siteAbout: string;
  lang?: string;
  posts?: WpFeedPost[];
}

/**
 * Apply WP emulation to a fully-built file map. Mutates `files` in-place
 * and also returns it. Designed to run AFTER applyAntiFingerprint so the WP
 * tags don't get mangled by class obfuscation.
 */
export function applyWordPressEmulation(
  files: Record<string, string>,
  opts: WpEmulationOpts,
): Record<string, string> {
  const profile = buildProfile(opts.seed);
  const lang = opts.lang || "ru";
  const posts = opts.posts || [];

  // Per-post deterministic numeric IDs (4-digit-ish, like real WP).
  const postIdRng = rngFromSeed(opts.seed + ":wp-postids");
  const postIds = new Map<string, number>();
  for (const p of posts) postIds.set(p.slug, intInRange(1500, 9800, postIdRng));

  for (const [path, content] of Object.entries(files)) {
    if (!path.endsWith(".html")) continue;
    let html = content;
    const isHome = path === "index.html";
    const isPost = path.startsWith("posts/") && path.endsWith(".html");
    const slug = isPost ? path.slice("posts/".length, -".html".length) : "";
    const postId = isPost ? (postIds.get(slug) ?? intInRange(1500, 9800, postIdRng)) : null;

    html = injectHeadTags(html, profile, opts.domain);
    html = injectBodyClasses(html, isHome, postId);
    if (isPost && postId) html = injectArticleClasses(html, postId);
    files[path] = html;
  }

  // Static WP-flavoured assets.
  files[`wp-content/themes/${profile.themeSlug}/style.css`] = buildWpThemeStyleCss(profile, opts.siteName);
  files["wp-json/index.html"] = buildWpJsonIndex(opts.siteName, opts.siteAbout, opts.domain);
  files["wp-includes/wlwmanifest.xml"] = buildWlwManifestXml();
  files["xmlrpc.php"] = buildXmlrpcStub();
  files["wp-login.php"] = buildWpLoginRedirect(opts.domain);
  files["wp-admin/index.html"] = buildWpLoginRedirect(opts.domain);

  // RSS feeds (WP serves them at /feed/ and /comments/feed/).
  const feedXml = buildMainFeed(opts.domain, opts.siteName, opts.siteAbout, lang, posts, profile);
  files["feed/index.xml"] = feedXml;
  files["feed.xml"] = feedXml; // keep legacy path that other code already references
  files["comments/feed/index.xml"] = buildCommentsFeed(opts.domain, opts.siteName, lang);

  // Replace robots.txt with the WP-style version (sitemap + GPTBot block).
  files["robots.txt"] = buildWpRobotsTxt(opts.domain);

  return files;
}