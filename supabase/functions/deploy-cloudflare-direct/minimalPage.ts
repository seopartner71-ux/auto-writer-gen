// ============================================================================
// "Minimal" template (Site Factory template №5).
//
// Concept: Linear/Notion-style — clean typography, lots of whitespace,
// no big background hero photo. The HTML skeleton is intentionally distinct
// from landing/magazine/news so anti-fingerprint scanners cannot cluster it
// with other templates in the same PBN.
//
// All cross-cutting features are reused as-is:
//   - LandingContent text (generateLandingContent in landingPage.ts)
//   - FAL.ai photos (ensureLandingImages: hero, why, guarantee, about, team_*, post_*)
//   - Brand icon (ensureSiteIcon)
//   - SiteChrome head/header/footer/widgets/tracking pixel/cookie/widgets/totop
//   - phrasePools, antiFingerprint (CSS prefix .mn-*), backdating, smart
//     interlinking (works on rendered HTML), cost logging (already inside
//     ensureLandingImages and generateLandingContent)
//
// Only the middle of the home page and the article page is bespoke.
// CSS prefix: .mn-*  (gets obfuscated by antiFingerprint per-project seed).
// ============================================================================

import {
  type SiteChrome, type PostInput, type Author,
  buildHead, headerHtml, footerHtml,
  pickAuthor, pickAuthorByIndex, uniqueImageAlt, siteSeed,
} from "./seoChrome.ts";
import { pickPhrase } from "./phrasePools.ts";
import { widgetsHtml as renderSiteWidgets } from "./siteWidgets.ts";
import type { LandingContent } from "./landingPage.ts";

// ---------------------------------------------------------------------------
// Local utilities (kept self-contained — newsPage/magazinePage do the same).
// ---------------------------------------------------------------------------

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

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic pick from a list using a string seed. */
function pickFrom<T>(arr: T[], seed: string): T { return arr[hashStr(seed) % arr.length]; }

// ---------------------------------------------------------------------------
// Trust-bar SVG client logos (NO real brand names — just abstract marks).
// ---------------------------------------------------------------------------

function trustLogos(seed: string): string[] {
  // 6 simple monochrome shapes; deterministic per project so different sites
  // in the same PBN show different sets but each site is stable across
  // re-deploys.
  const shapes = [
    `<svg viewBox="0 0 120 32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="10"/><text x="34" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14">NORTHWIND</text></svg>`,
    `<svg viewBox="0 0 120 32" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="6" width="20" height="20" rx="3"/><text x="34" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14">VANTAGE</text></svg>`,
    `<svg viewBox="0 0 120 32" xmlns="http://www.w3.org/2000/svg"><polygon points="16,4 28,28 4,28"/><text x="34" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14">ARCANE</text></svg>`,
    `<svg viewBox="0 0 120 32" xmlns="http://www.w3.org/2000/svg"><path d="M6 16 L16 6 L26 16 L16 26 Z"/><text x="34" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14">PRISMIQ</text></svg>`,
    `<svg viewBox="0 0 120 32" xmlns="http://www.w3.org/2000/svg"><path d="M6 8 L26 8 L26 24 L6 24 Z M10 12 L22 12 M10 16 L22 16 M10 20 L22 20"/><text x="34" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14">LATTICE</text></svg>`,
    `<svg viewBox="0 0 120 32" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="16" r="6"/><circle cx="22" cy="16" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/><text x="34" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14">DUOSPHERE</text></svg>`,
    `<svg viewBox="0 0 120 32" xmlns="http://www.w3.org/2000/svg"><path d="M6 22 L12 8 L18 22 L24 8 L30 22"/><text x="40" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14">WAVELY</text></svg>`,
    `<svg viewBox="0 0 120 32" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="6" width="8" height="20"/><rect x="18" y="14" width="8" height="12"/><text x="34" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14">BLOCSY</text></svg>`,
  ];
  // Rotate set by seed; pick 6 distinct.
  const start = hashStr(seed + ":logos") % shapes.length;
  const out: string[] = [];
  for (let i = 0; i < 6; i++) out.push(shapes[(start + i) % shapes.length]);
  return out;
}

