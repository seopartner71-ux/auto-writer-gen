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
export const LIGHT_SHOP_FONT_PAIR: [string, string] = ["Montserrat", "Inter"];

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
.breadcrumbs a{color:#3C5druh}
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
`;
