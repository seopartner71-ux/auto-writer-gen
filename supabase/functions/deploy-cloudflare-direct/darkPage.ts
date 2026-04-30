// ============================================================================
// "Dark" template (Site Factory template №6).
//
// Concept: Premium SaaS / agency dark theme (Linear x Vercel x Stripe vibe).
// Deep black background (#0a0a0a), glassmorphism cards, neon accent glow,
// asymmetric hero with floating preview, marquee logo strip, gradient pricing
// cards. Intentionally distinct HTML skeleton so anti-fingerprint scanners
// cannot cluster it with other templates in the same PBN.
//
// All cross-cutting features are reused as-is:
//   - LandingContent text (generateLandingContent in landingPage.ts)
//   - FAL.ai photos (ensureLandingImages: hero, why, guarantee, about, team_*, post_*)
//   - Brand icon (ensureSiteIcon)
//   - SiteChrome head/header/footer/widgets/tracking pixel/cookie/widgets/totop
//   - phrasePools, antiFingerprint (CSS prefix .dk-*), backdating, smart
//     interlinking (works on rendered HTML), cost logging
//
// Only the home page and the article page are bespoke.
// CSS prefix: .dk-*  (gets obfuscated by antiFingerprint per-project seed).
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
    year: "numeric", month: "short", day: "numeric",
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

// Lighten/darken accent for gradient stops
function adjustHex(hex: string, amount: number): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  r = Math.max(0, Math.min(255, r + amount));
  g = Math.max(0, Math.min(255, g + amount));
  b = Math.max(0, Math.min(255, b + amount));
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Marquee logo SVGs — abstract monochrome, no real brand names.
// ---------------------------------------------------------------------------

function marqueeLogos(seed: string): string[] {
  const shapes = [
    `<svg viewBox="0 0 140 32" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="16" r="9" fill="none" stroke="currentColor" stroke-width="2"/><text x="32" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14" fill="currentColor">CIRCUIT</text></svg>`,
    `<svg viewBox="0 0 140 32" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="6" width="20" height="20" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><text x="32" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14" fill="currentColor">QUANTIX</text></svg>`,
    `<svg viewBox="0 0 140 32" xmlns="http://www.w3.org/2000/svg"><polygon points="14,4 26,26 2,26" fill="none" stroke="currentColor" stroke-width="2"/><text x="32" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14" fill="currentColor">VERTEX</text></svg>`,
    `<svg viewBox="0 0 140 32" xmlns="http://www.w3.org/2000/svg"><path d="M4 16 L14 6 L24 16 L14 26 Z" fill="none" stroke="currentColor" stroke-width="2"/><text x="32" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14" fill="currentColor">FLUX</text></svg>`,
    `<svg viewBox="0 0 140 32" xmlns="http://www.w3.org/2000/svg"><path d="M6 22 Q14 4 22 22" fill="none" stroke="currentColor" stroke-width="2"/><text x="32" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14" fill="currentColor">ARCWAVE</text></svg>`,
    `<svg viewBox="0 0 140 32" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="16" r="6" fill="currentColor"/><circle cx="22" cy="16" r="6" fill="none" stroke="currentColor" stroke-width="2"/><text x="34" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14" fill="currentColor">DUOLAB</text></svg>`,
    `<svg viewBox="0 0 140 32" xmlns="http://www.w3.org/2000/svg"><path d="M4 26 L10 6 L16 26 L22 6 L28 26" fill="none" stroke="currentColor" stroke-width="2"/><text x="36" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14" fill="currentColor">PEAK</text></svg>`,
    `<svg viewBox="0 0 140 32" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="8" height="20" fill="currentColor"/><rect x="16" y="14" width="8" height="12" fill="currentColor"/><text x="32" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14" fill="currentColor">STACKLY</text></svg>`,
    `<svg viewBox="0 0 140 32" xmlns="http://www.w3.org/2000/svg"><path d="M14 4 L26 16 L14 28 L2 16 Z" fill="currentColor"/><text x="32" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14" fill="currentColor">PRISM</text></svg>`,
    `<svg viewBox="0 0 140 32" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="16" r="4" fill="currentColor"/><circle cx="20" cy="16" r="4" fill="currentColor"/><circle cx="32" cy="16" r="4" fill="currentColor"/><text x="44" y="22" font-family="system-ui,sans-serif" font-weight="700" font-size="14" fill="currentColor">TRIO</text></svg>`,
  ];
  const start = hashStr(seed + ":dk-logos") % shapes.length;
  const out: string[] = [];
  for (let i = 0; i < 10; i++) out.push(shapes[(start + i) % shapes.length]);
  return out;
}

// ---------------------------------------------------------------------------
// CSS — prefixed .dk-*, fully self-contained.
// ---------------------------------------------------------------------------

