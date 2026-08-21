// ============================================================================
// P18 - VISUAL RENDERER / SITE DESIGN SYSTEM
//
// One design system for the WHOLE site: global tokens -> UI kit -> components
// -> page templates -> all pages. Internal pages use exactly the same kit as
// the homepage. Pure + deterministic: no DB, no LLM, no network.
// ============================================================================

import type { DesignProfile, VisualStyle } from "../visualTemplates.ts";

export interface DesignTokens {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  headingFont: string;
  bodyFont: string;
  radius: string;
  radiusLg: string;
  buttonRadius: string;
  shadow: string;
  shadowLg: string;
  maxWidth: string;
  baseSize: string;
  h1: string;
  h2: string;
  h3: string;
  section: string;
}

const SCALE: Record<string, { base: string; h1: string; h2: string; h3: string; section: string }> = {
  compact: { base: "15px", h1: "clamp(26px,3.6vw,40px)", h2: "clamp(21px,2.4vw,28px)", h3: "18px", section: "clamp(36px,5vw,56px)" },
  normal: { base: "16px", h1: "clamp(28px,4.2vw,46px)", h2: "clamp(22px,2.8vw,32px)", h3: "19px", section: "clamp(44px,6vw,72px)" },
  large: { base: "17px", h1: "clamp(32px,5vw,54px)", h2: "clamp(24px,3.2vw,36px)", h3: "20px", section: "clamp(52px,7vw,88px)" },
};

const STYLE_SHAPE: Record<VisualStyle, { radius: number; button: number; shadow: string; shadowLg: string }> = {
  industrial: { radius: 6, button: 4, shadow: "0 1px 2px rgba(15,23,42,.08)", shadowLg: "0 10px 30px rgba(15,23,42,.10)" },
  minimal: { radius: 12, button: 10, shadow: "0 1px 2px rgba(15,23,42,.05)", shadowLg: "0 12px 40px rgba(15,23,42,.08)" },
  corporate: { radius: 10, button: 8, shadow: "0 2px 6px rgba(15,23,42,.07)", shadowLg: "0 14px 40px rgba(15,23,42,.10)" },
  bold: { radius: 16, button: 999, shadow: "0 2px 8px rgba(15,23,42,.08)", shadowLg: "0 18px 50px rgba(15,23,42,.14)" },
  warm: { radius: 14, button: 12, shadow: "0 2px 8px rgba(69,26,3,.07)", shadowLg: "0 16px 44px rgba(69,26,3,.12)" },
};

const WIDTH: Record<string, string> = { wide: "1320px", boxed: "1160px", split: "1240px" };

export function buildTokens(profile: DesignProfile): DesignTokens {
  const c = profile.color_scheme;
  const shape = STYLE_SHAPE[profile.style] || STYLE_SHAPE.minimal;
  const scale = SCALE[profile.typography?.scale || "normal"] || SCALE.normal;
  return {
    primary: c.primary, accent: c.accent, background: c.background, surface: c.surface,
    text: c.text, muted: c.muted, border: mix(c.muted, 0.22),
    headingFont: profile.typography.heading_font,
    bodyFont: profile.typography.body_font,
    radius: `${shape.radius}px`,
    radiusLg: `${shape.radius * 1.6}px`,
    buttonRadius: `${shape.button}px`,
    shadow: shape.shadow, shadowLg: shape.shadowLg,
    maxWidth: WIDTH[profile.layout_type] || WIDTH.wide,
    baseSize: scale.base, h1: scale.h1, h2: scale.h2, h3: scale.h3, section: scale.section,
  };
}

/** hex -> rgba string with alpha (used for borders / soft surfaces). */
export function mix(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return `rgba(100,116,139,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function googleFonts(tokens: DesignTokens): string {
  const fams = [...new Set([tokens.headingFont, tokens.bodyFont])]
    .map((f) => `family=${f.replace(/\s+/g, "+")}:wght@400;500;600;700`).join("&");
  return `https://fonts.googleapis.com/css2?${fams}&display=swap`;
}

/**
 * Global stylesheet. Identical on every page of the site - this is what keeps
 * the homepage and the internal pages one single product.
 */
