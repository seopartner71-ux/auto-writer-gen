/**
 * Light Shop theme for factory-built commerce sites.
 *
 * Activated per project via projects.site_theme = 'light-shop'. Like the dark
 * premium theme it does not fork templates: it re-paints the shared premium UI
 * kit (PREMIUM_CSS, COMMERCE_CSS, chrome stylesheet) by overriding the --pm-*
 * custom properties and the few surfaces that carry their own colors.
 * Appended LAST in style.css, same specificity, so it always wins.
 *
 * Reference look (client-approved): white page, light gray canvas, strong blue
 * accent, dense product cards, left filter rail on catalog pages.
 */

export const LIGHT_SHOP_THEME = "light-shop";
export const LIGHT_SHOP_ACCENT = "#1F49C6";
export const LIGHT_SHOP_FONT_PAIR: [string, string] = ["Manrope", "Inter"];

export const LIGHT_SHOP_CSS = `
/* ---- Light Shop theme --------------------------------------------------- */
:root{
  color-scheme:light;
  --pm-bg:#F1F4F8;
  --pm-ink:#16202F;
  --pm-mute:#5C6B80;
  --pm-line:#DDE3EC;
  --pm-surface:#FFFFFF;
  --pm-soft:#F7F9FC;
}
html,body{background:var(--pm-bg);color:var(--pm-ink)}
::selection{background:rgba(31,73,198,.18);color:#16202F}

main.page{background:transparent}
main.page h1,main.page h2,main.page h3{color:#101B2B;letter-spacing:-.01em}
main.page h1{font-weight:800}

/* header */
.site-header{background:#fff;border-bottom:1px solid var(--pm-line);box-shadow:0 1px 0 rgba(16,32,47,.04)}
.site-header__brand{color:#101B2B;font-weight:800}
.site-header__tagline{color:var(--pm-mute)}
.site-header__burger span{background:#101B2B}
.site-nav{background:#fff}
.site-nav a{color:#1B2A3D;font-weight:600;text-transform:uppercase;font-size:.86rem;letter-spacing:.02em}
.site-nav a:hover{color:var(--accent,#1F49C6)}
@media (max-width:760px){.site-nav{border-top-color:var(--pm-line)}}

/* breadcrumbs */
.breadcrumbs{color:var(--pm-mute)}
.breadcrumbs a{color:#3C567A}
.breadcrumbs a:hover{color:var(--accent,#1F49C6)}

/* surfaces */
.pm-hero{background:#fff;border:1px solid var(--pm-line);border-radius:14px}
.pm-sec--alt{background:#fff}
.pm-card,.pm-pcard,.cm-card,.cm-buybox,.silo-card a{background:#fff;border-color:var(--pm-line)}
.pm-card:hover,.cm-card:hover{box-shadow:0 14px 34px -22px rgba(16,32,47,.45)}
.pm-chips a,.pm-chips span,.cm-cats a{border-color:var(--pm-line);color:#1B2A3D;background:#fff}
.pm-faq details{background:#fff;border-color:var(--pm-line)}
.pm-pcard img,.cm-card img,.cm-hero img{background:#F3F6FA}
.pm-btn--ghost{border-color:#C9D3E2;color:#1B2A3D;background:#fff}
main.page a.pm-btn--ghost{color:#1B2A3D}

main.page a{color:#1F49C6}
main.page .cm-card a,main.page .cm-card__title{color:#101B2B}
main.page .cm-card__price{color:#101B2B}
main.page .cm-card__meta,main.page .silo-card__text{color:var(--pm-mute)}

/* commerce blocks */
.cm-buybox h1{color:#101B2B}
.cm-keyspecs li{border-bottom-color:var(--pm-line)}
.cm-specs{border-color:var(--pm-line);background:#fff}
.cm-specs th,.cm-specs td{border-bottom-color:var(--pm-line)}
.cm-specs tr:nth-child(even){background:#F7F9FC}
.cm-avail--in{color:#177245}
.cm-avail--out{color:#B3261E}
.cm-cta{background:var(--accent,#1F49C6);color:#fff;border-color:transparent}
main.page .cm-cta h2,main.page .cm-cta a,main.page .cm-cta p{color:#fff}
.pm-cta{background:var(--accent,#1F49C6)}
main.page .pm-cta h2,main.page .pm-cta p{color:#fff}
main.page .pm-cta a.pm-btn{background:#fff;color:#101B2B}

/* shop rail + toolbar */
.cm-filters,.cm-toolbar{background:#fff;border-color:var(--pm-line)}
.cm-filters__group b{color:#101B2B}
.cm-filters label{color:#1B2A3D}
.cm-badge{background:#E11D48;color:#fff}
.cm-btn--buy{background:var(--accent,#1F49C6);color:#fff}
main.page a.cm-btn--buy{color:#fff}
.cm-btn--more{background:#fff;border:1px solid #C9D3E2;color:#1B2A3D}
main.page a.cm-btn--more{color:#1B2A3D}

/* widgets */
.cookie-banner,.cb-banner{background:#101B2B;color:#fff;border-color:transparent}
.site-footer{background:#101B2B;color:#D7DEE9}
.site-footer a{color:#AFC3E6}

.page-article{color:#1B2A3D}
.page-article h1,.page-article h2,.page-article h3{color:#101B2B}

/* ---- reference shop chrome: utility bar, search, phone, menu row -------- */
.ls-top{background:#101B2B;color:#C8D3E3;font-size:13px}
.ls-top__in{max-width:1200px;margin:0 auto;padding:8px 24px;display:flex;justify-content:space-between;gap:16px;align-items:center}
.ls-top__mail{color:#C8D3E3;text-decoration:none}
.ls-top__mail:hover{color:#fff}
.site-header{position:static;background:#fff;backdrop-filter:none;border-bottom:1px solid var(--pm-line)}
.site-header__inner{flex-wrap:wrap;padding:14px 24px;gap:20px;align-items:center}
.site-header__brand{font-weight:800;letter-spacing:-.01em;font-size:22px}
.ls-search{flex:1 1 320px;display:flex;min-width:220px;max-width:560px}
.ls-search input{flex:1;border:1px solid #C9D3E2;border-right:0;border-radius:4px 0 0 4px;padding:11px 14px;font:inherit;font-size:15px;color:#16202F;background:#fff}
.ls-search input:focus{outline:2px solid rgba(31,73,198,.25);outline-offset:-2px}
.ls-search button{border:0;background:var(--accent,#1F49C6);color:#fff;padding:0 18px;border-radius:0 4px 4px 0;cursor:pointer;display:flex;align-items:center}
.ls-contact{display:flex;flex-direction:column;align-items:flex-end;line-height:1.25}
.ls-contact__tel{font-size:20px;font-weight:800;color:#101B2B;text-decoration:none;white-space:nowrap}
.ls-contact__cb{font-size:13px;color:var(--accent,#1F49C6);border-bottom:1px dashed currentColor;text-decoration:none}
.site-nav{order:9;flex:0 0 100%;border-top:1px solid var(--pm-line);margin-top:12px;padding-top:10px;display:flex;flex-wrap:wrap;gap:26px}
.site-nav a{text-transform:uppercase;font-size:13.5px;font-weight:700;letter-spacing:.04em;color:#16202F;text-decoration:none}
.site-nav a:hover{color:var(--accent,#1F49C6)}
@media(max-width:820px){.ls-search{order:9;flex:0 0 100%;max-width:none}.ls-contact{align-items:flex-start}}

/* compact section chips on the catalog index */
.cm-subnav{margin:1rem 0 1.75rem;display:flex;flex-direction:column;gap:.6rem}
.cm-subnav__row{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}
.cm-subnav__silo{font-weight:800;font-size:15px;color:#101B2B;text-decoration:none;margin-right:.35rem}
.cm-chip{display:inline-flex;align-items:center;gap:.4rem;background:#fff;border:1px solid #D7DEE9;border-radius:20px;padding:.35rem .8rem;font-size:13.5px;color:#1B2A3D;text-decoration:none}
.cm-chip span{color:#7C8AA0;font-size:12.5px}
.cm-chip:hover{border-color:var(--accent,#1F49C6);color:var(--accent,#1F49C6)}

/* filter rail header like the reference */
.cm-filters__head{align-items:center;border-bottom:2px solid var(--accent,#1F49C6);padding-bottom:.6rem;margin-bottom:.9rem}
.cm-filters__title{font-weight:800;font-size:16px;color:#101B2B;display:inline-flex;align-items:center;gap:.45rem}
.cm-filters__title::before{content:"";width:14px;height:12px;background:var(--accent,#1F49C6);clip-path:polygon(0 0,100% 0,62% 45%,62% 100%,38% 80%,38% 45%)}
.cm-toolbar__q{margin-left:.6rem;color:#5C6B80;font-size:13.5px}
`;