// ---------------------------------------------------------------------------
// CSS — prefixed .mn-*, fully self-contained. antiFingerprint will obfuscate
// every .mn-* class per-project; the prefix only matters until obfuscation.
// ---------------------------------------------------------------------------

export function minimalExtraCss(c: SiteChrome): string {
  const accent = c.accent || "#111111";
  return `
/* ===== Minimal template (Site Factory #5) ===== */
:root{--mn-accent:${accent};--mn-ink:#111;--mn-muted:#6b7280;--mn-border:#e5e7eb;--mn-bg:#fff;--mn-soft:#fafafa}
.page-minimal{background:var(--mn-bg);color:var(--mn-ink);font-family:"${c.bodyFont}",system-ui,-apple-system,sans-serif;line-height:1.6}
.page-minimal h1,.page-minimal h2,.page-minimal h3,.page-minimal h4{font-family:"${c.headingFont}","${c.bodyFont}",sans-serif;color:var(--mn-ink);font-weight:700;letter-spacing:-0.02em;line-height:1.15}
.mn-shell{max-width:1120px;margin:0 auto;padding:0 24px}
.mn-narrow{max-width:760px;margin:0 auto;padding:0 24px}
.mn-section{padding:88px 0}
.mn-eyebrow{display:inline-block;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--mn-muted);margin-bottom:16px}
.mn-btn{display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border-radius:8px;background:var(--mn-ink);color:#fff;font-weight:600;font-size:14px;text-decoration:none;border:1px solid var(--mn-ink);transition:transform .15s,opacity .15s}
.mn-btn:hover{transform:translateY(-1px);text-decoration:none;color:#fff;opacity:.92}
.mn-btn-ghost{background:transparent;color:var(--mn-ink);border:1px solid var(--mn-border)}
.mn-btn-ghost:hover{background:var(--mn-soft);color:var(--mn-ink)}
.mn-btn-light{background:#fff;color:#111;border:1px solid #fff}
.mn-btn-light:hover{background:#f3f4f6;color:#111}

/* Hero — typographic split */
.mn-hero{padding:96px 0 72px}
.mn-hero-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:64px;align-items:center}
.mn-hero h1{font-size:clamp(40px,5.5vw,68px);margin:0 0 20px}
.mn-hero .sub{font-size:clamp(17px,1.6vw,20px);color:var(--mn-muted);margin:0 0 32px;max-width:540px}
.mn-hero .ctas{display:flex;gap:12px;flex-wrap:wrap}
.mn-hero-art{position:relative}
.mn-hero-art img{width:100%;border-radius:14px;aspect-ratio:5/4;object-fit:cover;box-shadow:0 30px 70px -25px rgba(15,23,42,.35),0 8px 24px -10px rgba(15,23,42,.18)}
@media(max-width:880px){.mn-hero{padding:64px 0 48px}.mn-hero-grid{grid-template-columns:1fr;gap:40px}}

/* Trust bar */
.mn-trust{padding:48px 0;border-top:1px solid var(--mn-border);border-bottom:1px solid var(--mn-border);background:var(--mn-soft)}
.mn-trust-label{font-size:13px;color:var(--mn-muted);text-align:center;margin-bottom:24px;letter-spacing:.04em}
.mn-trust-row{display:grid;grid-template-columns:repeat(6,1fr);gap:24px;align-items:center;justify-items:center}
.mn-trust-row svg{width:120px;height:32px;color:#9ca3af;opacity:.85;transition:opacity .2s,color .2s}
.mn-trust-row svg:hover{opacity:1;color:#111}
@media(max-width:860px){.mn-trust-row{grid-template-columns:repeat(3,1fr);gap:32px 24px}}

/* Stats — text only, big numbers */
.mn-stats{padding:88px 0;border-bottom:1px solid var(--mn-border)}
.mn-stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:48px}
.mn-stat .num{font-family:"${c.headingFont}",sans-serif;font-size:clamp(48px,6vw,88px);font-weight:800;color:var(--mn-ink);line-height:1;letter-spacing:-0.04em}
.mn-stat .ttl{margin-top:14px;font-size:18px;font-weight:600;color:var(--mn-ink)}
.mn-stat .txt{margin-top:6px;font-size:15px;color:var(--mn-muted);max-width:280px}
@media(max-width:760px){.mn-stats-grid{grid-template-columns:1fr;gap:40px}}

/* Process — horizontal timeline ①─②─③─④ */
.mn-process{padding:88px 0;background:var(--mn-soft);border-bottom:1px solid var(--mn-border)}
.mn-process-head{text-align:center;margin-bottom:56px}
.mn-process-head h2{font-size:clamp(28px,3vw,40px);margin-bottom:12px}
.mn-process-head p{color:var(--mn-muted);max-width:560px;margin:0 auto}
.mn-timeline{display:grid;grid-template-columns:repeat(4,1fr);gap:0;position:relative;align-items:start}
.mn-timeline::before{content:"";position:absolute;top:24px;left:12.5%;right:12.5%;height:1px;background:var(--mn-border);z-index:0}
.mn-step{position:relative;text-align:center;z-index:1;padding:0 12px}
.mn-step .dot{display:inline-flex;width:48px;height:48px;border-radius:50%;background:#fff;border:1px solid var(--mn-border);color:var(--mn-ink);font-weight:700;font-size:16px;align-items:center;justify-content:center;margin-bottom:18px}
.mn-step h3{font-size:16px;margin-bottom:6px}
.mn-step p{font-size:14px;color:var(--mn-muted);max-width:200px;margin:0 auto}
@media(max-width:760px){.mn-timeline{grid-template-columns:1fr;gap:32px}.mn-timeline::before{display:none}}

/* Services — bordered white cards, no color fills */
.mn-services{padding:96px 0}
.mn-services-head{text-align:center;margin-bottom:56px}
.mn-services-head h2{font-size:clamp(28px,3vw,40px);margin-bottom:12px}
.mn-services-head p{color:var(--mn-muted);max-width:560px;margin:0 auto}
.mn-svc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.mn-svc{background:#fff;border:1px solid var(--mn-border);border-radius:14px;padding:32px 28px;display:flex;flex-direction:column;transition:border-color .2s,transform .2s}
.mn-svc:hover{border-color:var(--mn-ink);transform:translateY(-2px)}
.mn-svc h3{font-size:20px;margin-bottom:10px}
.mn-svc .price{font-family:"${c.headingFont}",sans-serif;font-size:24px;font-weight:700;margin:6px 0 18px;color:var(--mn-ink)}
.mn-svc ul{list-style:none;padding:0;margin:0 0 24px;flex:1}
.mn-svc li{padding:8px 0;font-size:14px;color:var(--mn-muted);border-top:1px solid var(--mn-border);position:relative;padding-left:18px}
.mn-svc li:first-child{border-top:none}
.mn-svc li::before{content:"+";position:absolute;left:0;color:var(--mn-ink);font-weight:700}
.mn-svc-cta{display:inline-flex;align-items:center;gap:6px;color:var(--mn-ink);font-weight:600;font-size:14px;margin-top:auto;text-decoration:none;border-bottom:1px solid var(--mn-ink);align-self:flex-start;padding-bottom:2px}
.mn-svc-cta:hover{color:var(--mn-ink);text-decoration:none;opacity:.7}
@media(max-width:880px){.mn-svc-grid{grid-template-columns:1fr;gap:18px}}

/* Testimonials — quotes, no avatars */
.mn-testimonials{padding:96px 0;background:var(--mn-soft);border-top:1px solid var(--mn-border);border-bottom:1px solid var(--mn-border)}
.mn-test-head{text-align:center;margin-bottom:56px}
.mn-test-head h2{font-size:clamp(28px,3vw,40px)}
.mn-quotes{display:grid;grid-template-columns:repeat(3,1fr);gap:32px}
.mn-quote{padding:24px}
.mn-quote .qmark{font-family:"${c.headingFont}",serif;font-size:64px;line-height:1;color:var(--mn-ink);opacity:.18;margin-bottom:8px}
.mn-quote blockquote{font-style:italic;font-size:18px;color:var(--mn-ink);margin:0 0 24px;padding:0;border:none;line-height:1.55}
.mn-quote .who{padding-top:16px;border-top:1px solid var(--mn-border);font-size:14px;color:var(--mn-muted)}
.mn-quote .who strong{color:var(--mn-ink);font-weight:600;display:block;margin-bottom:2px}
@media(max-width:880px){.mn-quotes{grid-template-columns:1fr;gap:24px}}

/* Blog list — simple list, NOT cards */
.mn-blog{padding:96px 0}
.mn-blog-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:48px;gap:24px;flex-wrap:wrap}
.mn-blog-head h2{font-size:clamp(28px,3vw,40px)}
.mn-blog-list{list-style:none;padding:0;margin:0;border-top:1px solid var(--mn-border)}
.mn-blog-list li{border-bottom:1px solid var(--mn-border)}
.mn-blog-list a{display:grid;grid-template-columns:140px 1fr auto;gap:32px;align-items:center;padding:24px 0;color:var(--mn-ink);text-decoration:none;transition:padding .2s,opacity .2s}
.mn-blog-list a:hover{padding-left:8px;text-decoration:none;color:var(--mn-ink)}
.mn-blog-list .meta-l{font-size:14px;color:var(--mn-muted);font-variant-numeric:tabular-nums}
.mn-blog-list .ttl{font-size:18px;font-weight:600;line-height:1.4}
.mn-blog-list .meta-r{font-size:13px;color:var(--mn-muted);text-align:right;white-space:nowrap}
.mn-blog-list .arrow{display:inline-block;margin-left:6px;color:var(--mn-muted);transition:transform .2s,color .2s}
.mn-blog-list a:hover .arrow{color:var(--mn-ink);transform:translateX(4px)}
@media(max-width:760px){.mn-blog-list a{grid-template-columns:1fr;gap:8px;padding:20px 0}.mn-blog-list .meta-r{text-align:left}}

/* CTA — minimal dark */
.mn-cta{background:#111;color:#fff;padding:88px 24px;text-align:center}
.mn-cta h2{color:#fff;font-size:clamp(28px,3.5vw,44px);margin-bottom:18px}
.mn-cta p{color:rgba(255,255,255,.72);max-width:560px;margin:0 auto 32px;font-size:17px}

/* About short — text + photo */
.mn-about{padding:96px 0;border-bottom:1px solid var(--mn-border)}
.mn-about-grid{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center}
.mn-about-grid img{width:100%;border-radius:14px;aspect-ratio:4/3;object-fit:cover}
.mn-about-grid h2{font-size:clamp(28px,3vw,40px);margin-bottom:16px}
.mn-about-grid p{color:var(--mn-muted);font-size:17px;margin-bottom:24px}
@media(max-width:880px){.mn-about-grid{grid-template-columns:1fr;gap:32px}}

/* Article page */
.mn-article{padding:64px 0 96px}
.mn-article-head{max-width:760px;margin:0 auto;padding:0 24px;text-align:left}
.mn-article-head .crumbs{font-size:13px;color:var(--mn-muted);margin-bottom:24px}
.mn-article-head .crumbs a{color:var(--mn-muted);text-decoration:none}
.mn-article-head .crumbs a:hover{color:var(--mn-ink)}
.mn-article-head h1{font-size:clamp(32px,4vw,52px);margin:0 0 20px;letter-spacing:-0.02em}
.mn-article-head .lead{font-size:20px;color:var(--mn-muted);margin:0 0 28px;line-height:1.5}
.mn-article-meta{display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:14px;color:var(--mn-muted);padding:20px 0;border-top:1px solid var(--mn-border);border-bottom:1px solid var(--mn-border)}
.mn-article-meta address{font-style:normal;color:var(--mn-ink);font-weight:600}
.mn-article-meta time{font-variant-numeric:tabular-nums}
.mn-article-hero{max-width:1120px;margin:32px auto 0;padding:0 24px}
.mn-article-hero img{width:100%;border-radius:14px;aspect-ratio:16/8;object-fit:cover}
.mn-article-body{max-width:760px;margin:48px auto 0;padding:0 24px;font-size:18px;line-height:1.75;color:#1f2937}
.mn-article-body h2{font-size:32px;margin:48px 0 16px;letter-spacing:-0.02em}
.mn-article-body h3{font-size:24px;margin:36px 0 12px}
.mn-article-body p{margin:0 0 20px}
.mn-article-body ul,.mn-article-body ol{margin:0 0 24px;padding-left:24px}
.mn-article-body li{margin-bottom:8px}
.mn-article-body a{color:var(--mn-ink);text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
.mn-article-body blockquote{margin:32px 0;padding:8px 0 8px 24px;border-left:3px solid var(--mn-ink);font-style:italic;color:var(--mn-ink);font-size:20px}
.mn-article-body img{border-radius:10px;margin:24px 0}
.mn-article-body table{width:100%;border-collapse:collapse;margin:24px 0;font-size:15px}
.mn-article-body table th,.mn-article-body table td{padding:12px 16px;border-bottom:1px solid var(--mn-border);text-align:left}
.mn-article-body table th{font-weight:600;background:var(--mn-soft)}
.mn-article-related{max-width:1120px;margin:80px auto 0;padding:64px 24px 0;border-top:1px solid var(--mn-border)}
.mn-article-related h2{font-size:28px;margin-bottom:32px}
.mn-article-rel-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:32px}
.mn-rel{display:block;padding:24px;border:1px solid var(--mn-border);border-radius:12px;color:var(--mn-ink);text-decoration:none;transition:border-color .2s}
.mn-rel:hover{border-color:var(--mn-ink);text-decoration:none;color:var(--mn-ink)}
.mn-rel time{font-size:13px;color:var(--mn-muted)}
.mn-rel h3{font-size:17px;margin:8px 0 0;line-height:1.4}
@media(max-width:880px){.mn-article-rel-grid{grid-template-columns:1fr;gap:16px}}
`;
}

