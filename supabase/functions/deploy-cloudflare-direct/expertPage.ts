// ============================================================================
// "Expert" template (Site Factory template №8).
//
// Concept: Authority/E-E-A-T premium publisher. Editorial serif typography on
// warm off-white, big author bylines with credentials, "fact-checked"
// indicators, table of contents, citations sidebar. Designed for YMYL niches
// (finance, health, law, b2b consulting) where trust signals dominate.
//
// All cross-cutting features are reused (FAL hero/team photos, brand icon,
// backdating, smart-interlinking, cost logging, antiFingerprint, WP
// emulation, sitemap/robots, JSON-LD, etc.).
// CSS prefix: .ex-*  (gets obfuscated per project by antiFingerprint).
// ============================================================================

import {
  type SiteChrome, type PostInput, type Author,
  buildHead, headerHtml, footerHtml,
  pickAuthor, pickAuthorByIndex, uniqueImageAlt, siteSeed,
} from "./seoChrome.ts";
import { widgetsHtml as renderSiteWidgets } from "./siteWidgets.ts";
import type { LandingContent } from "./landingPage.ts";

function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escAttr(s: string): string { return escHtml(s); }

function readingTime(html: string): number {
  const text = String(html || "").replace(/<[^>]+>/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function fmtDate(iso: string | undefined, isRu: boolean): { label: string; dt: string } {
  if (!iso) return { label: "", dt: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { label: "", dt: "" };
  const dt = d.toISOString().slice(0, 10);
  const fmt = new Intl.DateTimeFormat(isRu ? "ru-RU" : "en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  return { label: fmt.format(d), dt };
}

function postImage(p: PostInput, w = 1200, h = 720): string {
  if (p.featuredImageUrl && /^https?:\/\//.test(p.featuredImageUrl)) return p.featuredImageUrl;
  const seed = encodeURIComponent(p.slug || p.title || "post");
  return `https://picsum.photos/seed/${seed}/${w}/${h}`;
}

function authorInitials(name: string): string {
  return (name || "?").split(/\s+/).map((p) => p[0] || "").join("").slice(0, 2).toUpperCase();
}

// Extract H2 headings to build a Table of Contents.
function extractToc(html: string): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(html)) !== null) {
    const title = m[1].replace(/<[^>]+>/g, "").trim();
    if (!title) continue;
    const id = `s-${++i}`;
    out.push({ id, title });
  }
  return out.slice(0, 8);
}

// Inject id="s-N" attributes onto the first 8 H2s (matches extractToc output).
function injectTocAnchors(html: string): string {
  let i = 0;
  return html.replace(/<h2(\b[^>]*)>/gi, (full, attrs) => {
    if (i >= 8) return full;
    if (/\bid\s*=/.test(attrs)) { i++; return full; }
    i++;
    return `<h2${attrs} id="s-${i}">`;
  });
}

// ---------------------------------------------------------------------------
// CSS — prefixed .ex-*
// ---------------------------------------------------------------------------

export function expertExtraCss(c: SiteChrome): string {
  const accent = c.accent || "#7c2d12";
  return `
/* ===== Expert template (Site Factory #8) ===== */
:root{--ex-accent:${accent};--ex-bg:#fbf8f1;--ex-paper:#fff;--ex-ink:#1a1411;--ex-muted:#6b5d54;--ex-soft:#f3ecdf;--ex-border:#e6dcc6;--ex-rule:#d9cfb8;--ex-gold:#a07c2c}
.page-expert{background:var(--ex-bg);color:var(--ex-ink);font-family:"${c.bodyFont}",Georgia,"Times New Roman",serif;line-height:1.7;font-size:17px}
.page-expert h1,.page-expert h2,.page-expert h3,.page-expert h4{font-family:"${c.headingFont}","${c.bodyFont}",Georgia,serif;color:var(--ex-ink);font-weight:700;letter-spacing:-0.012em;line-height:1.2}
.page-expert .container,.ex-shell{max-width:1200px;margin:0 auto;padding:0 28px}
.page-expert a{color:var(--ex-accent);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
.page-expert a:hover{text-decoration-thickness:2px}

.ex-eyebrow{display:inline-block;font-family:"${c.headingFont}",serif;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ex-gold);font-weight:700;margin-bottom:14px;padding-bottom:6px;border-bottom:2px solid var(--ex-gold)}

.ex-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 26px;border-radius:4px;background:var(--ex-ink);color:#fff;font-weight:700;font-size:14px;letter-spacing:.04em;text-transform:uppercase;text-decoration:none;border:2px solid var(--ex-ink);transition:background .15s,color .15s}
.ex-btn:hover{background:var(--ex-accent);border-color:var(--ex-accent);color:#fff;text-decoration:none}
.ex-btn-ghost{background:transparent;color:var(--ex-ink);border-color:var(--ex-ink)}
.ex-btn-ghost:hover{background:var(--ex-ink);color:#fff}

/* Top trust strip */
.ex-topstrip{background:var(--ex-ink);color:#f3ecdf;padding:9px 0;font-size:12px;letter-spacing:.08em;text-align:center;text-transform:uppercase}
.ex-topstrip strong{color:#fff;letter-spacing:.04em}
.ex-topstrip .sep{margin:0 12px;color:#6b5d54}

/* Hero — magazine masthead style */
.ex-hero{padding:72px 0 56px;border-bottom:1px solid var(--ex-rule);background:linear-gradient(180deg,var(--ex-bg) 0%,var(--ex-soft) 100%)}
.ex-hero-grid{display:grid;grid-template-columns:1fr;gap:36px;text-align:center;max-width:880px;margin:0 auto}
.ex-hero h1{font-size:clamp(40px,5.6vw,68px);margin:0 0 22px;font-weight:800}
.ex-hero h1 em{font-style:italic;color:var(--ex-accent);font-weight:600}
.ex-hero .sub{font-size:clamp(18px,1.8vw,22px);color:var(--ex-muted);margin:0 auto 30px;max-width:680px;font-style:italic;line-height:1.55}
.ex-hero-cta{display:inline-flex;flex-wrap:wrap;gap:14px;justify-content:center}
.ex-hero-credentials{display:flex;flex-wrap:wrap;gap:32px;justify-content:center;margin-top:42px;padding-top:32px;border-top:1px solid var(--ex-rule);font-size:13px;color:var(--ex-muted);letter-spacing:.06em;text-transform:uppercase}
.ex-hero-credentials span{display:inline-flex;align-items:center;gap:8px;font-weight:600}
.ex-hero-credentials span::before{content:"";display:inline-block;width:6px;height:6px;background:var(--ex-gold);border-radius:50%}

/* Author byline strip */
.ex-byline{padding:34px 0;border-bottom:1px solid var(--ex-rule);background:var(--ex-paper)}
.ex-byline-grid{display:flex;align-items:center;gap:22px;max-width:880px;margin:0 auto}
.ex-byline .av{width:72px;height:72px;border-radius:50%;background:var(--ex-accent);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-family:"${c.headingFont}",serif;font-size:24px;font-weight:700;flex-shrink:0;overflow:hidden;border:2px solid var(--ex-rule)}
.ex-byline .av img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.ex-byline .who{flex:1;min-width:0}
.ex-byline .who .role{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ex-gold);font-weight:700;margin-bottom:4px}
.ex-byline .who .name{font-family:"${c.headingFont}",serif;font-size:22px;font-weight:700;color:var(--ex-ink);margin-bottom:2px}
.ex-byline .who .bio{font-size:14px;color:var(--ex-muted);font-style:italic}
.ex-byline .badge{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--ex-gold);color:var(--ex-gold);font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;border-radius:2px;flex-shrink:0}
.ex-byline .badge::before{content:"✓"}
@media(max-width:680px){.ex-byline-grid{flex-direction:column;text-align:center}.ex-byline .who{text-align:center}}

/* Pull quote / thesis statement */
.ex-thesis{padding:80px 0;text-align:center;border-bottom:1px solid var(--ex-rule)}
.ex-thesis .quote{max-width:820px;margin:0 auto;font-family:"${c.headingFont}",serif;font-size:clamp(24px,2.6vw,34px);font-style:italic;line-height:1.45;color:var(--ex-ink)}
.ex-thesis .quote::before,.ex-thesis .quote::after{content:'"';color:var(--ex-accent);font-size:1.3em;vertical-align:-.15em;margin:0 .1em}
.ex-thesis .attr{margin-top:24px;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:var(--ex-muted)}

/* Pillars (services as expert frameworks) */
.ex-pillars{padding:96px 0;border-bottom:1px solid var(--ex-rule)}
.ex-pillars-head{text-align:center;margin-bottom:64px;max-width:680px;margin-left:auto;margin-right:auto}
.ex-pillars-head h2{font-size:clamp(32px,3.6vw,48px);margin-bottom:16px}
.ex-pillars-head p{color:var(--ex-muted);font-size:18px;font-style:italic}
.ex-pillars-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:48px}
.ex-pillar{position:relative;padding:0 0 0 28px;border-left:2px solid var(--ex-gold);counter-increment:exp}
.ex-pillar .num{font-family:"${c.headingFont}",serif;font-size:14px;letter-spacing:.16em;text-transform:uppercase;color:var(--ex-gold);font-weight:700;margin-bottom:14px}
.ex-pillar h3{font-size:24px;margin:0 0 14px}
.ex-pillar p{color:var(--ex-muted);margin:0 0 18px;font-size:16px}
.ex-pillar ul{list-style:none;padding:0;margin:0}
.ex-pillar li{padding:8px 0 8px 22px;font-size:15px;color:#3f342c;position:relative;border-bottom:1px dashed var(--ex-rule)}
.ex-pillar li:last-child{border-bottom:none}
.ex-pillar li::before{content:"§";position:absolute;left:0;color:var(--ex-accent);font-weight:700;font-family:"${c.headingFont}",serif}
@media(max-width:880px){.ex-pillars-grid{grid-template-columns:1fr;gap:42px}}

/* Methodology / process — numbered list */
.ex-method{padding:96px 0;background:var(--ex-soft);border-bottom:1px solid var(--ex-rule)}
.ex-method-grid{display:grid;grid-template-columns:.9fr 1.1fr;gap:64px;align-items:flex-start}
.ex-method h2{font-size:clamp(30px,3.4vw,42px);margin-bottom:18px}
.ex-method .lead{color:var(--ex-muted);font-style:italic;font-size:17px;margin-bottom:24px}
.ex-method-list{list-style:none;padding:0;margin:0;counter-reset:m}
.ex-method-list li{position:relative;padding:24px 0 24px 78px;border-top:1px solid var(--ex-rule);counter-increment:m}
.ex-method-list li:last-child{border-bottom:1px solid var(--ex-rule)}
.ex-method-list li::before{content:counter(m,decimal-leading-zero);position:absolute;left:0;top:24px;font-family:"${c.headingFont}",serif;font-size:42px;font-weight:800;color:var(--ex-accent);line-height:1;letter-spacing:-.02em}
.ex-method-list h3{font-size:20px;margin:0 0 6px}
.ex-method-list p{margin:0;color:var(--ex-muted);font-size:15px}
@media(max-width:880px){.ex-method-grid{grid-template-columns:1fr;gap:32px}}

/* Stats bar — editorial serif numerals */
.ex-stats{padding:72px 0;border-bottom:1px solid var(--ex-rule)}
.ex-stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:32px;text-align:center}
.ex-stat{padding:0 12px;border-right:1px solid var(--ex-rule)}
.ex-stat:last-child{border-right:none}
.ex-stat .v{font-family:"${c.headingFont}",serif;font-size:clamp(40px,4.6vw,58px);font-weight:800;color:var(--ex-accent);line-height:1;letter-spacing:-.02em;font-variant-numeric:lining-nums tabular-nums}
.ex-stat .l{margin-top:10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--ex-muted);font-weight:600}
@media(max-width:880px){.ex-stats-grid{grid-template-columns:1fr 1fr;gap:32px 16px}.ex-stat{border-right:none;border-bottom:1px solid var(--ex-rule);padding-bottom:24px}.ex-stat:nth-last-child(-n+2){border-bottom:none}}

/* Testimonials — single big quote, paginator dots */
.ex-quotes{padding:96px 0;background:var(--ex-paper);border-bottom:1px solid var(--ex-rule)}
.ex-quotes-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px}
.ex-quote{padding:36px;border:1px solid var(--ex-rule);background:var(--ex-bg);position:relative}
.ex-quote::before{content:"\\201C";position:absolute;top:-12px;left:24px;background:var(--ex-bg);padding:0 8px;font-family:"${c.headingFont}",serif;font-size:60px;color:var(--ex-accent);line-height:1}
.ex-quote blockquote{margin:0 0 24px;padding:0;border:none;font-family:"${c.headingFont}",serif;font-size:19px;font-style:italic;line-height:1.55;color:var(--ex-ink)}
.ex-quote .who{display:flex;align-items:center;gap:12px;padding-top:20px;border-top:1px solid var(--ex-rule);font-size:14px}
.ex-quote .who strong{color:var(--ex-ink);font-style:normal;font-weight:700}
.ex-quote .who span{color:var(--ex-muted);font-style:italic}
@media(max-width:880px){.ex-quotes-grid{grid-template-columns:1fr;gap:24px}}

/* Latest publications */
.ex-pubs{padding:96px 0;border-bottom:1px solid var(--ex-rule)}
.ex-pubs-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:48px;padding-bottom:18px;border-bottom:2px solid var(--ex-ink)}
.ex-pubs-head h2{font-size:clamp(30px,3.4vw,42px)}
.ex-pubs-head p{color:var(--ex-muted);font-style:italic;margin:6px 0 0}
.ex-pubs-grid{display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:32px}
.ex-pub-feature,.ex-pub{display:flex;flex-direction:column;color:var(--ex-ink);text-decoration:none}
.ex-pub-feature:hover,.ex-pub:hover{text-decoration:none;color:var(--ex-ink)}
.ex-pub-feature .img,.ex-pub .img{aspect-ratio:16/10;background:var(--ex-soft);overflow:hidden;border:1px solid var(--ex-rule);margin-bottom:18px}
.ex-pub-feature .img img,.ex-pub .img img{width:100%;height:100%;object-fit:cover;transition:transform .4s ease}
.ex-pub-feature:hover .img img,.ex-pub:hover .img img{transform:scale(1.04)}
.ex-pub-feature .cat,.ex-pub .cat{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ex-gold);font-weight:700;margin-bottom:8px}
.ex-pub-feature h3{font-size:30px;margin:0 0 12px;line-height:1.18}
.ex-pub h3{font-size:18px;margin:0 0 8px;line-height:1.32}
.ex-pub-feature p{color:var(--ex-muted);font-style:italic;font-size:16px;margin:0 0 14px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.ex-pub p{color:var(--ex-muted);font-size:14px;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ex-pub-meta{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ex-muted);font-weight:600;font-variant-numeric:tabular-nums}
@media(max-width:980px){.ex-pubs-grid{grid-template-columns:1fr 1fr;gap:28px}.ex-pub-feature{grid-column:1/-1}}
@media(max-width:600px){.ex-pubs-grid{grid-template-columns:1fr;gap:32px}.ex-pub-feature{grid-column:auto}}

/* Final CTA — newsletter style */
.ex-cta{padding:96px 28px;background:var(--ex-ink);color:#f3ecdf;text-align:center}
.ex-cta .ex-eyebrow{color:var(--ex-gold);border-bottom-color:var(--ex-gold)}
.ex-cta h2{color:#fff;font-size:clamp(32px,3.6vw,46px);margin-bottom:16px;max-width:680px;margin-left:auto;margin-right:auto}
.ex-cta p{color:#d6c9b3;font-style:italic;font-size:18px;max-width:560px;margin:0 auto 32px}
.ex-cta .ex-btn{background:var(--ex-gold);border-color:var(--ex-gold);color:var(--ex-ink)}
.ex-cta .ex-btn:hover{background:#fff;border-color:#fff;color:var(--ex-ink)}

/* ====================== ARTICLE PAGE ====================== */
.ex-article{padding:48px 0 0}
.ex-article-grid{display:grid;grid-template-columns:240px minmax(0,1fr) 240px;gap:48px;max-width:1200px;margin:0 auto;padding:0 28px;align-items:flex-start}
@media(max-width:1100px){.ex-article-grid{grid-template-columns:200px minmax(0,1fr);gap:36px}.ex-article-grid > .ex-aside-right{display:none}}
@media(max-width:880px){.ex-article-grid{grid-template-columns:1fr;gap:24px;padding:0 20px}.ex-article-grid > .ex-aside-left{display:none}}

.ex-article-head{grid-column:1/-1;text-align:center;padding:0 0 36px;border-bottom:1px solid var(--ex-rule);margin-bottom:36px}
.ex-article-head .crumbs{font-size:12px;color:var(--ex-muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:24px}
.ex-article-head .crumbs a{color:var(--ex-muted);text-decoration:none}
.ex-article-head .crumbs a:hover{color:var(--ex-ink)}
.ex-article-head .cat{display:inline-block;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--ex-gold);font-weight:700;margin-bottom:18px;padding:5px 14px;border:1px solid var(--ex-gold);border-radius:2px}
.ex-article-head h1{font-size:clamp(34px,4.6vw,56px);margin:0 0 22px;max-width:840px;margin-left:auto;margin-right:auto}
.ex-article-head .lead{font-size:21px;color:var(--ex-muted);max-width:720px;margin:0 auto 28px;line-height:1.55;font-style:italic}
.ex-article-meta{display:inline-flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:18px;font-size:13px;color:var(--ex-muted);letter-spacing:.04em}
.ex-article-meta .author{display:inline-flex;align-items:center;gap:10px;color:var(--ex-ink);font-weight:600;font-style:normal}
.ex-article-meta .author .av{width:32px;height:32px;border-radius:50%;background:var(--ex-accent);color:#fff;font-size:12px;display:inline-flex;align-items:center;justify-content:center;font-family:"${c.headingFont}",serif;font-weight:700}
.ex-article-meta .factcheck{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border:1px solid #16a34a;color:#15803d;background:#f0fdf4;border-radius:2px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:700}
.ex-article-meta .factcheck::before{content:"✓"}

.ex-article-hero{grid-column:1/-1;margin-bottom:48px}
.ex-article-hero img{width:100%;border:1px solid var(--ex-rule);aspect-ratio:16/8;object-fit:cover}
.ex-article-hero .caption{margin-top:10px;font-size:13px;color:var(--ex-muted);font-style:italic;text-align:center}

/* TOC sidebar */
.ex-aside-left{position:sticky;top:24px}
.ex-toc{padding:20px 18px;background:var(--ex-soft);border:1px solid var(--ex-rule)}
.ex-toc .h{font-family:"${c.headingFont}",serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ex-gold);font-weight:700;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--ex-rule)}
.ex-toc ol{list-style:none;padding:0;margin:0;counter-reset:toc}
.ex-toc li{counter-increment:toc;font-size:13px;line-height:1.4;margin-bottom:10px;position:relative;padding-left:26px}
.ex-toc li::before{content:counter(toc,decimal-leading-zero);position:absolute;left:0;top:0;font-family:"${c.headingFont}",serif;font-size:11px;color:var(--ex-gold);font-weight:700}
.ex-toc a{color:var(--ex-ink);text-decoration:none}
.ex-toc a:hover{color:var(--ex-accent);text-decoration:underline}

/* Author card sidebar */
.ex-aside-right{position:sticky;top:24px}
.ex-authorcard{padding:24px;border:1px solid var(--ex-rule);background:var(--ex-paper);text-align:center}
.ex-authorcard .av{width:84px;height:84px;border-radius:50%;background:var(--ex-accent);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-family:"${c.headingFont}",serif;font-size:28px;font-weight:700;margin-bottom:14px;overflow:hidden;border:2px solid var(--ex-rule)}
.ex-authorcard .av img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.ex-authorcard .role{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ex-gold);font-weight:700;margin-bottom:6px}
.ex-authorcard h3{font-size:18px;margin:0 0 10px}
.ex-authorcard p{font-size:13px;color:var(--ex-muted);margin:0 0 16px;font-style:italic;line-height:1.55}
.ex-authorcard .credentials{font-size:12px;color:var(--ex-ink);font-weight:600;padding-top:14px;border-top:1px solid var(--ex-rule);letter-spacing:.04em}

.ex-article-body{font-family:"${c.bodyFont}",Georgia,serif;font-size:18px;line-height:1.78;color:#2a221d}
.ex-article-body > p:first-of-type::first-letter{font-family:"${c.headingFont}",serif;font-size:64px;float:left;line-height:.9;padding:6px 14px 0 0;color:var(--ex-accent);font-weight:800}
.ex-article-body h2{font-size:30px;margin:48px 0 16px;color:var(--ex-ink);scroll-margin-top:24px;padding-top:8px;border-top:1px solid var(--ex-rule)}
.ex-article-body h2:first-of-type{border-top:none;padding-top:0;margin-top:36px}
.ex-article-body h3{font-size:22px;margin:32px 0 10px;color:var(--ex-ink)}
.ex-article-body p{margin:0 0 20px}
.ex-article-body ul,.ex-article-body ol{margin:0 0 22px;padding-left:26px}
.ex-article-body li{margin-bottom:10px}
.ex-article-body a{color:var(--ex-accent);text-decoration:underline;text-underline-offset:3px}
.ex-article-body blockquote{margin:32px 0;padding:8px 0 8px 28px;border:none;border-left:3px solid var(--ex-accent);font-family:"${c.headingFont}",serif;font-style:italic;font-size:22px;line-height:1.5;color:var(--ex-ink)}
.ex-article-body img{margin:28px 0;border:1px solid var(--ex-rule);width:100%}
.ex-article-body table{width:100%;border-collapse:collapse;margin:28px 0;font-size:15px;border:1px solid var(--ex-rule)}
.ex-article-body table th,.ex-article-body table td{padding:12px 16px;border-bottom:1px solid var(--ex-rule);text-align:left;font-family:"${c.bodyFont}",serif}
.ex-article-body table th{font-weight:700;background:var(--ex-soft);font-family:"${c.headingFont}",serif;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--ex-ink)}

.ex-callout{margin:32px 0;padding:24px 28px;background:#fffbeb;border:1px solid #fde68a;border-left:4px solid var(--ex-gold)}
.ex-callout .h{font-family:"${c.headingFont}",serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ex-gold);font-weight:700;margin-bottom:8px}
.ex-callout p{margin:0;font-style:italic;color:#78350f}

.ex-article-footer{margin:64px 0 0;padding:32px 0;border-top:1px solid var(--ex-rule);border-bottom:1px solid var(--ex-rule);text-align:center}
.ex-article-footer .label{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ex-gold);font-weight:700;margin-bottom:10px}
.ex-article-footer .date{font-size:13px;color:var(--ex-muted);font-style:italic}

.ex-article-related{grid-column:1/-1;margin:64px 0 96px;padding-top:48px;border-top:2px solid var(--ex-ink)}
.ex-article-related h2{font-size:26px;margin-bottom:28px}
.ex-article-rel-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:32px}
.ex-rel{display:block;padding:0;color:var(--ex-ink);text-decoration:none}
.ex-rel:hover{text-decoration:none;color:var(--ex-accent)}
.ex-rel .cat{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ex-gold);font-weight:700;margin-bottom:8px}
.ex-rel time{font-size:12px;color:var(--ex-muted);letter-spacing:.04em}
.ex-rel h3{font-size:18px;margin:8px 0 0;line-height:1.32}
@media(max-width:880px){.ex-article-rel-grid{grid-template-columns:1fr;gap:24px}}
`;
}

// ---------------------------------------------------------------------------
// HOME PAGE
// ---------------------------------------------------------------------------

export interface ExpertHomeOpts {
  chrome: SiteChrome;
  posts: PostInput[];
  content: LandingContent;
  generatedImages?: Record<string, string>;
  expertAuthor?: Author | null;
}

export function renderExpertHome(opts: ExpertHomeOpts): string {
  const { chrome: c, posts, content: ct } = opts;
  const isRu = c.lang === "ru";
  const seed = siteSeed(c);
  const imgs = opts.generatedImages || {};

  const expert = opts.expertAuthor || (c.authors && c.authors[0]) || null;
  const expertName = expert?.name || c.companyName || c.siteName;
  const expertRole = expert?.role || (isRu ? "Главный редактор" : "Editor-in-Chief");
  const expertBio = expert?.bio || ct.aboutText || c.siteAbout || "";
  const expertPhoto = imgs["team_1"] || (expert as any)?.photo_url || "";

  const stats4 = (ct.stats || []).slice(0, 4);
  const pillars3 = (ct.services || []).slice(0, 3);
  const proc4 = (ct.process || []).slice(0, 4);
  const tests2 = (ct.testimonials || []).slice(0, 2);

  const credentials = [
    isRu ? `${5 + (siteSeed(c).charCodeAt(0) % 12)} лет в индустрии` : `${5 + (siteSeed(c).charCodeAt(0) % 12)} years in industry`,
    isRu ? "Сертифицированные авторы" : "Certified contributors",
    isRu ? "Проверка фактов" : "Fact-checked",
    isRu ? "Независимые публикации" : "Independent research",
  ];
  const credentialsHtml = credentials.map((c) => `<span>${escHtml(c)}</span>`).join("");

  const pillarsHtml = pillars3.map((s, i) => `
    <article class="ex-pillar">
      <div class="num">${escHtml(isRu ? `Направление ${String(i + 1).padStart(2, "0")}` : `Pillar ${String(i + 1).padStart(2, "0")}`)}</div>
      <h3>${escHtml(s.title)}</h3>
      <p>${escHtml(s.bullets?.[0] || s.price || "")}</p>
      <ul>${(s.bullets || []).slice(0, 4).map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>
    </article>`).join("");

  const methodHtml = proc4.map((s) => `
    <li>
      <h3>${escHtml(s.title)}</h3>
      <p>${escHtml(s.text)}</p>
    </li>`).join("");

  const statsHtml = stats4.length ? stats4.map((s) => `
    <div class="ex-stat">
      <div class="v">${escHtml(s.value)}</div>
      <div class="l">${escHtml(s.label)}</div>
    </div>`).join("") : "";

  const quotesHtml = tests2.map((t) => `
    <div class="ex-quote">
      <blockquote>${escHtml(t.text)}</blockquote>
      <div class="who"><strong>${escHtml(t.name)}</strong>${t.role ? ` · <span>${escHtml(t.role)}</span>` : ""}</div>
    </div>`).join("");

  // Publications: 1 feature + 4 small
  const featurePost = posts[0];
  const restPosts = posts.slice(1, 5);
  const featureHtml = featurePost ? (() => {
    const d = fmtDate(featurePost.publishedAt, isRu);
    const img = postImage(featurePost, 1200, 760);
    return `
    <a class="ex-pub-feature" href="/posts/${escAttr(featurePost.slug)}.html">
      <div class="img"><img src="${escAttr(img)}" alt="${escAttr(uniqueImageAlt(c, featurePost.title, 0))}" width="1200" height="760" loading="lazy" decoding="async"></div>
      <div class="cat">${escHtml(isRu ? "Главный материал" : "Featured")}</div>
      <h3>${escHtml(featurePost.title)}</h3>
      <p>${escHtml(featurePost.excerpt || "")}</p>
      <div class="ex-pub-meta">${d.label || ""} · ${readingTime(featurePost.contentHtml)} ${escHtml(isRu ? "мин" : "min")}</div>
    </a>`;
  })() : "";
  const restHtml = restPosts.map((p, i) => {
    const d = fmtDate(p.publishedAt, isRu);
    const img = postImage(p, 800, 500);
    return `
    <a class="ex-pub" href="/posts/${escAttr(p.slug)}.html">
      <div class="img"><img src="${escAttr(img)}" alt="${escAttr(uniqueImageAlt(c, p.title, i + 1))}" width="800" height="500" loading="lazy" decoding="async"></div>
      <div class="cat">${escHtml(c.topic)}</div>
      <h3>${escHtml(p.title)}</h3>
      <p>${escHtml(p.excerpt || "")}</p>
      <div class="ex-pub-meta" style="margin-top:8px">${d.label || ""}</div>
    </a>`;
  }).join("") || `<div style="color:var(--ex-muted);font-style:italic">${escHtml(isRu ? "Скоро здесь появятся материалы." : "More soon.")}</div>`;

  const pubsHtml = (featureHtml || restHtml)
    ? `<div class="ex-pubs-grid">${featureHtml}${restHtml}</div>`
    : `<p style="color:var(--ex-muted);font-style:italic">${escHtml(isRu ? "Материалов пока нет." : "No publications yet.")}</p>`;

  // JSON-LD: Organization + Person + Blog
  const orgLd: any = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": c.siteName,
    "url": `https://${c.domain}/`,
    "logo": c.iconUrl || undefined,
    "description": c.siteAbout,
    "founder": expert ? { "@type": "Person", "name": expertName, "jobTitle": expertRole } : undefined,
  };
  const personLd = expert ? {
    "@context": "https://schema.org",
    "@type": "Person",
    "name": expertName,
    "jobTitle": expertRole,
    "description": expertBio.slice(0, 280),
    "image": expertPhoto || undefined,
    "worksFor": { "@type": "Organization", "name": c.siteName },
  } : null;
  const blogLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "name": c.siteName,
    "url": `https://${c.domain}/blog/`,
    "blogPost": posts.slice(0, 8).map((p) => ({
      "@type": "BlogPosting",
      "headline": p.title,
      "url": `https://${c.domain}/posts/${p.slug}.html`,
      "datePublished": p.publishedAt || undefined,
      "author": { "@type": "Person", "name": expertName },
    })),
  };

  const jsonLd: any[] = [orgLd, blogLd];
  if (personLd) jsonLd.push(personLd);

  const head = buildHead(c, {
    title: `${c.siteName} — ${ct.heroBadge || (isRu ? "Экспертные публикации" : "Expert insights")}`,
    description: (ct.heroSubtitle || c.siteAbout || "").slice(0, 160),
    path: "/",
    type: "website",
    breadcrumbs: [{ label: isRu ? "Главная" : "Home", href: "/" }],
    jsonLd,
    ogImage: imgs["hero"] || c.ogImageUrl,
  });

  const pixel = (c.projectId && c.trackerUrl)
    ? `<img src="${escAttr(c.trackerUrl)}?site=${escAttr(c.projectId)}&u=${encodeURIComponent("/")}" width="1" height="1" alt="" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade">`
    : "";

  const widgets = renderSiteWidgets({
    lang: c.lang as "ru" | "en",
    accent: c.accent,
    consultantName: expertName,
    consultantPhoto: expertPhoto || undefined,
    siteName: c.siteName,
    topic: c.topic,
    totopPosition: c.totopPosition || "right-bottom",
    seed,
  });

  const initials = authorInitials(expertName);
  const heroTitleHtml = escHtml(ct.heroTitle).replace(/\b(\w+)\.?$/u, '<em>$1</em>');

  return `${head}
<body class="page-expert page-home">
  <div class="ex-topstrip">
    <strong>${escHtml(c.siteName)}</strong>
    <span class="sep">·</span>
    ${escHtml(isRu ? "Независимая редакция" : "Independent editorial")}
    <span class="sep">·</span>
    ${escHtml(isRu ? "С проверкой фактов" : "Fact-checked research")}
  </div>
  ${headerHtml(c)}
  <main id="main-content">

    <section class="ex-hero">
      <div class="ex-shell">
        <div class="ex-hero-grid">
          <div>
            <span class="ex-eyebrow">${escHtml(ct.heroBadge || c.topic)}</span>
            <h1>${heroTitleHtml}</h1>
            <p class="sub">${escHtml(ct.heroSubtitle)}</p>
            <div class="ex-hero-cta">
              <a class="ex-btn" href="#publications">${escHtml(ct.ctaPrimary || (isRu ? "Читать публикации" : "Read publications"))}</a>
              <a class="ex-btn ex-btn-ghost" href="#methodology">${escHtml(ct.ctaSecondary || (isRu ? "Методология" : "Methodology"))}</a>
            </div>
            <div class="ex-hero-credentials">${credentialsHtml}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="ex-byline">
      <div class="ex-shell">
        <div class="ex-byline-grid">
          <span class="av" aria-hidden="true">${expertPhoto ? `<img src="${escAttr(expertPhoto)}" alt="${escAttr(expertName)}" width="72" height="72" loading="lazy" decoding="async">` : escHtml(initials)}</span>
          <div class="who">
            <div class="role">${escHtml(isRu ? "Под редакцией" : "Edited by")}</div>
            <div class="name">${escHtml(expertName)} — <span style="color:var(--ex-muted);font-weight:400;font-style:italic">${escHtml(expertRole)}</span></div>
            <div class="bio">${escHtml(expertBio.slice(0, 180))}</div>
          </div>
          <span class="badge">${escHtml(isRu ? "Эксперт верифицирован" : "Verified expert")}</span>
        </div>
      </div>
    </section>

    <section class="ex-thesis">
      <div class="ex-shell">
        <p class="quote">${escHtml(ct.aboutText || ct.heroSubtitle || c.siteAbout || "")}</p>
        <div class="attr">${escHtml(c.siteName)}</div>
      </div>
    </section>

    ${pillarsHtml ? `
    <section class="ex-pillars" id="pillars">
      <div class="ex-shell">
        <div class="ex-pillars-head">
          <span class="ex-eyebrow">${escHtml(isRu ? "Направления" : "Practice areas")}</span>
          <h2>${escHtml(isRu ? "Где наша экспертиза глубже всего" : "Where our expertise runs deepest")}</h2>
          <p>${escHtml(isRu ? "Мы пишем только о темах, в которых работаем годами." : "We only publish on topics we have practiced for years.")}</p>
        </div>
        <div class="ex-pillars-grid">${pillarsHtml}</div>
      </div>
    </section>` : ""}

    ${methodHtml ? `
    <section class="ex-method" id="methodology">
      <div class="ex-shell">
        <div class="ex-method-grid">
          <div>
            <span class="ex-eyebrow">${escHtml(isRu ? "Методология" : "Methodology")}</span>
            <h2>${escHtml(isRu ? "Как мы готовим материалы" : "How we produce our content")}</h2>
            <p class="lead">${escHtml(isRu ? "Каждый материал проходит четыре этапа проверки — от первичных источников до экспертной редактуры." : "Every piece passes four stages of review — from primary sources to expert editing.")}</p>
          </div>
          <ol class="ex-method-list">${methodHtml}</ol>
        </div>
      </div>
    </section>` : ""}

    ${statsHtml ? `
    <section class="ex-stats">
      <div class="ex-shell">
        <div class="ex-stats-grid">${statsHtml}</div>
      </div>
    </section>` : ""}

    ${quotesHtml ? `
    <section class="ex-quotes">
      <div class="ex-shell">
        <div class="ex-pillars-head" style="margin-bottom:48px">
          <span class="ex-eyebrow">${escHtml(isRu ? "Отклики" : "What readers say")}</span>
          <h2>${escHtml(isRu ? "О нас говорят" : "In their words")}</h2>
        </div>
        <div class="ex-quotes-grid">${quotesHtml}</div>
      </div>
    </section>` : ""}

    <section class="ex-pubs" id="publications">
      <div class="ex-shell">
        <div class="ex-pubs-head">
          <div>
            <span class="ex-eyebrow">${escHtml(isRu ? "Публикации" : "Publications")}</span>
            <h2>${escHtml(ct.blogTitle || (isRu ? "Свежие материалы" : "Latest essays"))}</h2>
            <p>${escHtml(isRu ? "Анализ, исследования и практические руководства." : "Analysis, research and practical playbooks.")}</p>
          </div>
          <a class="ex-btn ex-btn-ghost" href="/blog/">${escHtml(isRu ? "Архив" : "Archive")}</a>
        </div>
        ${pubsHtml}
      </div>
    </section>

    <section class="ex-cta" id="cta">
      <span class="ex-eyebrow">${escHtml(isRu ? "Связь с редакцией" : "Contact editorial")}</span>
      <h2>${escHtml(ct.ctaSectionTitle)}</h2>
      <p>${escHtml(ct.ctaSectionText)}</p>
      <a class="ex-btn" href="mailto:${escAttr(ct.email || c.companyEmail || "")}">${escHtml(ct.ctaPrimary || (isRu ? "Написать редакции" : "Write to editors"))}</a>
    </section>

  </main>

  ${footerHtml(c)}
  ${widgets}
  ${pixel}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// ARTICLE PAGE
// ---------------------------------------------------------------------------

export interface ExpertArticleOpts {
  chrome: SiteChrome;
  post: PostInput;
  related: PostInput[];
  postIndex?: number;
}

export function renderExpertArticle(opts: ExpertArticleOpts): string {
  const { chrome: c, post, related } = opts;
  const isRu = c.lang === "ru";
  const seed = siteSeed(c);
  const idx = typeof opts.postIndex === "number" ? opts.postIndex : 0;
  const author = pickAuthorByIndex(c.authors || [], idx)
    || pickAuthor(c.authors || [], post.slug);
  const minutes = readingTime(post.contentHtml);
  const dateMain = fmtDate(post.publishedAt, isRu);
  const dateUpd = fmtDate(post.modifiedAt || post.publishedAt, isRu);
  const heroAlt = uniqueImageAlt(c, post.title, 0);
  const heroUrl = postImage(post, 1600, 800);

  const breadcrumbs = [
    { label: isRu ? "Главная" : "Home", href: "/" },
    { label: isRu ? "Публикации" : "Publications", href: "/blog/" },
    { label: post.title, href: `/posts/${post.slug}.html` },
  ];

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": post.title,
    "description": post.excerpt,
    "image": heroUrl,
    "datePublished": post.publishedAt || undefined,
    "dateModified": post.modifiedAt || post.publishedAt || undefined,
    "author": author ? { "@type": "Person", "name": author.name, "jobTitle": author.role || undefined } : undefined,
    "publisher": {
      "@type": "Organization",
      "name": c.siteName,
      "logo": c.iconUrl ? { "@type": "ImageObject", "url": c.iconUrl } : undefined,
    },
    "mainEntityOfPage": `https://${c.domain}/posts/${post.slug}.html`,
  };

  const head = buildHead(c, {
    title: `${post.title} — ${c.siteName}`,
    description: (post.excerpt || "").slice(0, 160),
    path: `/posts/${post.slug}.html`,
    type: "article",
    publishedTime: post.publishedAt,
    modifiedTime: post.modifiedAt,
    ogImage: post.featuredImageUrl || c.ogImageUrl,
    breadcrumbs,
    jsonLd: [articleLd as any],
  });

  const pixel = (c.projectId && c.trackerUrl)
    ? `<img src="${escAttr(c.trackerUrl)}?site=${escAttr(c.projectId)}&u=${encodeURIComponent("/posts/" + post.slug + ".html")}" width="1" height="1" alt="" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade">`
    : "";

  const widgets = renderSiteWidgets({
    lang: c.lang as "ru" | "en",
    accent: c.accent,
    consultantName: author?.name || (c.companyName || c.siteName),
    consultantPhoto: undefined,
    siteName: c.siteName,
    topic: c.topic,
    totopPosition: c.totopPosition || "right-bottom",
    seed,
  });

  const relatedHtml = related.slice(0, 3).map((p) => {
    const d = fmtDate(p.publishedAt, isRu);
    return `
      <a class="ex-rel" href="/posts/${escAttr(p.slug)}.html">
        <div class="cat">${escHtml(c.topic)}</div>
        ${d.label ? `<time datetime="${escAttr(d.dt)}">${escHtml(d.label)}</time>` : ""}
        <h3>${escHtml(p.title)}</h3>
      </a>`;
  }).join("");

  const crumbsHtml = breadcrumbs.map((b, i) =>
    i === breadcrumbs.length - 1
      ? `<span>${escHtml(b.label)}</span>`
      : `<a href="${escAttr(b.href)}">${escHtml(b.label)}</a> · `,
  ).join("");

  const bodyHtml = injectTocAnchors(post.contentHtml || "");
  const toc = extractToc(post.contentHtml || "");
  const tocHtml = toc.length
    ? `<aside class="ex-aside-left">
         <nav class="ex-toc" aria-label="${escAttr(isRu ? "Содержание" : "Contents")}">
           <div class="h">${escHtml(isRu ? "Содержание" : "Contents")}</div>
           <ol>
             ${toc.map((t) => `<li><a href="#${escAttr(t.id)}">${escHtml(t.title)}</a></li>`).join("")}
           </ol>
         </nav>
       </aside>`
    : `<aside class="ex-aside-left"></aside>`;

  const authorInit = author ? authorInitials(author.name) : "";
  const authorPhoto = (author as any)?.photo_url || "";
  const authorCardHtml = author
    ? `<aside class="ex-aside-right">
         <div class="ex-authorcard">
           <div class="av">${authorPhoto ? `<img src="${escAttr(authorPhoto)}" alt="${escAttr(author.name)}" width="84" height="84" loading="lazy" decoding="async">` : escHtml(authorInit)}</div>
           <div class="role">${escHtml(isRu ? "Автор материала" : "About the author")}</div>
           <h3>${escHtml(author.name)}</h3>
           ${author.role ? `<p>${escHtml(author.role)}${author.bio ? " — " + escHtml(author.bio.slice(0, 140)) : ""}</p>` : (author.bio ? `<p>${escHtml(author.bio.slice(0, 180))}</p>` : "")}
           <div class="credentials">${escHtml(isRu ? "Проверено редакцией" : "Editorial verified")}</div>
         </div>
       </aside>`
    : `<aside class="ex-aside-right"></aside>`;

  return `${head}
<body class="page-expert page-article">
  <div class="ex-topstrip">
    <strong>${escHtml(c.siteName)}</strong>
    <span class="sep">·</span>
    ${escHtml(c.topic)}
    <span class="sep">·</span>
    ${escHtml(isRu ? "Проверено редакцией" : "Editorial verified")}
  </div>
  ${headerHtml(c)}
  <main id="main-content">
    <article class="ex-article h-entry">
      <div class="ex-article-grid">

        <header class="ex-article-head">
          <nav class="crumbs" aria-label="breadcrumbs">${crumbsHtml}</nav>
          <span class="cat">${escHtml(c.topic)}</span>
          <h1 class="p-name">${escHtml(post.title)}</h1>
          ${post.excerpt ? `<p class="lead p-summary">${escHtml(post.excerpt)}</p>` : ""}
          <div class="ex-article-meta">
            ${author ? `<span class="author p-author h-card"><span class="av" aria-hidden="true">${escHtml(authorInit)}</span>${escHtml(author.name)}</span>` : ""}
            ${dateMain.label ? `<time class="dt-published" datetime="${escAttr(dateMain.dt)}">${escHtml(dateMain.label)}</time>` : ""}
            <span>${minutes} ${escHtml(isRu ? "мин чтения" : "min read")}</span>
            <span class="factcheck">${escHtml(isRu ? "Факты проверены" : "Fact-checked")}</span>
          </div>
        </header>

        <figure class="ex-article-hero">
          <img src="${escAttr(heroUrl)}" alt="${escAttr(heroAlt)}" width="1600" height="800" loading="eager" decoding="async" fetchpriority="high">
          <figcaption class="caption">${escHtml(post.title)}</figcaption>
        </figure>

        ${tocHtml}

        <div class="ex-article-body article-body entry-content e-content prose">
          ${bodyHtml}

          <div class="ex-callout">
            <div class="h">${escHtml(isRu ? "Заметка редакции" : "Editor's note")}</div>
            <p>${escHtml(isRu ? "Этот материал отражает экспертную позицию редакции. Перед принятием решений сверяйтесь с актуальными первоисточниками." : "This piece reflects the editorial position of our team. Always consult primary sources before making decisions.")}</p>
          </div>

          <div class="ex-article-footer">
            <div class="label">${escHtml(isRu ? "Дата публикации" : "Published")}</div>
            <div class="date">${escHtml(dateMain.label || "")}${dateUpd.label && dateUpd.label !== dateMain.label ? ` · ${escHtml(isRu ? "обновлено" : "updated")} ${escHtml(dateUpd.label)}` : ""}</div>
          </div>
        </div>

        ${authorCardHtml}

        ${related.length ? `
          <section class="ex-article-related" aria-labelledby="ex-rel-h">
            <h2 id="ex-rel-h">${escHtml(isRu ? "Читать дальше" : "Read next")}</h2>
            <div class="ex-article-rel-grid">${relatedHtml}</div>
          </section>` : ""}

      </div>
    </article>
  </main>

  ${footerHtml(c)}
  ${widgets}
  ${pixel}
</body>
</html>`;
}
