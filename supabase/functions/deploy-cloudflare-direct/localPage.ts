// ============================================================================
// "Local Business" template (Site Factory template №7).
//
// Concept: Hyper-local service business (car repair / dental / cleaning /
// renovation). Feature-flag: BIG phone number, work hours, service area map
// placeholder, before/after gallery, "near you" badges. Warm friendly palette
// (off-white + accent), HUGE click-to-call button, sticky bottom mobile bar.
//
// All cross-cutting features reused as-is.
// CSS prefix: .lb-*  (gets obfuscated by antiFingerprint per-project seed).
// ============================================================================

import {
  type SiteChrome, type PostInput, type Author,
  buildHead, headerHtml, footerHtml,
  pickAuthor, pickAuthorByIndex, uniqueImageAlt, siteSeed,
} from "./seoChrome.ts";
import { pickPhrase } from "./phrasePools.ts";
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

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// SVG map placeholder — abstract street grid with pin
function mapSvg(seed: string): string {
  const h = hashStr(seed + ":lb-map");
  const cx = 35 + (h % 30);
  const cy = 35 + ((h >> 8) % 30);
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="100" height="100" fill="#f3efe7"/>
    <g stroke="#d6cdb8" stroke-width=".4" fill="none">
      <path d="M0 20 L100 20 M0 45 L100 45 M0 70 L100 70 M0 90 L100 90"/>
      <path d="M20 0 L20 100 M55 0 L55 100 M80 0 L80 100"/>
      <path d="M0 60 Q40 55 100 70" stroke="#c8b58a" stroke-width=".7"/>
      <path d="M30 0 Q40 50 70 100" stroke="#c8b58a" stroke-width=".7"/>
    </g>
    <g fill="#bdb494" opacity=".6"><rect x="22" y="22" width="10" height="8"/><rect x="58" y="48" width="14" height="9"/><rect x="22" y="72" width="9" height="9"/><rect x="62" y="22" width="11" height="9"/></g>
    <g transform="translate(${cx} ${cy})"><circle r="9" fill="currentColor" opacity=".18"/><path d="M0 -7 C-4 -7 -7 -4 -7 0 C-7 5 0 12 0 12 C0 12 7 5 7 0 C7 -4 4 -7 0 -7 Z" fill="currentColor"/><circle cy="-1" r="2" fill="#fff"/></g>
  </svg>`;
}

// ---------------------------------------------------------------------------
// CSS — prefixed .lb-*
// ---------------------------------------------------------------------------

export function localExtraCss(c: SiteChrome): string {
  const accent = c.accent || "#c2410c";
  return `
/* ===== Local Business template (Site Factory #7) ===== */
:root{--lb-accent:${accent};--lb-bg:#fbf8f3;--lb-paper:#fff;--lb-ink:#1c1917;--lb-muted:#78716c;--lb-soft:#f5f0e6;--lb-border:#e7dfd0;--lb-warm:#fef3c7}
.page-local{background:var(--lb-bg);color:var(--lb-ink);font-family:"${c.bodyFont}",system-ui,-apple-system,sans-serif;line-height:1.6}
.page-local h1,.page-local h2,.page-local h3,.page-local h4{font-family:"${c.headingFont}","${c.bodyFont}",sans-serif;color:var(--lb-ink);font-weight:700;letter-spacing:-0.015em;line-height:1.18}
.page-local .container,.lb-shell{max-width:1180px;margin:0 auto;padding:0 24px}
.lb-eyebrow{display:inline-flex;align-items:center;gap:8px;padding:5px 14px;border-radius:999px;background:var(--lb-warm);color:#92400e;font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;margin-bottom:18px}
.lb-eyebrow::before{content:"📍"}

.lb-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:14px 26px;border-radius:10px;background:var(--lb-accent);color:#fff;font-weight:700;font-size:15px;text-decoration:none;border:2px solid var(--lb-accent);transition:transform .15s,box-shadow .15s,background .15s}
.lb-btn:hover{transform:translateY(-2px);text-decoration:none;color:#fff;box-shadow:0 12px 28px -8px rgba(0,0,0,.25);background:var(--lb-accent);filter:brightness(1.05)}
.lb-btn-ghost{background:transparent;color:var(--lb-ink);border:2px solid var(--lb-border)}
.lb-btn-ghost:hover{background:var(--lb-soft);color:var(--lb-ink)}
.lb-btn-call{background:#16a34a;border-color:#16a34a;font-size:18px;padding:18px 32px;border-radius:14px}
.lb-btn-call:hover{background:#15803d;border-color:#15803d}

/* Top alert bar */
.lb-topbar{background:var(--lb-ink);color:#fef3c7;padding:8px 0;font-size:13px;text-align:center}
.lb-topbar a{color:#fef3c7;text-decoration:underline}
.lb-topbar strong{color:#fff}

/* Hero — split with phone+map */
.lb-hero{padding:64px 0 80px;background:linear-gradient(180deg,var(--lb-bg) 0%,var(--lb-soft) 100%)}
.lb-hero-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center}
.lb-hero h1{font-size:clamp(36px,5vw,60px);margin:0 0 18px}
.lb-hero h1 .acc{color:var(--lb-accent)}
.lb-hero .sub{font-size:clamp(17px,1.6vw,19px);color:var(--lb-muted);margin:0 0 28px;max-width:560px}
.lb-hero-cta{display:flex;flex-direction:column;gap:12px;max-width:380px}
.lb-hero-trust{display:flex;flex-wrap:wrap;gap:18px;margin-top:24px;font-size:13px;color:var(--lb-muted)}
.lb-hero-trust span{display:inline-flex;align-items:center;gap:6px}
.lb-hero-trust span::before{content:"✓";color:#16a34a;font-weight:700}
.lb-hero-art{position:relative;border-radius:18px;overflow:hidden;border:1px solid var(--lb-border);box-shadow:0 24px 60px -20px rgba(0,0,0,.25)}
.lb-hero-art img{width:100%;display:block;aspect-ratio:5/4;object-fit:cover}
.lb-hero-art .ribbon{position:absolute;top:18px;left:0;background:var(--lb-accent);color:#fff;padding:8px 18px;font-weight:700;font-size:14px;letter-spacing:.04em;text-transform:uppercase;border-radius:0 8px 8px 0;box-shadow:0 6px 14px -4px rgba(0,0,0,.25)}
@media(max-width:880px){.lb-hero{padding:48px 0 56px}.lb-hero-grid{grid-template-columns:1fr;gap:36px}.lb-hero-cta{max-width:none}}

/* Quick info strip — 4 cards under hero */
.lb-info{padding:24px 0;background:var(--lb-paper);border-top:1px solid var(--lb-border);border-bottom:1px solid var(--lb-border)}
.lb-info-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.lb-info-card{display:flex;align-items:center;gap:14px;padding:14px}
.lb-info-card .ic{width:44px;height:44px;border-radius:12px;background:var(--lb-warm);color:var(--lb-accent);display:inline-flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0}
.lb-info-card .lab{font-size:11px;color:var(--lb-muted);letter-spacing:.04em;text-transform:uppercase;margin-bottom:2px}
.lb-info-card .val{font-weight:700;color:var(--lb-ink);font-size:15px}
.lb-info-card .val a{color:var(--lb-ink);text-decoration:none}
@media(max-width:880px){.lb-info-grid{grid-template-columns:1fr 1fr;gap:8px}}
@media(max-width:520px){.lb-info-grid{grid-template-columns:1fr}}

/* Services grid — 3 cols, photo + bullets */
.lb-services{padding:80px 0}
.lb-services-head{text-align:center;margin-bottom:48px}
.lb-services-head h2{font-size:clamp(28px,3vw,40px);margin-bottom:12px}
.lb-services-head p{color:var(--lb-muted);max-width:560px;margin:0 auto}
.lb-svc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.lb-svc{background:var(--lb-paper);border:1px solid var(--lb-border);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;transition:transform .2s,box-shadow .2s}
.lb-svc:hover{transform:translateY(-3px);box-shadow:0 16px 32px -12px rgba(0,0,0,.15)}
.lb-svc .img{aspect-ratio:16/10;background:var(--lb-soft);overflow:hidden}
.lb-svc .img img{width:100%;height:100%;object-fit:cover}
.lb-svc .body{padding:24px;display:flex;flex-direction:column;flex:1}
.lb-svc h3{font-size:20px;margin:0 0 8px}
.lb-svc .price{font-family:"${c.headingFont}",sans-serif;font-size:22px;font-weight:800;color:var(--lb-accent);margin:6px 0 16px}
.lb-svc ul{list-style:none;padding:0;margin:0 0 20px;flex:1}
.lb-svc li{padding:6px 0 6px 22px;font-size:14px;color:#52525b;position:relative}
.lb-svc li::before{content:"✓";position:absolute;left:0;color:#16a34a;font-weight:700}
.lb-svc-cta{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:11px 18px;border-radius:8px;background:var(--lb-soft);color:var(--lb-ink);font-weight:700;font-size:14px;text-decoration:none;transition:background .2s}
.lb-svc-cta:hover{background:var(--lb-warm);color:var(--lb-ink);text-decoration:none}
@media(max-width:880px){.lb-svc-grid{grid-template-columns:1fr;gap:16px}}

/* Map + contact CTA */
.lb-map{padding:80px 0;background:var(--lb-soft);border-top:1px solid var(--lb-border);border-bottom:1px solid var(--lb-border)}
.lb-map-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center}
.lb-map-grid h2{font-size:clamp(28px,3vw,40px);margin-bottom:14px}
.lb-map-grid p{color:var(--lb-muted);font-size:17px;margin-bottom:24px}
.lb-map-list{list-style:none;padding:0;margin:0 0 28px}
.lb-map-list li{padding:10px 0 10px 30px;font-size:15px;color:var(--lb-ink);position:relative;border-bottom:1px solid var(--lb-border)}
.lb-map-list li:last-child{border-bottom:none}
.lb-map-list li::before{content:"📍";position:absolute;left:0;top:10px}
.lb-map-frame{position:relative;border-radius:18px;overflow:hidden;border:1px solid var(--lb-border);background:#f3efe7;aspect-ratio:4/3;color:var(--lb-accent);box-shadow:0 16px 40px -16px rgba(0,0,0,.25)}
.lb-map-frame svg{width:100%;height:100%;display:block}
.lb-map-frame .pin-label{position:absolute;left:50%;top:8%;transform:translateX(-50%);background:var(--lb-paper);border:1px solid var(--lb-border);padding:6px 14px;border-radius:999px;font-size:13px;font-weight:600;color:var(--lb-ink);box-shadow:0 4px 10px -2px rgba(0,0,0,.15)}
@media(max-width:880px){.lb-map-grid{grid-template-columns:1fr;gap:32px}}

/* Process — 4 steps with big numbers */
.lb-process{padding:80px 0}
.lb-process-head{text-align:center;margin-bottom:48px}
.lb-process-head h2{font-size:clamp(28px,3vw,40px)}
.lb-proc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;counter-reset:lb}
.lb-proc-step{position:relative;padding:28px 22px;background:var(--lb-paper);border:1px solid var(--lb-border);border-radius:14px;counter-increment:lb}
.lb-proc-step::before{content:counter(lb,decimal-leading-zero);position:absolute;top:-18px;left:22px;font-family:"${c.headingFont}",sans-serif;font-size:48px;font-weight:800;color:var(--lb-accent);line-height:1;background:var(--lb-bg);padding:0 8px}
.lb-proc-step h3{font-size:17px;margin:24px 0 8px}
.lb-proc-step p{font-size:14px;color:var(--lb-muted);margin:0}
@media(max-width:880px){.lb-proc-grid{grid-template-columns:1fr;gap:18px}}

/* Reviews — Google-like cards */
.lb-reviews{padding:80px 0;background:var(--lb-soft);border-top:1px solid var(--lb-border);border-bottom:1px solid var(--lb-border)}
.lb-rev-head{text-align:center;margin-bottom:48px}
.lb-rev-head h2{font-size:clamp(28px,3vw,40px);margin-bottom:8px}
.lb-rev-rating{display:inline-flex;align-items:center;gap:8px;margin-top:8px;color:var(--lb-muted);font-size:15px}
.lb-rev-rating .stars{color:#f59e0b;letter-spacing:2px;font-size:20px}
.lb-rev-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.lb-rev{background:var(--lb-paper);border:1px solid var(--lb-border);border-radius:14px;padding:24px}
.lb-rev .stars{color:#f59e0b;letter-spacing:2px;margin-bottom:10px;font-size:16px}
.lb-rev blockquote{margin:0 0 18px;padding:0;border:none;font-size:15px;color:var(--lb-ink);line-height:1.55}
.lb-rev .who{display:flex;align-items:center;gap:12px;padding-top:14px;border-top:1px solid var(--lb-border)}
.lb-rev .av{width:40px;height:40px;border-radius:50%;background:var(--lb-accent);color:#fff;font-weight:700;display:inline-flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
.lb-rev .who-meta strong{display:block;font-size:14px;color:var(--lb-ink)}
.lb-rev .who-meta span{display:block;font-size:12px;color:var(--lb-muted);margin-top:2px}
@media(max-width:880px){.lb-rev-grid{grid-template-columns:1fr;gap:14px}}

/* Blog */
.lb-blog{padding:80px 0}
.lb-blog-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:36px;gap:16px;flex-wrap:wrap}
.lb-blog-head h2{font-size:clamp(28px,3vw,40px)}
.lb-blog-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.lb-bcard{display:flex;flex-direction:column;background:var(--lb-paper);border:1px solid var(--lb-border);border-radius:14px;overflow:hidden;text-decoration:none;color:var(--lb-ink);transition:transform .2s,box-shadow .2s}
.lb-bcard:hover{transform:translateY(-3px);text-decoration:none;color:var(--lb-ink);box-shadow:0 16px 32px -12px rgba(0,0,0,.15)}
.lb-bcard .img{aspect-ratio:16/10;background:var(--lb-soft);overflow:hidden}
.lb-bcard .img img{width:100%;height:100%;object-fit:cover}
.lb-bcard .body{padding:18px}
.lb-bcard .meta{font-size:12px;color:var(--lb-muted);margin-bottom:8px;font-variant-numeric:tabular-nums}
.lb-bcard h3{font-size:17px;margin:0 0 6px;line-height:1.4}
.lb-bcard p{font-size:14px;color:var(--lb-muted);margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
@media(max-width:880px){.lb-blog-grid{grid-template-columns:1fr;gap:14px}}

/* Final CTA strip */
.lb-cta{padding:64px 24px;background:var(--lb-accent);color:#fff;text-align:center}
.lb-cta h2{color:#fff;font-size:clamp(28px,3.4vw,42px);margin-bottom:14px}
.lb-cta p{color:rgba(255,255,255,.92);max-width:560px;margin:0 auto 28px;font-size:17px}
.lb-cta .lb-btn{background:#fff;color:var(--lb-ink);border-color:#fff}
.lb-cta .lb-btn:hover{background:#fff;color:var(--lb-ink);filter:none;box-shadow:0 16px 32px -8px rgba(0,0,0,.3)}

/* Sticky mobile call bar */
.lb-mobile-bar{display:none;position:fixed;left:0;right:0;bottom:0;z-index:80;background:var(--lb-paper);border-top:1px solid var(--lb-border);padding:10px 14px;gap:8px;box-shadow:0 -8px 20px -10px rgba(0,0,0,.15)}
.lb-mobile-bar a{flex:1;text-align:center;padding:12px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none}
.lb-mobile-bar .call{background:#16a34a;color:#fff}
.lb-mobile-bar .write{background:var(--lb-accent);color:#fff}
@media(max-width:760px){.lb-mobile-bar{display:flex}.page-local{padding-bottom:64px}}

/* Article page */
.lb-article{padding:48px 0 80px}
.lb-article-head{max-width:780px;margin:0 auto;padding:0 24px}
.lb-article-head .crumbs{font-size:13px;color:var(--lb-muted);margin-bottom:20px}
.lb-article-head .crumbs a{color:var(--lb-muted);text-decoration:none}
.lb-article-head .crumbs a:hover{color:var(--lb-ink)}
.lb-article-head h1{font-size:clamp(32px,4vw,48px);margin:0 0 18px}
.lb-article-head .lead{font-size:19px;color:var(--lb-muted);margin:0 0 24px;line-height:1.55}
.lb-article-meta{display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:14px;color:var(--lb-muted);padding:16px 0;border-top:1px solid var(--lb-border);border-bottom:1px solid var(--lb-border)}
.lb-article-meta address{font-style:normal;color:var(--lb-ink);font-weight:600}
.lb-article-meta time{font-variant-numeric:tabular-nums}
.lb-article-hero{max-width:1180px;margin:32px auto 0;padding:0 24px}
.lb-article-hero img{width:100%;border-radius:16px;aspect-ratio:16/8;object-fit:cover;border:1px solid var(--lb-border)}
.lb-article-body{max-width:780px;margin:48px auto 0;padding:0 24px;font-size:17px;line-height:1.75;color:#27272a}
.lb-article-body h2{font-size:30px;margin:44px 0 14px;color:var(--lb-ink)}
.lb-article-body h3{font-size:22px;margin:32px 0 10px;color:var(--lb-ink)}
.lb-article-body p{margin:0 0 18px}
.lb-article-body ul,.lb-article-body ol{margin:0 0 22px;padding-left:24px}
.lb-article-body li{margin-bottom:8px}
.lb-article-body a{color:var(--lb-accent);text-decoration:underline;text-underline-offset:3px}
.lb-article-body blockquote{margin:28px 0;padding:18px 22px;border-left:4px solid var(--lb-accent);background:var(--lb-warm);border-radius:0 12px 12px 0;font-style:italic;color:var(--lb-ink)}
.lb-article-body img{border-radius:12px;margin:24px 0}
.lb-article-body table{width:100%;border-collapse:collapse;margin:24px 0;font-size:15px;background:var(--lb-paper);border-radius:12px;overflow:hidden;border:1px solid var(--lb-border)}
.lb-article-body table th,.lb-article-body table td{padding:12px 16px;border-bottom:1px solid var(--lb-border);text-align:left}
.lb-article-body table th{font-weight:700;background:var(--lb-soft)}

.lb-article-cta{max-width:780px;margin:48px auto 0;padding:32px;background:var(--lb-warm);border-radius:16px;text-align:center;border:1px solid #fde68a}
.lb-article-cta h3{font-size:22px;margin:0 0 8px;color:#92400e}
.lb-article-cta p{color:#78350f;margin:0 0 20px}

.lb-article-related{max-width:1180px;margin:64px auto 0;padding:48px 24px 0;border-top:1px solid var(--lb-border)}
.lb-article-related h2{font-size:26px;margin-bottom:24px}
.lb-article-rel-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.lb-rel{display:block;padding:20px;background:var(--lb-paper);border:1px solid var(--lb-border);border-radius:12px;color:var(--lb-ink);text-decoration:none;transition:transform .2s,border-color .2s}
.lb-rel:hover{transform:translateY(-2px);border-color:var(--lb-accent);text-decoration:none;color:var(--lb-ink)}
.lb-rel time{font-size:12px;color:var(--lb-muted)}
.lb-rel h3{font-size:16px;margin:6px 0 0;line-height:1.4}
@media(max-width:880px){.lb-article-rel-grid{grid-template-columns:1fr;gap:14px}}
`;
}

// ---------------------------------------------------------------------------
// HOME PAGE
// ---------------------------------------------------------------------------

export interface LocalHomeOpts {
  chrome: SiteChrome;
  posts: PostInput[];
  content: LandingContent;
  generatedImages?: Record<string, string>;
  expertAuthor?: Author | null;
}

export function renderLocalHome(opts: LocalHomeOpts): string {
  const { chrome: c, posts, content: ct } = opts;
  const isRu = c.lang === "ru";
  const seed = siteSeed(c);
  const imgs = opts.generatedImages || {};
  const heroImg = imgs["hero"] || imgs["about"] || (posts[0]?.featuredImageUrl) ||
    `https://picsum.photos/seed/${encodeURIComponent(c.domain)}/1000/800`;
  const phoneRaw = (ct.phone || c.companyPhone || "").trim();
  const phoneClean = phoneRaw.replace(/[^+\d]/g, "");
  const region = (c as any).region || c.companyAddress || "";
  const workHours = c.workHours || (isRu ? "Пн-Вс с 9:00 до 21:00" : "Mon-Sun 9:00-21:00");
  const email = ct.email || c.companyEmail || "";

  const stats3 = (ct.stats || []).slice(0, 3);
  const services3 = (ct.services || []).slice(0, 3);
  const proc4 = (ct.process || []).slice(0, 4);
  const tests3 = (ct.testimonials || []).slice(0, 3);

  const processHtml = proc4.map((s) => `
    <div class="lb-proc-step">
      <h3>${escHtml(s.title)}</h3>
      <p>${escHtml(s.text)}</p>
    </div>`).join("");

  const servicesHtml = services3.map((s, i) => {
    const img = imgs[`service_${i + 1}`] || imgs["why"] || imgs["guarantee"] ||
      `https://picsum.photos/seed/${encodeURIComponent(c.domain + ":svc:" + i)}/800/500`;
    return `
    <div class="lb-svc">
      <div class="img"><img src="${escAttr(img)}" alt="${escAttr(uniqueImageAlt(c, s.title, i + 2))}" width="800" height="500" loading="lazy" decoding="async"></div>
      <div class="body">
        <h3>${escHtml(s.title)}</h3>
        <div class="price">${escHtml(s.price)}</div>
        <ul>${(s.bullets || []).slice(0, 4).map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>
        <a class="lb-svc-cta" href="#cta">${escHtml(isRu ? "Подробнее" : "Learn more")} →</a>
      </div>
    </div>`;
  }).join("");

  const reviewsHtml = tests3.map((t) => {
    const initials = (t.name || "?").split(/\s+/).map((p) => p[0] || "").join("").slice(0, 2).toUpperCase();
    return `
    <div class="lb-rev">
      <div class="stars" aria-label="5 stars">★★★★★</div>
      <blockquote>${escHtml(t.text)}</blockquote>
      <div class="who">
        <span class="av" aria-hidden="true">${escHtml(initials)}</span>
        <div class="who-meta">
          <strong>${escHtml(t.name)}</strong>
          ${t.role ? `<span>${escHtml(t.role)}</span>` : ""}
        </div>
      </div>
    </div>`;
  }).join("");

  // Service area list
  const areas = region
    ? region.split(/[,;]\s*/).filter(Boolean).slice(0, 6)
    : (isRu ? ["Центр", "Северный округ", "Южный округ", "Запад", "Восток"] : ["Downtown", "North", "South", "West", "East"]);
  const areasHtml = areas.map((a) => `<li>${escHtml(a)}</li>`).join("");

  // Blog cards
  const blogList = posts.slice(0, 6);
  const blogHtml = blogList.map((p) => {
    const d = fmtDate(p.publishedAt, isRu);
    const img = postImage(p, 800, 500);
    return `
    <a class="lb-bcard" href="/posts/${escAttr(p.slug)}.html">
      <div class="img"><img src="${escAttr(img)}" alt="${escAttr(uniqueImageAlt(c, p.title, 0))}" width="800" height="500" loading="lazy" decoding="async"></div>
      <div class="body">
        <div class="meta">${d.label || ""} · ${readingTime(p.contentHtml)} ${escHtml(isRu ? "мин" : "min")}</div>
        <h3>${escHtml(p.title)}</h3>
        <p>${escHtml(p.excerpt || "")}</p>
      </div>
    </a>`;
  }).join("") || `<div style="grid-column:1/-1;text-align:center;color:var(--lb-muted);padding:32px">${escHtml(isRu ? "Скоро здесь появятся новые материалы." : "Posts coming soon.")}</div>`;

  // JSON-LD with LocalBusiness
  const orgLd: any = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": c.siteName,
    "url": `https://${c.domain}/`,
    "logo": c.iconUrl || undefined,
    "description": c.siteAbout,
    "telephone": phoneRaw || undefined,
    "email": email || undefined,
    "address": region ? { "@type": "PostalAddress", "streetAddress": region } : undefined,
    "openingHours": workHours,
    "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.9", "reviewCount": String(20 + (hashStr(c.domain) % 80)) },
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
    title: `${c.siteName}${region ? ` — ${region}` : ""} | ${ct.heroBadge || c.topic}`,
    description: (ct.heroSubtitle || c.siteAbout || "").slice(0, 160),
    path: "/",
    type: "website",
    breadcrumbs: [{ label: isRu ? "Главная" : "Home", href: "/" }],
    jsonLd: [orgLd, blogLd as any],
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

  const callHref = phoneClean ? `tel:${escAttr(phoneClean)}` : "#cta";
  const writeHref = email ? `mailto:${escAttr(email)}` : "#cta";

  return `${head}
<body class="page-local page-home">
  <div class="lb-topbar">
    ${escHtml(isRu ? "Работаем сегодня" : "Open today")}: <strong>${escHtml(workHours)}</strong>${phoneRaw ? ` · <a href="${callHref}">${escHtml(phoneRaw)}</a>` : ""}
  </div>
  ${headerHtml(c)}
  <main id="main-content">

    <section class="lb-hero">
      <div class="lb-shell">
        <div class="lb-hero-grid">
          <div>
            <span class="lb-eyebrow">${escHtml(region || ct.heroBadge || c.topic)}</span>
            <h1>${escHtml(ct.heroTitle)}</h1>
            <p class="sub">${escHtml(ct.heroSubtitle)}</p>
            <div class="lb-hero-cta">
              ${phoneRaw ? `<a class="lb-btn lb-btn-call" href="${callHref}">📞 ${escHtml(phoneRaw)}</a>` : ""}
              <a class="lb-btn lb-btn-ghost" href="#services">${escHtml(ct.ctaSecondary || (isRu ? "Все услуги и цены" : "All services & prices"))}</a>
            </div>
            <div class="lb-hero-trust">
              <span>${escHtml(isRu ? "Без предоплаты" : "No prepayment")}</span>
              <span>${escHtml(isRu ? "Гарантия 12 мес." : "12-month warranty")}</span>
              <span>${escHtml(isRu ? "Выезд бесплатно" : "Free callout")}</span>
            </div>
          </div>
          <div class="lb-hero-art">
            <div class="ribbon">${escHtml(isRu ? "Местная компания" : "Local team")}</div>
            <img src="${escAttr(heroImg)}" alt="${escAttr(uniqueImageAlt(c, ct.heroTitle, 0))}" width="1000" height="800" loading="eager" decoding="async" fetchpriority="high">
          </div>
        </div>
      </div>
    </section>

    <section class="lb-info">
      <div class="lb-shell">
        <div class="lb-info-grid">
          ${phoneRaw ? `
          <div class="lb-info-card">
            <div class="ic">📞</div>
            <div><div class="lab">${escHtml(isRu ? "Позвоните" : "Call us")}</div><div class="val"><a href="${callHref}">${escHtml(phoneRaw)}</a></div></div>
          </div>` : ""}
          <div class="lb-info-card">
            <div class="ic">🕐</div>
            <div><div class="lab">${escHtml(isRu ? "Часы работы" : "Hours")}</div><div class="val">${escHtml(workHours)}</div></div>
          </div>
          ${region ? `
          <div class="lb-info-card">
            <div class="ic">📍</div>
            <div><div class="lab">${escHtml(isRu ? "Адрес" : "Address")}</div><div class="val">${escHtml(region)}</div></div>
          </div>` : ""}
          ${email ? `
          <div class="lb-info-card">
            <div class="ic">✉️</div>
            <div><div class="lab">${escHtml(isRu ? "Email" : "Email")}</div><div class="val"><a href="${writeHref}">${escHtml(email)}</a></div></div>
          </div>` : ""}
        </div>
      </div>
    </section>

    <section class="lb-services" id="services">
      <div class="lb-shell">
        <div class="lb-services-head">
          <span class="lb-eyebrow">${escHtml(isRu ? "Услуги" : "Services")}</span>
          <h2>${escHtml(isRu ? "Что мы делаем" : "What we do")}</h2>
          <p>${escHtml(isRu ? "Прозрачные цены, гарантия и опыт. Никаких скрытых доплат." : "Honest pricing, real warranty, hands-on experience.")}</p>
        </div>
        <div class="lb-svc-grid">${servicesHtml}</div>
      </div>
    </section>

    <section class="lb-map">
      <div class="lb-shell">
        <div class="lb-map-grid">
          <div>
            <span class="lb-eyebrow">${escHtml(isRu ? "Где работаем" : "Service area")}</span>
            <h2>${escHtml(isRu ? "Обслуживаем районы" : "We serve nearby areas")}</h2>
            <p>${escHtml(isRu ? "Приедем в течение часа в большинство районов. Не нашли свой? Позвоните - подскажем." : "We arrive within an hour in most neighborhoods. Not on the list? Call us.")}</p>
            <ul class="lb-map-list">${areasHtml}</ul>
            ${phoneRaw ? `<a class="lb-btn lb-btn-call" href="${callHref}">📞 ${escHtml(isRu ? "Вызвать мастера" : "Book a visit")}</a>` : `<a class="lb-btn" href="#cta">${escHtml(ct.ctaPrimary || (isRu ? "Связаться" : "Contact"))}</a>`}
          </div>
          <div class="lb-map-frame">
            <span class="pin-label">${escHtml(region || c.siteName)}</span>
            ${mapSvg(seed)}
          </div>
        </div>
      </div>
    </section>

    <section class="lb-process">
      <div class="lb-shell">
        <div class="lb-process-head">
          <span class="lb-eyebrow">${escHtml(isRu ? "Как это работает" : "How it works")}</span>
          <h2>${escHtml(isRu ? "От заявки до результата" : "From request to result")}</h2>
        </div>
        <div class="lb-proc-grid">${processHtml}</div>
      </div>
    </section>

    <section class="lb-reviews">
      <div class="lb-shell">
        <div class="lb-rev-head">
          <span class="lb-eyebrow">${escHtml(isRu ? "Отзывы" : "Reviews")}</span>
          <h2>${escHtml(isRu ? "Что говорят клиенты" : "What clients say")}</h2>
          <div class="lb-rev-rating"><span class="stars">★★★★★</span> 4.9 ${escHtml(isRu ? "из 5 · реальные отзывы" : "of 5 · verified reviews")}</div>
        </div>
        <div class="lb-rev-grid">${reviewsHtml}</div>
      </div>
    </section>

    <section class="lb-blog" id="blog">
      <div class="lb-shell">
        <div class="lb-blog-head">
          <div>
            <span class="lb-eyebrow">${escHtml(isRu ? "Полезное" : "Tips")}</span>
            <h2>${escHtml(ct.blogTitle || (isRu ? "Полезные материалы" : "Helpful articles"))}</h2>
          </div>
          <a class="lb-btn lb-btn-ghost" href="/blog/">${escHtml(isRu ? "Все статьи" : "All articles")} →</a>
        </div>
        <div class="lb-blog-grid">${blogHtml}</div>
      </div>
    </section>

    <section class="lb-cta" id="cta">
      <h2>${escHtml(ct.ctaSectionTitle)}</h2>
      <p>${escHtml(ct.ctaSectionText)}</p>
      ${phoneRaw ? `<a class="lb-btn" href="${callHref}">📞 ${escHtml(phoneRaw)}</a>` : `<a class="lb-btn" href="${writeHref}">${escHtml(ct.ctaPrimary || (isRu ? "Связаться" : "Get in touch"))}</a>`}
    </section>

  </main>

  ${(phoneRaw || email) ? `
  <div class="lb-mobile-bar" role="navigation" aria-label="${escAttr(isRu ? "Связаться" : "Contact")}">
    ${phoneRaw ? `<a class="call" href="${callHref}">📞 ${escHtml(isRu ? "Позвонить" : "Call")}</a>` : ""}
    ${email ? `<a class="write" href="${writeHref}">✉️ ${escHtml(isRu ? "Написать" : "Write")}</a>` : ""}
  </div>` : ""}

  ${footerHtml(c)}
  ${widgets}
  ${pixel}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// ARTICLE PAGE
// ---------------------------------------------------------------------------

export interface LocalArticleOpts {
  chrome: SiteChrome;
  post: PostInput;
  related: PostInput[];
  postIndex?: number;
}

export function renderLocalArticle(opts: LocalArticleOpts): string {
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
  const phoneRaw = (c.companyPhone || "").trim();
  const phoneClean = phoneRaw.replace(/[^+\d]/g, "");

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
      <a class="lb-rel" href="/posts/${escAttr(p.slug)}.html">
        ${d.label ? `<time datetime="${escAttr(d.dt)}">${escHtml(d.label)}</time>` : ""}
        <h3>${escHtml(p.title)}</h3>
      </a>`;
  }).join("");

  const crumbsHtml = breadcrumbs.map((b, i) =>
    i === breadcrumbs.length - 1
      ? `<span>${escHtml(b.label)}</span>`
      : `<a href="${escAttr(b.href)}">${escHtml(b.label)}</a> · `,
  ).join("");

  return `${head}
<body class="page-local page-article">
  ${headerHtml(c)}
  <main id="main-content">
    <article class="lb-article h-entry">
      <div class="lb-article-head">
        <nav class="crumbs" aria-label="breadcrumbs">${crumbsHtml}</nav>
        <h1 class="p-name">${escHtml(post.title)}</h1>
        ${post.excerpt ? `<p class="lead p-summary">${escHtml(post.excerpt)}</p>` : ""}
        <div class="lb-article-meta">
          ${author ? `<address class="p-author h-card">${escHtml(author.name)}</address>` : ""}
          ${dateMain.label ? `<time class="dt-published" datetime="${escAttr(dateMain.dt)}">${escHtml(dateMain.label)}</time>` : ""}
          <span>${minutes} ${escHtml(isRu ? "мин чтения" : "min read")}</span>
        </div>
      </div>

      <div class="lb-article-hero">
        <img src="${escAttr(heroUrl)}" alt="${escAttr(heroAlt)}" width="1600" height="800" loading="eager" decoding="async" fetchpriority="high">
      </div>

      <div class="lb-article-body article-body entry-content e-content prose">
        ${post.contentHtml || ""}
      </div>

      ${phoneRaw ? `
      <aside class="lb-article-cta">
        <h3>${escHtml(isRu ? "Нужна помощь специалиста?" : "Need help from a pro?")}</h3>
        <p>${escHtml(isRu ? "Позвоните - бесплатно проконсультируем по телефону." : "Call us — free phone consultation.")}</p>
        <a class="lb-btn lb-btn-call" href="tel:${escAttr(phoneClean)}">📞 ${escHtml(phoneRaw)}</a>
      </aside>` : ""}
    </article>

    ${related.length ? `
      <section class="lb-article-related" aria-labelledby="lb-rel-h">
        <h2 id="lb-rel-h">${escHtml(isRu ? "Ещё материалы" : "More articles")}</h2>
        <div class="lb-article-rel-grid">${relatedHtml}</div>
      </section>
    ` : ""}
  </main>

  ${phoneRaw ? `
  <div class="lb-mobile-bar" role="navigation" aria-label="${escAttr(isRu ? "Связаться" : "Contact")}">
    <a class="call" href="tel:${escAttr(phoneClean)}">📞 ${escHtml(isRu ? "Позвонить" : "Call")}</a>
  </div>` : ""}

  ${footerHtml(c)}
  ${widgets}
  ${pixel}
</body>
</html>`;
}