// ---------------------------------------------------------------------------
// HOME PAGE
// ---------------------------------------------------------------------------

export interface MinimalHomeOpts {
  chrome: SiteChrome;
  posts: PostInput[];
  /** Pre-generated text content (heroes, services, team, testimonials, etc.) */
  content: LandingContent;
  /** FAL image URLs by slot (hero/why/about/guarantee/team_*/post_*). */
  generatedImages?: Record<string, string>;
  expertAuthor?: Author | null;
}

export function renderMinimalHome(opts: MinimalHomeOpts): string {
  const { chrome: c, posts, content: ct } = opts;
  const isRu = c.lang === "ru";
  const seed = siteSeed(c);
  const imgs = opts.generatedImages || {};
  const heroImg = imgs["hero"] || imgs["about"] || (posts[0]?.featuredImageUrl) ||
    `https://picsum.photos/seed/${encodeURIComponent(c.domain)}/1000/800`;
  const aboutImg = imgs["about"] || imgs["why"] ||
    `https://picsum.photos/seed/${encodeURIComponent(c.domain + "::about")}/1000/750`;

  const stats3 = (ct.stats || []).slice(0, 3);
  const services3 = (ct.services || []).slice(0, 3);
  const proc4 = (ct.process || []).slice(0, 4);
  const tests3 = (ct.testimonials || []).slice(0, 3);

  const stepCircled = ["①", "②", "③", "④"];
  const proceessHtml = proc4.map((s, i) => `
    <div class="mn-step">
      <span class="dot">${stepCircled[i] || (i + 1)}</span>
      <h3>${escHtml(s.title)}</h3>
      <p>${escHtml(s.text)}</p>
    </div>`).join("");

  const statsHtml = stats3.map((s) => `
    <div class="mn-stat">
      <div class="num">${escHtml(s.value)}</div>
      <div class="ttl">${escHtml(s.label)}</div>
    </div>`).join("");

  const servicesHtml = services3.map((s) => `
    <div class="mn-svc">
      <h3>${escHtml(s.title)}</h3>
      <div class="price">${escHtml(s.price)}</div>
      <ul>${(s.bullets || []).slice(0, 5).map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>
      <a class="mn-svc-cta" href="#cta">${escHtml(isRu ? "Заказать" : "Request")} →</a>
    </div>`).join("");

  const quotesHtml = tests3.map((t) => `
    <div class="mn-quote">
      <div class="qmark" aria-hidden="true">&ldquo;</div>
      <blockquote>${escHtml(t.text)}</blockquote>
      <div class="who"><strong>${escHtml(t.name)}</strong>${t.role ? `<span>${escHtml(t.role)}</span>` : ""}</div>
    </div>`).join("");

  const trust = trustLogos(seed);
  const trustHtml = trust.map((svg) => `<div>${svg}</div>`).join("");

  // Blog list — chronological, no cards
  const blogList = posts.slice(0, 8);
  const blogListHtml = blogList.map((p) => {
    const d = fmtDate(p.publishedAt, isRu);
    return `
      <li>
        <a href="/posts/${escAttr(p.slug)}.html">
          <span class="meta-l">${escHtml(d.label || "")}</span>
          <span class="ttl">${escHtml(p.title)}<span class="arrow"> →</span></span>
          <span class="meta-r">${readingTime(p.contentHtml)} ${escHtml(isRu ? "мин чтения" : "min read")}</span>
        </a>
      </li>`;
  }).join("") || `<li><a href="#"><span class="ttl">${escHtml(isRu ? "Скоро здесь появятся новые материалы." : "Posts coming soon.")}</span></a></li>`;

  const trustLabel = isRu ? "Нам доверяют" : "Trusted by teams at";

  // JSON-LD
  const orgLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": c.siteName,
    "url": `https://${c.domain}/`,
    "logo": c.iconUrl || undefined,
    "description": c.siteAbout,
  };
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
    })),
  };

  const head = buildHead(c, {
    title: `${c.siteName} — ${ct.heroBadge || c.topic}`,
    description: (ct.heroSubtitle || c.siteAbout || "").slice(0, 160),
    path: "/",
    type: "website",
    breadcrumbs: [{ label: isRu ? "Главная" : "Home", href: "/" }],
    jsonLd: [orgLd as any, blogLd as any],
    ogImage: imgs["hero"] || c.ogImageUrl,
  });

  const pixel = (c.projectId && c.trackerUrl)
    ? `<img src="${escAttr(c.trackerUrl)}?site=${escAttr(c.projectId)}&u=${encodeURIComponent("/")}" width="1" height="1" alt="" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade">`
    : "";

  const lead = (c.teamMembers && c.teamMembers[0]) || null;
  const widgets = renderSiteWidgets({
    lang: c.lang as "ru" | "en",
    accent: c.accent,
    consultantName: lead?.name || (c.companyName || c.siteName),
    consultantPhoto: imgs["team_1"],
    siteName: c.siteName,
    topic: c.topic,
    totopPosition: c.totopPosition || "left-bottom",
    seed,
  });

  return `${head}
<body class="page-minimal page-home">
  ${headerHtml(c)}
  <main id="main-content">

    <section class="mn-hero">
      <div class="mn-shell">
        <div class="mn-hero-grid">
          <div>
            <span class="mn-eyebrow">${escHtml(ct.heroBadge || c.topic)}</span>
            <h1>${escHtml(ct.heroTitle)}</h1>
            <p class="sub">${escHtml(ct.heroSubtitle)}</p>
            <div class="ctas">
              <a class="mn-btn" href="#cta">${escHtml(ct.ctaPrimary || (isRu ? "Начать" : "Get started"))}</a>
              <a class="mn-btn mn-btn-ghost" href="#services">${escHtml(ct.ctaSecondary || (isRu ? "Узнать больше" : "Learn more"))}</a>
            </div>
          </div>
          <div class="mn-hero-art">
            <img src="${escAttr(heroImg)}" alt="${escAttr(uniqueImageAlt(c, ct.heroTitle, 0))}" width="1000" height="800" loading="eager" decoding="async" fetchpriority="high">
          </div>
        </div>
      </div>
    </section>

    <section class="mn-trust" aria-label="${escAttr(trustLabel)}">
      <div class="mn-shell">
        <div class="mn-trust-label">${escHtml(trustLabel)}</div>
        <div class="mn-trust-row" aria-hidden="true">${trustHtml}</div>
      </div>
    </section>

    <section class="mn-stats">
      <div class="mn-shell">
        <div class="mn-stats-grid">${statsHtml}</div>
      </div>
    </section>

    <section class="mn-process" id="process">
      <div class="mn-shell">
        <div class="mn-process-head">
          <span class="mn-eyebrow">${escHtml(isRu ? "Процесс" : "Process")}</span>
          <h2>${escHtml(isRu ? "Как мы работаем" : "How we work")}</h2>
          <p>${escHtml(pickPhrase("ctaSectionText", c.lang, seed))}</p>
        </div>
        <div class="mn-timeline">${proceessHtml}</div>
      </div>
    </section>

    <section class="mn-services" id="services">
      <div class="mn-shell">
        <div class="mn-services-head">
          <span class="mn-eyebrow">${escHtml(isRu ? "Услуги" : "Services")}</span>
          <h2>${escHtml(isRu ? "Наши услуги и пакеты" : "Our services & packages")}</h2>
          <p>${escHtml(isRu ? "Выберите подходящий вариант или закажите индивидуальный расчет." : "Pick a package or request a custom quote.")}</p>
        </div>
        <div class="mn-svc-grid">${servicesHtml}</div>
      </div>
    </section>

    <section class="mn-testimonials">
      <div class="mn-shell">
        <div class="mn-test-head">
          <span class="mn-eyebrow">${escHtml(isRu ? "Отзывы" : "Testimonials")}</span>
          <h2>${escHtml(isRu ? "Что говорят клиенты" : "What clients say")}</h2>
        </div>
        <div class="mn-quotes">${quotesHtml}</div>
      </div>
    </section>

    <section class="mn-blog" id="blog">
      <div class="mn-shell">
        <div class="mn-blog-head">
          <div>
            <span class="mn-eyebrow">${escHtml(isRu ? "Блог" : "Blog")}</span>
            <h2>${escHtml(ct.blogTitle || (isRu ? "Свежие материалы" : "Latest writing"))}</h2>
          </div>
          <a class="mn-btn mn-btn-ghost" href="/blog/">${escHtml(isRu ? "Все статьи" : "All posts")}</a>
        </div>
        <ul class="mn-blog-list">${blogListHtml}</ul>
      </div>
    </section>

    <section class="mn-about" id="about">
      <div class="mn-shell">
        <div class="mn-about-grid">
          <div>
            <span class="mn-eyebrow">${escHtml(isRu ? "О нас" : "About")}</span>
            <h2>${escHtml(ct.aboutShortTitle)}</h2>
            <p>${escHtml(ct.aboutShortText)}</p>
            <a class="mn-btn mn-btn-ghost" href="/about.html">${escHtml(isRu ? "Подробнее о компании" : "More about us")}</a>
          </div>
          <img src="${escAttr(aboutImg)}" alt="${escAttr(uniqueImageAlt(c, ct.aboutShortTitle, 1))}" width="1000" height="750" loading="lazy" decoding="async">
        </div>
      </div>
    </section>

    <section class="mn-cta" id="cta">
      <h2>${escHtml(ct.ctaSectionTitle)}</h2>
      <p>${escHtml(ct.ctaSectionText)}</p>
      <a class="mn-btn mn-btn-light" href="tel:${escAttr((ct.phone || "").replace(/[^+\d]/g, ""))}">${escHtml(ct.ctaPrimary || (isRu ? "Связаться" : "Get in touch"))}</a>
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

export interface MinimalArticleOpts {
  chrome: SiteChrome;
  post: PostInput;
  related: PostInput[];
  postIndex?: number;
}

export function renderMinimalArticle(opts: MinimalArticleOpts): string {
  const { chrome: c, post, related } = opts;
  const isRu = c.lang === "ru";
  const seed = siteSeed(c);
  const idx = typeof opts.postIndex === "number" ? opts.postIndex : 0;
  const author = pickAuthorByIndex(c.authors || [], idx)
    || pickAuthor(c.authors || [], post.slug);
  const minutes = readingTime(post.contentHtml);
  const dateMain = fmtDate(post.publishedAt, isRu);
  const heroAlt = uniqueImageAlt(c, post.title, 0);
  const heroUrl = postImage(post, 1600, 800);

  const breadcrumbs = [
    { label: isRu ? "Главная" : "Home", href: "/" },
    { label: isRu ? "Блог" : "Blog", href: "/blog/" },
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
    "author": author ? { "@type": "Person", "name": author.name } : undefined,
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

  const relatedHtml = related.slice(0, 3).map((p) => {
    const d = fmtDate(p.publishedAt, isRu);
    return `
      <a class="mn-rel" href="/posts/${escAttr(p.slug)}.html">
        ${d.label ? `<time datetime="${escAttr(d.dt)}">${escHtml(d.label)}</time>` : ""}
        <h3>${escHtml(p.title)}</h3>
      </a>`;
  }).join("");

  const crumbsHtml = breadcrumbs.map((b, i) =>
    i === breadcrumbs.length - 1
      ? `<span>${escHtml(b.label)}</span>`
      : `<a href="${escAttr(b.href)}">${escHtml(b.label)}</a> · `,
  ).join("");

  // Apply microformats classes the antiFingerprint allowlist preserves
  // (h-entry/p-name/e-content/dt-published/p-author/h-card) so reader-mode
  // and microformat parsers can still extract the article cleanly even after
  // CSS class obfuscation.
  return `${head}