export function darkExtraCss(c: SiteChrome): string {
  const accent = c.accent || "#7c3aed";
  const accentLight = adjustHex(accent, 30);
  const accentDeep = adjustHex(accent, -30);
  return `
/* ===== Dark template (Site Factory #6) ===== */
:root{
  --dk-bg:#0a0a0a;--dk-bg2:#111114;--dk-surface:#161619;--dk-surface2:#1c1c21;
  --dk-border:rgba(255,255,255,.08);--dk-border2:rgba(255,255,255,.14);
  --dk-ink:#f5f5f7;--dk-muted:#a1a1aa;--dk-dim:#71717a;
  --dk-accent:${accent};--dk-accent-light:${accentLight};--dk-accent-deep:${accentDeep};
  --dk-glow:${accent}33;
}
.page-dark{background:var(--dk-bg);color:var(--dk-ink);font-family:"${c.bodyFont}",system-ui,-apple-system,sans-serif;line-height:1.6;overflow-x:hidden}
.page-dark a{color:var(--dk-ink)}
.page-dark h1,.page-dark h2,.page-dark h3,.page-dark h4{font-family:"${c.headingFont}","${c.bodyFont}",sans-serif;color:var(--dk-ink);font-weight:700;letter-spacing:-0.02em;line-height:1.12}
.page-dark .container,.dk-shell{max-width:1200px;margin:0 auto;padding:0 24px}
.dk-narrow{max-width:780px;margin:0 auto;padding:0 24px}
.dk-eyebrow{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid var(--dk-border);font-size:12px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;color:var(--dk-muted);margin-bottom:20px}
.dk-eyebrow::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--dk-accent);box-shadow:0 0 12px var(--dk-accent)}
.dk-btn{display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border-radius:10px;background:var(--dk-ink);color:#0a0a0a;font-weight:600;font-size:14px;text-decoration:none;border:1px solid var(--dk-ink);transition:transform .2s,box-shadow .2s,background .2s}
.dk-btn:hover{transform:translateY(-1px);text-decoration:none;color:#0a0a0a;box-shadow:0 12px 30px -10px rgba(255,255,255,.25)}
.dk-btn-accent{background:linear-gradient(135deg,var(--dk-accent-light),var(--dk-accent));color:#fff;border:1px solid transparent;box-shadow:0 0 0 1px var(--dk-glow),0 18px 40px -12px var(--dk-glow)}
.dk-btn-accent:hover{color:#fff;box-shadow:0 0 0 1px var(--dk-accent),0 22px 50px -10px var(--dk-glow)}
.dk-btn-ghost{background:transparent;color:var(--dk-ink);border:1px solid var(--dk-border2)}
.dk-btn-ghost:hover{background:rgba(255,255,255,.05);color:var(--dk-ink);box-shadow:none;transform:none}

/* Background ambience — radial glow + grid pattern */
.dk-bg-fx{position:fixed;inset:0;pointer-events:none;z-index:0}
.dk-bg-fx::before{content:"";position:absolute;top:-200px;left:50%;transform:translateX(-50%);width:1100px;height:700px;background:radial-gradient(closest-side,var(--dk-glow),transparent 70%);filter:blur(60px);opacity:.7}
.dk-bg-fx::after{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:48px 48px;mask-image:radial-gradient(ellipse at top,#000 30%,transparent 70%)}
.page-dark > main, .page-dark > header, .page-dark > footer{position:relative;z-index:1}

/* Hero — asymmetric, floating preview */
.dk-hero{padding:120px 0 100px;position:relative}
.dk-hero-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:64px;align-items:center}
.dk-hero h1{font-size:clamp(40px,5.6vw,72px);margin:0 0 22px;background:linear-gradient(180deg,#fff 0%,#a1a1aa 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.dk-hero .sub{font-size:clamp(17px,1.6vw,20px);color:var(--dk-muted);margin:0 0 32px;max-width:560px}
.dk-hero .ctas{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:36px}
.dk-hero-meta{display:flex;flex-wrap:wrap;gap:20px;color:var(--dk-dim);font-size:13px}
.dk-hero-meta span{display:inline-flex;align-items:center;gap:6px}
.dk-hero-meta span::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--dk-accent);box-shadow:0 0 8px var(--dk-accent)}
.dk-hero-art{position:relative}
.dk-hero-art .frame{position:relative;border-radius:20px;overflow:hidden;border:1px solid var(--dk-border2);background:var(--dk-surface);box-shadow:0 40px 80px -20px rgba(0,0,0,.6),0 0 60px -20px var(--dk-glow);transform:rotate(-1.5deg)}
.dk-hero-art .frame::before{content:"";display:block;height:36px;background:var(--dk-surface2);border-bottom:1px solid var(--dk-border);background-image:radial-gradient(circle at 14px 18px,#ef4444 4px,transparent 4.5px),radial-gradient(circle at 32px 18px,#f59e0b 4px,transparent 4.5px),radial-gradient(circle at 50px 18px,#10b981 4px,transparent 4.5px)}
.dk-hero-art .frame img{display:block;width:100%;aspect-ratio:5/4;object-fit:cover;opacity:.95}
.dk-hero-art .badge-float{position:absolute;bottom:-22px;right:-12px;background:var(--dk-surface);border:1px solid var(--dk-border2);border-radius:14px;padding:14px 18px;display:flex;align-items:center;gap:12px;backdrop-filter:blur(12px);box-shadow:0 20px 40px -10px rgba(0,0,0,.5)}
.dk-hero-art .badge-float .num{font-family:"${c.headingFont}",sans-serif;font-size:24px;font-weight:800;color:var(--dk-accent-light)}
.dk-hero-art .badge-float .lbl{font-size:12px;color:var(--dk-muted);max-width:120px;line-height:1.3}
@media(max-width:880px){.dk-hero{padding:80px 0 64px}.dk-hero-grid{grid-template-columns:1fr;gap:48px}.dk-hero-art .frame{transform:none}.dk-hero-art .badge-float{right:0;bottom:-18px}}

/* Marquee logo strip */
.dk-marquee{padding:48px 0;border-top:1px solid var(--dk-border);border-bottom:1px solid var(--dk-border);background:rgba(255,255,255,.015);overflow:hidden}
.dk-marquee-label{text-align:center;font-size:13px;color:var(--dk-dim);letter-spacing:.08em;text-transform:uppercase;margin-bottom:20px}
.dk-marquee-track{display:flex;gap:64px;animation:dkMarquee 40s linear infinite;width:max-content}
.dk-marquee-track svg{width:140px;height:32px;color:var(--dk-muted);opacity:.7;flex-shrink:0;transition:opacity .2s,color .2s}
.dk-marquee-track svg:hover{opacity:1;color:var(--dk-ink)}
@keyframes dkMarquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media(prefers-reduced-motion:reduce){.dk-marquee-track{animation:none;flex-wrap:wrap;justify-content:center;gap:32px}}

/* Stats — glass cards with accent number */
.dk-stats{padding:96px 0}
.dk-stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.dk-stat{padding:36px 28px;border:1px solid var(--dk-border);border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.02),rgba(255,255,255,0));backdrop-filter:blur(8px);position:relative;overflow:hidden}
.dk-stat::after{content:"";position:absolute;top:-50%;right:-30%;width:200px;height:200px;background:radial-gradient(circle,var(--dk-glow),transparent 70%);opacity:.4;filter:blur(30px)}
.dk-stat .num{font-family:"${c.headingFont}",sans-serif;font-size:clamp(44px,5vw,72px);font-weight:800;background:linear-gradient(135deg,var(--dk-accent-light),var(--dk-accent));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;line-height:1;letter-spacing:-0.04em;position:relative}
.dk-stat .ttl{margin-top:14px;font-size:17px;font-weight:600;color:var(--dk-ink);position:relative}
.dk-stat .txt{margin-top:6px;font-size:14px;color:var(--dk-muted);max-width:280px;position:relative}
@media(max-width:760px){.dk-stats-grid{grid-template-columns:1fr;gap:16px}}

/* Process — vertical timeline with glowing dots */
.dk-process{padding:96px 0;border-top:1px solid var(--dk-border)}
.dk-process-head{text-align:center;margin-bottom:64px}
.dk-process-head h2{font-size:clamp(32px,3.5vw,48px);margin-bottom:14px}
.dk-process-head p{color:var(--dk-muted);max-width:580px;margin:0 auto;font-size:17px}
.dk-process-list{max-width:820px;margin:0 auto;position:relative;padding-left:32px;border-left:1px dashed var(--dk-border2)}
.dk-process-step{position:relative;padding:0 0 48px 24px}
.dk-process-step:last-child{padding-bottom:0}
.dk-process-step::before{content:"";position:absolute;left:-41px;top:4px;width:18px;height:18px;border-radius:50%;background:var(--dk-bg);border:2px solid var(--dk-accent);box-shadow:0 0 0 4px var(--dk-bg),0 0 16px var(--dk-glow)}
.dk-process-step .step-num{font-family:"${c.headingFont}",sans-serif;font-size:13px;font-weight:600;color:var(--dk-accent-light);letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px}
.dk-process-step h3{font-size:22px;margin:0 0 10px}
.dk-process-step p{color:var(--dk-muted);font-size:16px;margin:0}

/* Services — gradient pricing cards */
.dk-services{padding:96px 0;border-top:1px solid var(--dk-border)}
.dk-services-head{text-align:center;margin-bottom:64px}
.dk-services-head h2{font-size:clamp(32px,3.5vw,48px);margin-bottom:14px}
.dk-services-head p{color:var(--dk-muted);max-width:580px;margin:0 auto}
.dk-svc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.dk-svc{position:relative;padding:36px 28px 32px;border:1px solid var(--dk-border);border-radius:20px;background:var(--dk-surface);display:flex;flex-direction:column;transition:transform .25s,border-color .25s}
.dk-svc:hover{transform:translateY(-4px);border-color:var(--dk-border2)}
.dk-svc.dk-svc-featured{border-color:transparent;background:linear-gradient(180deg,rgba(124,58,237,.12),var(--dk-surface)) padding-box,linear-gradient(135deg,var(--dk-accent-light),var(--dk-accent-deep)) border-box;border:1px solid transparent}
.dk-svc.dk-svc-featured::before{content:"Популярный";position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,var(--dk-accent-light),var(--dk-accent));color:#fff;font-size:11px;font-weight:600;padding:4px 12px;border-radius:999px;letter-spacing:.05em;text-transform:uppercase;box-shadow:0 8px 20px -6px var(--dk-glow)}
.dk-svc h3{font-size:22px;margin-bottom:6px}
.dk-svc .price{font-family:"${c.headingFont}",sans-serif;font-size:32px;font-weight:800;margin:14px 0 22px;color:var(--dk-ink);line-height:1}
.dk-svc.dk-svc-featured .price{background:linear-gradient(135deg,var(--dk-accent-light),var(--dk-accent));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.dk-svc ul{list-style:none;padding:0;margin:0 0 28px;flex:1}
.dk-svc li{padding:10px 0;font-size:14px;color:var(--dk-muted);border-top:1px solid var(--dk-border);position:relative;padding-left:24px}
.dk-svc li:first-child{border-top:none}
.dk-svc li::before{content:"";position:absolute;left:0;top:14px;width:14px;height:14px;border-radius:50%;background:var(--dk-glow);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'%3E%3Cpath d='M3.5 7l2.5 2.5L10.5 5' stroke='%23fff' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-position:center;background-repeat:no-repeat}
.dk-svc-cta{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:11px 18px;border-radius:10px;background:rgba(255,255,255,.06);color:var(--dk-ink);font-weight:600;font-size:14px;text-decoration:none;border:1px solid var(--dk-border2);transition:background .2s}
.dk-svc-cta:hover{background:rgba(255,255,255,.12);color:var(--dk-ink);text-decoration:none}
.dk-svc.dk-svc-featured .dk-svc-cta{background:linear-gradient(135deg,var(--dk-accent-light),var(--dk-accent));color:#fff;border-color:transparent}
@media(max-width:880px){.dk-svc-grid{grid-template-columns:1fr;gap:18px}}

/* Testimonials — bento with portraits */
.dk-testimonials{padding:96px 0;border-top:1px solid var(--dk-border)}
.dk-test-head{text-align:center;margin-bottom:56px}
.dk-test-head h2{font-size:clamp(32px,3.5vw,48px)}
.dk-quotes{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.dk-quote{padding:28px;border:1px solid var(--dk-border);border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,0));backdrop-filter:blur(6px)}
.dk-quote .stars{color:var(--dk-accent-light);font-size:14px;letter-spacing:2px;margin-bottom:14px}
.dk-quote blockquote{font-size:16px;color:var(--dk-ink);margin:0 0 22px;padding:0;border:none;line-height:1.55}
.dk-quote .who{display:flex;align-items:center;gap:12px;padding-top:18px;border-top:1px solid var(--dk-border)}
.dk-quote .av{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--dk-accent-light),var(--dk-accent));color:#fff;font-weight:700;display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
.dk-quote .who-meta strong{display:block;color:var(--dk-ink);font-size:14px;font-weight:600}
.dk-quote .who-meta span{display:block;color:var(--dk-dim);font-size:12px;margin-top:2px}
@media(max-width:880px){.dk-quotes{grid-template-columns:1fr;gap:16px}}

/* Blog — image cards with hover lift */
.dk-blog{padding:96px 0;border-top:1px solid var(--dk-border)}
.dk-blog-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:48px;gap:24px;flex-wrap:wrap}
.dk-blog-head h2{font-size:clamp(32px,3.5vw,48px)}
.dk-blog-head p{color:var(--dk-muted);margin-top:8px}
.dk-blog-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.dk-bcard{display:block;border:1px solid var(--dk-border);border-radius:18px;overflow:hidden;background:var(--dk-surface);text-decoration:none;color:var(--dk-ink);transition:transform .25s,border-color .25s,box-shadow .25s}
.dk-bcard:hover{transform:translateY(-4px);border-color:var(--dk-border2);text-decoration:none;color:var(--dk-ink);box-shadow:0 24px 48px -12px rgba(0,0,0,.5)}
.dk-bcard .img{aspect-ratio:16/10;overflow:hidden;background:var(--dk-bg2)}
.dk-bcard .img img{width:100%;height:100%;object-fit:cover;transition:transform .4s}
.dk-bcard:hover .img img{transform:scale(1.05)}
.dk-bcard .body{padding:22px}
.dk-bcard .meta{display:flex;gap:12px;font-size:12px;color:var(--dk-dim);margin-bottom:10px;font-variant-numeric:tabular-nums}
.dk-bcard h3{font-size:18px;margin:0 0 8px;line-height:1.35}
.dk-bcard p{font-size:14px;color:var(--dk-muted);margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
@media(max-width:880px){.dk-blog-grid{grid-template-columns:1fr;gap:18px}}

/* About — split with stats inline */
.dk-about{padding:96px 0;border-top:1px solid var(--dk-border)}
.dk-about-grid{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center}
.dk-about-grid img{width:100%;border-radius:18px;aspect-ratio:4/3;object-fit:cover;border:1px solid var(--dk-border2)}
.dk-about-grid h2{font-size:clamp(32px,3.5vw,48px);margin-bottom:18px}
.dk-about-grid p{color:var(--dk-muted);font-size:17px;margin-bottom:24px;line-height:1.65}
.dk-about-mini{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:28px}
.dk-about-mini > div{padding:14px 0;border-top:1px solid var(--dk-border)}
.dk-about-mini .n{font-family:"${c.headingFont}",sans-serif;font-size:24px;font-weight:800;color:var(--dk-accent-light);line-height:1}
.dk-about-mini .l{font-size:12px;color:var(--dk-muted);margin-top:6px}
@media(max-width:880px){.dk-about-grid{grid-template-columns:1fr;gap:32px}}

/* CTA — gradient panel */
.dk-cta-section{padding:96px 0}
.dk-cta-card{position:relative;border-radius:28px;padding:72px 48px;text-align:center;background:linear-gradient(135deg,var(--dk-accent-deep),var(--dk-accent),var(--dk-accent-light));overflow:hidden;border:1px solid var(--dk-border2)}
.dk-cta-card::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.1) 1px,transparent 1px);background-size:32px 32px;opacity:.2;mask-image:radial-gradient(ellipse at center,#000 30%,transparent 70%)}
.dk-cta-card > *{position:relative}
.dk-cta-card h2{color:#fff;font-size:clamp(32px,4vw,52px);margin-bottom:18px;letter-spacing:-0.025em}
.dk-cta-card p{color:rgba(255,255,255,.85);max-width:600px;margin:0 auto 32px;font-size:17px}
.dk-cta-card .dk-btn{background:#fff;color:#0a0a0a;border-color:#fff}
.dk-cta-card .dk-btn:hover{background:#f5f5f7;color:#0a0a0a;box-shadow:0 16px 32px -8px rgba(0,0,0,.3)}

/* Article page */
.dk-article{padding:80px 0 96px;position:relative}
.dk-article-head{max-width:820px;margin:0 auto;padding:0 24px;text-align:center}
.dk-article-head .crumbs{font-size:13px;color:var(--dk-dim);margin-bottom:28px}
.dk-article-head .crumbs a{color:var(--dk-muted);text-decoration:none}
.dk-article-head .crumbs a:hover{color:var(--dk-ink)}
.dk-article-head h1{font-size:clamp(34px,4.5vw,56px);margin:0 0 22px;letter-spacing:-0.025em;background:linear-gradient(180deg,#fff 0%,#a1a1aa 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.dk-article-head .lead{font-size:20px;color:var(--dk-muted);margin:0 auto 36px;max-width:680px;line-height:1.55}
.dk-article-meta{display:inline-flex;align-items:center;gap:18px;flex-wrap:wrap;font-size:14px;color:var(--dk-muted);padding:18px 28px;border-radius:999px;background:var(--dk-surface);border:1px solid var(--dk-border)}
.dk-article-meta address{font-style:normal;color:var(--dk-ink);font-weight:600;display:inline-flex;align-items:center;gap:8px}
.dk-article-meta address::before{content:"";display:inline-block;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,var(--dk-accent-light),var(--dk-accent))}
.dk-article-meta time{font-variant-numeric:tabular-nums}
.dk-article-meta .dot{width:4px;height:4px;border-radius:50%;background:var(--dk-border2)}
.dk-article-hero{max-width:1120px;margin:48px auto 0;padding:0 24px}
.dk-article-hero img{width:100%;border-radius:20px;aspect-ratio:16/8;object-fit:cover;border:1px solid var(--dk-border2);box-shadow:0 40px 80px -20px rgba(0,0,0,.6)}
.dk-article-body{max-width:780px;margin:56px auto 0;padding:0 24px;font-size:18px;line-height:1.78;color:#d4d4d8}
.dk-article-body h2{font-size:32px;margin:52px 0 18px;color:var(--dk-ink);letter-spacing:-0.02em}
.dk-article-body h3{font-size:24px;margin:40px 0 14px;color:var(--dk-ink)}
.dk-article-body p{margin:0 0 22px}
.dk-article-body ul,.dk-article-body ol{margin:0 0 26px;padding-left:24px}
.dk-article-body li{margin-bottom:10px}
.dk-article-body a{color:var(--dk-accent-light);text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
.dk-article-body a:hover{color:#fff}
.dk-article-body strong{color:var(--dk-ink)}
.dk-article-body blockquote{margin:36px 0;padding:20px 28px;border-left:3px solid var(--dk-accent);background:var(--dk-surface);border-radius:0 14px 14px 0;font-style:italic;color:var(--dk-ink);font-size:19px}
.dk-article-body img{border-radius:14px;margin:28px 0;border:1px solid var(--dk-border2)}
.dk-article-body table{width:100%;border-collapse:separate;border-spacing:0;margin:28px 0;font-size:15px;background:var(--dk-surface);border-radius:14px;overflow:hidden;border:1px solid var(--dk-border)}
.dk-article-body table th,.dk-article-body table td{padding:14px 18px;border-bottom:1px solid var(--dk-border);text-align:left;color:var(--dk-ink)}
.dk-article-body table th{font-weight:600;background:var(--dk-surface2);color:var(--dk-ink)}
.dk-article-body table tr:last-child td{border-bottom:none}
.dk-article-body code{background:var(--dk-surface);padding:2px 7px;border-radius:6px;font-size:.9em;color:var(--dk-accent-light);border:1px solid var(--dk-border)}
.dk-article-body pre{background:var(--dk-surface);padding:20px;border-radius:14px;overflow-x:auto;border:1px solid var(--dk-border);margin:24px 0}
.dk-article-body pre code{background:none;padding:0;border:none;color:var(--dk-ink)}

.dk-article-related{max-width:1200px;margin:96px auto 0;padding:64px 24px 0;border-top:1px solid var(--dk-border)}
.dk-article-related h2{font-size:32px;margin-bottom:32px;text-align:center}
.dk-article-rel-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.dk-rel{display:block;padding:24px;border:1px solid var(--dk-border);border-radius:16px;background:var(--dk-surface);color:var(--dk-ink);text-decoration:none;transition:transform .2s,border-color .2s}
.dk-rel:hover{transform:translateY(-3px);border-color:var(--dk-border2);text-decoration:none;color:var(--dk-ink)}
.dk-rel time{font-size:12px;color:var(--dk-dim)}
.dk-rel h3{font-size:17px;margin:8px 0 0;line-height:1.4}
@media(max-width:880px){.dk-article-rel-grid{grid-template-columns:1fr;gap:16px}}
`;
}