export function designSystemCss(tk: DesignTokens): string {
  return `
:root{
  --c-primary:${tk.primary};--c-accent:${tk.accent};--c-bg:${tk.background};--c-surface:${tk.surface};
  --c-text:${tk.text};--c-muted:${tk.muted};--c-border:${tk.border};
  --f-head:'${tk.headingFont}',system-ui,sans-serif;--f-body:'${tk.bodyFont}',system-ui,sans-serif;
  --r:${tk.radius};--r-lg:${tk.radiusLg};--r-btn:${tk.buttonRadius};
  --sh:${tk.shadow};--sh-lg:${tk.shadowLg};--w:${tk.maxWidth};--sec:${tk.section};
  --primary-soft:${mix(tk.primary, 0.08)};--accent-soft:${mix(tk.accent, 0.12)};
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--c-bg);color:var(--c-text);font-family:var(--f-body);font-size:${tk.baseSize};line-height:1.65}
img{max-width:100%;height:auto;display:block}
a{color:var(--c-primary);text-decoration:none}
a:hover{text-decoration:underline}
h1,h2,h3,h4{font-family:var(--f-head);line-height:1.2;margin:0 0 .5em;font-weight:700;letter-spacing:-.01em}
h1{font-size:${tk.h1}}h2{font-size:${tk.h2}}h3{font-size:${tk.h3}}
p{margin:0 0 1em}
.wrap{width:100%;max-width:var(--w);margin:0 auto;padding:0 20px}
.section{padding:calc(var(--sec)/2) 0}
.section--alt{background:var(--c-surface)}
.eyebrow{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--c-accent);font-weight:600;margin:0 0 10px}
.lead{font-size:1.08em;color:var(--c-muted)}
.grid{display:grid;gap:20px}
.grid-2{grid-template-columns:repeat(2,1fr)}
.grid-3{grid-template-columns:repeat(3,1fr)}
.grid-4{grid-template-columns:repeat(4,1fr)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 26px;
  border-radius:var(--r-btn);font-family:var(--f-head);font-weight:600;font-size:15px;border:1px solid transparent;cursor:pointer;text-decoration:none}
.btn:hover{text-decoration:none;filter:brightness(1.06)}
.btn--primary{background:var(--c-primary);color:#fff}
.btn--accent{background:var(--c-accent);color:#fff}
.btn--ghost{background:transparent;color:var(--c-primary);border-color:var(--c-border)}
.card{background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-lg);padding:22px;box-shadow:var(--sh)}
.card--flat{box-shadow:none;background:var(--c-surface);border-color:transparent}
.card h3{margin-bottom:6px}
.card__meta{color:var(--c-muted);font-size:14px}
.tbl{width:100%;border-collapse:collapse;font-size:15px;overflow:hidden;border-radius:var(--r);border:1px solid var(--c-border)}
.tbl th,.tbl td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--c-border)}
.tbl th{background:var(--c-surface);font-family:var(--f-head);font-weight:600;width:44%}
.tbl tr:last-child td,.tbl tr:last-child th{border-bottom:0}
.field{display:flex;flex-direction:column;gap:6px;font-size:14px}
.field input,.field textarea{min-height:48px;padding:12px 14px;border:1px solid var(--c-border);border-radius:var(--r);font:inherit;background:var(--c-bg);color:var(--c-text)}
.badge{display:inline-block;padding:4px 12px;border-radius:999px;background:var(--primary-soft);color:var(--c-primary);font-size:13px;font-weight:600}
.crumbs{font-size:13px;color:var(--c-muted);padding:14px 0}
.crumbs a{color:var(--c-muted)}
.site-header{position:sticky;top:0;z-index:20;background:var(--c-bg);border-bottom:1px solid var(--c-border)}
.site-header__in{display:flex;align-items:center;gap:20px;min-height:72px}
.logo{font-family:var(--f-head);font-weight:700;font-size:20px;color:var(--c-text);letter-spacing:-.02em}
.logo span{color:var(--c-accent)}
.nav{display:flex;gap:18px;margin-left:auto;font-size:15px}
.nav a{color:var(--c-text)}
.burger{display:none;margin-left:auto;position:relative}
.burger>summary{list-style:none;cursor:pointer;display:flex;flex-direction:column;justify-content:center;gap:5px;width:44px;height:44px;align-items:center}
.burger>summary::-webkit-details-marker{display:none}
.burger>summary span{display:block;width:22px;height:2px;background:var(--c-text)}
.burger__nav{position:absolute;right:0;top:52px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--radius);padding:12px 16px;display:flex;flex-direction:column;gap:12px;min-width:200px;z-index:30}
.burger__nav a{color:var(--c-text);padding:6px 0;display:block}
.hdr-contact{font-family:var(--f-head);font-weight:600;color:var(--c-text);white-space:nowrap}
.hero{padding:calc(var(--sec)/1.6) 0;background:linear-gradient(180deg,var(--primary-soft),transparent)}
.hero__grid{display:grid;grid-template-columns:1.15fr .85fr;gap:36px;align-items:center}
.hero__media{border-radius:var(--r-lg);overflow:hidden;box-shadow:var(--sh-lg);background:var(--c-surface);aspect-ratio:4/3}
.hero__media img{width:100%;height:100%;object-fit:cover}
.hero__actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}
.facts{display:flex;flex-wrap:wrap;gap:14px;margin-top:22px;padding:0;list-style:none}
.facts li{background:var(--c-surface);border-radius:var(--r);padding:10px 16px;font-size:14px}
.price-box{display:flex;flex-wrap:wrap;align-items:center;gap:18px;padding:22px;border:1px solid var(--c-border);border-radius:var(--r-lg);background:var(--c-surface)}
.price-box__value{font-family:var(--f-head);font-size:30px;font-weight:700;color:var(--c-primary)}
.steps{counter-reset:s;list-style:none;padding:0;margin:0;display:grid;gap:16px}
.steps li{counter-increment:s;position:relative;padding:20px 20px 20px 68px;background:var(--c-surface);border-radius:var(--r-lg)}
.steps li::before{content:counter(s);position:absolute;left:20px;top:18px;width:34px;height:34px;border-radius:50%;
  background:var(--c-primary);color:#fff;font-family:var(--f-head);font-weight:700;display:flex;align-items:center;justify-content:center}
.faq details{border:1px solid var(--c-border);border-radius:var(--r);padding:16px 18px;margin-bottom:10px;background:var(--c-bg)}
.faq summary{font-family:var(--f-head);font-weight:600;cursor:pointer;min-height:28px}
.faq p{margin:10px 0 0;color:var(--c-muted)}
.prose{max-width:78ch}
.prose h2{margin-top:1.6em}
.prose ul,.prose ol{padding-left:22px}
.cta-band{background:var(--c-primary);color:#fff;border-radius:var(--r-lg);padding:36px;display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between}
.cta-band h2,.cta-band p{color:#fff;margin:0}
.cta-band .btn--accent{background:var(--c-accent)}
.cta-band .btn--ghost{color:#fff;border-color:rgba(255,255,255,.5)}
.pcard{display:flex;flex-direction:column;gap:10px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-lg);overflow:hidden;box-shadow:var(--sh)}
.pcard__img{aspect-ratio:4/3;background:var(--c-surface);overflow:hidden}
.pcard__img img{width:100%;height:100%;object-fit:cover}
.pcard__body{padding:16px;display:flex;flex-direction:column;gap:8px;flex:1}
.pcard__title{font-family:var(--f-head);font-weight:600;font-size:16px;color:var(--c-text)}
.pcard__price{font-family:var(--f-head);font-weight:700;color:var(--c-primary)}
.pcard .btn{margin-top:auto;min-height:44px;padding:10px 18px;font-size:14px}
.chips{display:flex;flex-wrap:wrap;gap:10px;padding:0;list-style:none}
.chips a{display:inline-block;padding:9px 16px;border-radius:999px;border:1px solid var(--c-border);background:var(--c-bg);color:var(--c-text);font-size:14px}
.quote{border-left:3px solid var(--c-accent);padding:6px 0 6px 20px;font-size:1.05em}
.site-footer{background:var(--c-text);color:${"#fff"};margin-top:var(--sec);padding:48px 0 28px}
.site-footer a{color:rgba(255,255,255,.78)}
.site-footer .grid{gap:28px}
.site-footer h4{font-family:var(--f-head);font-size:15px;margin:0 0 12px;color:#fff}
.site-footer ul{list-style:none;padding:0;margin:0;display:grid;gap:8px;font-size:14px}
.site-footer__bottom{margin-top:32px;padding-top:18px;border-top:1px solid rgba(255,255,255,.16);font-size:13px;color:rgba(255,255,255,.6)}
.sticky-cta{display:none}
@media(max-width:1024px){
  .grid-4{grid-template-columns:repeat(2,1fr)}
  .grid-3{grid-template-columns:repeat(2,1fr)}
  .hero__grid{grid-template-columns:1fr;gap:26px}
  .nav{display:none}
  .burger{display:block}
}
@media(max-width:640px){
  .grid-2,.grid-3,.grid-4{grid-template-columns:1fr}
  .wrap{padding:0 16px}
  .cta-band{padding:24px;flex-direction:column;align-items:flex-start}
  .tbl th{width:50%}
  .btn{width:100%}
  .hdr-contact{display:none}
  .sticky-cta{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:40;padding:10px 14px;background:var(--c-bg);border-top:1px solid var(--c-border)}
  .sticky-cta .btn{flex:1}
  body{padding-bottom:72px}
}`.trim();
}