<body class="page-minimal page-article">
  ${headerHtml(c)}
  <main id="main-content">
    <article class="mn-article h-entry">
      <div class="mn-article-head">
        <nav class="crumbs" aria-label="breadcrumbs">${crumbsHtml}</nav>
        <h1 class="p-name">${escHtml(post.title)}</h1>
        ${post.excerpt ? `<p class="lead p-summary">${escHtml(post.excerpt)}</p>` : ""}
        <div class="mn-article-meta">
          ${author ? `<address class="p-author h-card">${escHtml(author.name)}</address>` : ""}
          ${dateMain.label ? `<time class="dt-published" datetime="${escAttr(dateMain.dt)}">${escHtml(dateMain.label)}</time>` : ""}
          <span>${minutes} ${escHtml(isRu ? "мин чтения" : "min read")}</span>
        </div>
      </div>

      <div class="mn-article-hero">
        <img src="${escAttr(heroUrl)}" alt="${escAttr(heroAlt)}" width="1600" height="800" loading="eager" decoding="async" fetchpriority="high">
      </div>

      <div class="mn-article-body article-body entry-content e-content prose">
        ${post.contentHtml || ""}
      </div>
    </article>

    ${related.length ? `
      <section class="mn-article-related" aria-labelledby="mn-rel-h">
        <h2 id="mn-rel-h">${escHtml(isRu ? "Ещё материалы" : "More stories")}</h2>
        <div class="mn-article-rel-grid">${relatedHtml}</div>
      </section>
    ` : ""}
  </main>
  ${footerHtml(c)}
  ${widgets}
  ${pixel}
</body>
</html>`;
}