// ---------------------------------------------------------------------------
// HOME PAGE
// ---------------------------------------------------------------------------

export interface DarkHomeOpts {
  chrome: SiteChrome;
  posts: PostInput[];
  content: LandingContent;
  generatedImages?: Record<string, string>;
  expertAuthor?: Author | null;
}

export function renderDarkHome(opts: DarkHomeOpts): string {
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

  const heroMeta = [
    isRu ? "Без долгих согласований" : "No long onboarding",
    isRu ? "Старт в течение недели" : "Start within a week",
    isRu ? "Гарантия результата" : "Results guaranteed",
  ];

  const processHtml = proc4.map((s, i) => `
    <div class="dk-process-step">
      <div class="step-num">${isRu ? "Шаг" : "Step"} ${String(i + 1).padStart(2, "0")}</div>
      <h3>${escHtml(s.title)}</h3>
      <p>${escHtml(s.text)}</p>
    </div>`).join("");

  const statsHtml = stats3.map((s) => `
    <div class="dk-stat">
      <div class="num">${escHtml(s.value)}</div>
      <div class="ttl">${escHtml(s.label)}</div>
    </div>`).join("");

  const servicesHtml = services3.map((s, i) => {
    const featured = i === 1 ? " dk-svc-featured" : "";
    return `
    <div class="dk-svc${featured}">
      <h3>${escHtml(s.title)}</h3>
      <div class="price">${escHtml(s.price)}</div>
      <ul>${(s.bullets || []).slice(0, 5).map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>
      <a class="dk-svc-cta" href="#cta">${escHtml(isRu ? "Заказать" : "Get started")} →</a>
    </div>`;
  }).join("");

  const stars = "★★★★★";
  const quotesHtml = tests3.map((t) => {
    const initials = (t.name || "?").split(/\s+/).map((p) => p[0] || "").join("").slice(0, 2).toUpperCase();
    return `
    <div class="dk-quote">
      <div class="stars" aria-label="5 stars">${stars}</div>
      <blockquote>&ldquo;${escHtml(t.text)}&rdquo;</blockquote>
      <div class="who">
        <span class="av" aria-hidden="true">${escHtml(initials)}</span>
        <div class="who-meta">
          <strong>${escHtml(t.name)}</strong>
          ${t.role ? `<span>${escHtml(t.role)}</span>` : ""}
        </div>
      </div>
    </div>`;
  }).join("");

  const logos = marqueeLogos(seed);
  // Duplicate for seamless marquee loop
  const marqueeHtml = [...logos, ...logos].map((svg) => `<div>${svg}</div>`).join("");

  // Blog cards
  const blogList = posts.slice(0, 6);
  const blogHtml = blogList.map((p) => {
    const d = fmtDate(p.publishedAt, isRu);
    const img = postImage(p, 800, 500);
    return `
    <a class="dk-bcard" href="/posts/${escAttr(p.slug)}.html">
      <div class="img"><img src="${escAttr(img)}" alt="${escAttr(uniqueImageAlt(c, p.title, 0))}" width="800" height="500" loading="lazy" decoding="async"></div>
      <div class="body">
        <div class="meta">
          ${d.label ? `<span>${escHtml(d.label)}</span>` : ""}
          <span>${readingTime(p.contentHtml)} ${escHtml(isRu ? "мин" : "min")}</span>
        </div>
        <h3>${escHtml(p.title)}</h3>
        <p>${escHtml(p.excerpt || "")}</p>
      </div>
    </a>`;
  }).join("") || `<div style="grid-column:1/-1;text-align:center;color:var(--dk-muted);padding:32px">${escHtml(isRu ? "Скоро здесь появятся новые материалы." : "Posts coming soon.")}</div>`;

  const trustLabel = isRu ? "Нам доверяют команды по всему миру" : "Trusted by teams worldwide";

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
    totopPosition: c.totopPosition || "right-bottom",
    seed,
  });

  const heroBadgeStat = stats3[0];

  return `${head}
<body class="page-dark page-home">
  <div class="dk-bg-fx" aria-hidden="true"></div>
  ${headerHtml(c)}
  <main id="main-content">

    <section class="dk-hero">
      <div class="dk-shell">
        <div class="dk-hero-grid">
          <div>
            <span class="dk-eyebrow">${escHtml(ct.heroBadge || c.topic)}</span>
            <h1>${escHtml(ct.heroTitle)}</h1>
            <p class="sub">${escHtml(ct.heroSubtitle)}</p>
            <div class="ctas">
              <a class="dk-btn dk-btn-accent" href="#cta">${escHtml(ct.ctaPrimary || (isRu ? "Начать" : "Get started"))} →</a>
              <a class="dk-btn dk-btn-ghost" href="#services">${escHtml(ct.ctaSecondary || (isRu ? "Узнать больше" : "Learn more"))}</a>
            </div>
            <div class="dk-hero-meta">
              ${heroMeta.map((m) => `<span>${escHtml(m)}</span>`).join("")}
            </div>
          </div>
          <div class="dk-hero-art">
            <div class="frame">
              <img src="${escAttr(heroImg)}" alt="${escAttr(uniqueImageAlt(c, ct.heroTitle, 0))}" width="1000" height="800" loading="eager" decoding="async" fetchpriority="high">
            </div>
            ${heroBadgeStat ? `
            <div class="badge-float">
              <div class="num">${escHtml(heroBadgeStat.value)}</div>
              <div class="lbl">${escHtml(heroBadgeStat.label)}</div>
            </div>` : ""}
          </div>
        </div>
      </div>
    </section>

    <section class="dk-marquee" aria-label="${escAttr(trustLabel)}">
      <div class="dk-marquee-label">${escHtml(trustLabel)}</div>
      <div class="dk-marquee-track" aria-hidden="true">${marqueeHtml}</div>
    </section>

    <section class="dk-stats">
      <div class="dk-shell">
        <div class="dk-stats-grid">${statsHtml}</div>
      </div>
    </section>

    <section class="dk-process" id="process">
      <div class="dk-shell">
        <div class="dk-process-head">
          <span class="dk-eyebrow">${escHtml(isRu ? "Процесс" : "Process")}</span>
          <h2>${escHtml(isRu ? "Как мы работаем" : "How we work")}</h2>
          <p>${escHtml(pickPhrase("ctaSectionText", c.lang, seed))}</p>
        </div>
        <div class="dk-process-list">${processHtml}</div>
      </div>
    </section>

    <section class="dk-services" id="services">
      <div class="dk-shell">
        <div class="dk-services-head">
          <span class="dk-eyebrow">${escHtml(isRu ? "Тарифы" : "Pricing")}</span>
          <h2>${escHtml(isRu ? "Выберите свой тариф" : "Pick your plan")}</h2>
          <p>${escHtml(isRu ? "Простые понятные пакеты. Без скрытых платежей." : "Transparent packages. No hidden fees.")}</p>
        </div>
        <div class="dk-svc-grid">${servicesHtml}</div>
      </div>
    </section>

    <section class="dk-testimonials">
      <div class="dk-shell">
        <div class="dk-test-head">
          <span class="dk-eyebrow">${escHtml(isRu ? "Отзывы" : "Testimonials")}</span>
          <h2>${escHtml(isRu ? "Что говорят клиенты" : "What clients say")}</h2>
        </div>
        <div class="dk-quotes">${quotesHtml}</div>
      </div>
    </section>

    <section class="dk-blog" id="blog">
      <div class="dk-shell">
        <div class="dk-blog-head">
          <div>
            <span class="dk-eyebrow">${escHtml(isRu ? "Блог" : "Blog")}</span>
            <h2>${escHtml(ct.blogTitle || (isRu ? "Свежие материалы" : "Latest writing"))}</h2>
          </div>
          <a class="dk-btn dk-btn-ghost" href="/blog/">${escHtml(isRu ? "Все статьи" : "All posts")} →</a>
        </div>
        <div class="dk-blog-grid">${blogHtml}</div>
      </div>
    </section>

    <section class="dk-about" id="about">
      <div class="dk-shell">
        <div class="dk-about-grid">
          <div>
            <span class="dk-eyebrow">${escHtml(isRu ? "О нас" : "About")}</span>
            <h2>${escHtml(ct.aboutShortTitle)}</h2>
            <p>${escHtml(ct.aboutShortText)}</p>
            <a class="dk-btn dk-btn-ghost" href="/about.html">${escHtml(isRu ? "Подробнее о компании" : "More about us")} →</a>
            <div class="dk-about-mini">
              ${stats3.slice(0, 3).map((s) => `
                <div><div class="n">${escHtml(s.value)}</div><div class="l">${escHtml(s.label)}</div></div>`).join("")}
            </div>
          </div>
          <img src="${escAttr(aboutImg)}" alt="${escAttr(uniqueImageAlt(c, ct.aboutShortTitle, 1))}" width="1000" height="750" loading="lazy" decoding="async">
        </div>
      </div>
    </section>

    <section class="dk-cta-section" id="cta">
      <div class="dk-shell">
        <div class="dk-cta-card">
          <h2>${escHtml(ct.ctaSectionTitle)}</h2>
          <p>${escHtml(ct.ctaSectionText)}</p>
          <a class="dk-btn" href="tel:${escAttr((ct.phone || "").replace(/[^+\d]/g, ""))}">${escHtml(ct.ctaPrimary || (isRu ? "Связаться" : "Get in touch"))} →</a>
        </div>
      </div>
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

export interface DarkArticleOpts {
  chrome: SiteChrome;
  post: PostInput;
  related: PostInput[];
  postIndex?: number;
}

export function renderDarkArticle(opts: DarkArticleOpts): string {
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
    totopPosition: c.totopPosition || "right-bottom",
    seed,
  });

  const relatedHtml = related.slice(0, 3).map((p) => {
    const d = fmtDate(p.publishedAt, isRu);
    return `
      <a class="dk-rel" href="/posts/${escAttr(p.slug)}.html">
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
<body class="page-dark page-article">
  <div class="dk-bg-fx" aria-hidden="true"></div>
  ${headerHtml(c)}
  <main id="main-content">
    <article class="dk-article h-entry">
      <div class="dk-article-head">
        <nav class="crumbs" aria-label="breadcrumbs">${crumbsHtml}</nav>
        <h1 class="p-name">${escHtml(post.title)}</h1>
        ${post.excerpt ? `<p class="lead p-summary">${escHtml(post.excerpt)}</p>` : ""}
        <div class="dk-article-meta">
          ${author ? `<address class="p-author h-card">${escHtml(author.name)}</address>` : ""}
          ${author && dateMain.label ? `<span class="dot" aria-hidden="true"></span>` : ""}
          ${dateMain.label ? `<time class="dt-published" datetime="${escAttr(dateMain.dt)}">${escHtml(dateMain.label)}</time>` : ""}
          <span class="dot" aria-hidden="true"></span>
          <span>${minutes} ${escHtml(isRu ? "мин чтения" : "min read")}</span>
        </div>
      </div>

      <div class="dk-article-hero">
        <img src="${escAttr(heroUrl)}" alt="${escAttr(heroAlt)}" width="1600" height="800" loading="eager" decoding="async" fetchpriority="high">
      </div>

      <div class="dk-article-body article-body entry-content e-content prose">
        ${post.contentHtml || ""}
      </div>
    </article>

    ${related.length ? `
      <section class="dk-article-related" aria-labelledby="dk-rel-h">
        <h2 id="dk-rel-h">${escHtml(isRu ? "Ещё материалы" : "More stories")}</h2>
        <div class="dk-article-rel-grid">${relatedHtml}</div>
      </section>
    ` : ""}
  </main>
  ${footerHtml(c)}
  ${widgets}
  ${pixel}
</body>
</html>`;
}
