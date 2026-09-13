/**
 * Dark Premium theme for factory-built sites.
 *
 * Activated per project via projects.site_theme = 'dark-premium'. The theme
 * does not fork templates: it re-paints the shared premium UI kit
 * (PREMIUM_CSS in premiumHome.ts, COMMERCE_CSS in commercePages.ts and the
 * chrome stylesheet from seoChrome.ts) by overriding the --pm-* custom
 * properties and the few hard-coded light surfaces. Appended LAST in
 * style.css (after the shared kit), same specificity, so it always wins.
 *
 * Palette (chosen with the client): bg #0B1220, surface #111A2E,
 * accent #2F6BFF, ink #E2E8F0. Fonts: Space Grotesk (headings) + DM Sans.
 */

export const DARK_PREMIUM_THEME = "dark-premium";
export const DARK_PREMIUM_ACCENT = "#2F6BFF";
export const DARK_PREMIUM_FONT_PAIR: [string, string] = ["Space Grotesk", "DM Sans"];

export const DARK_PREMIUM_CSS = `
/* ---- Dark Premium theme ------------------------------------------------- */
:root{
  color-scheme:dark;
  --pm-bg:#0B1220;
  --pm-ink:#E2E8F0;
  --pm-mute:#94A3B8;
  --pm-line:rgba(148,163,184,.18);
  --pm-surface:#111A2E;
  --pm-soft:#0E1626;
}
html,body{background:var(--pm-bg);color:var(--pm-ink)}
::selection{background:rgba(47,107,255,.45);color:#fff}

/* header */
.site-header{background:rgba(11,18,32,.9);border-bottom:1px solid rgba(148,163,184,.14)}
.site-header__brand{color:var(--pm-ink)}
.site-header__tagline{color:#7d8da6}
.site-header__burger span{background:var(--pm-ink)}
.site-nav a{color:#B6C2D9}
.site-nav a:hover{color:var(--accent,#2F6BFF)}
@media (max-width:760px){.site-nav{border-top-color:rgba(148,163,184,.14)}}

/* breadcrumbs */
.breadcrumbs{color:#7d8da6}
.breadcrumbs a{color:#8ea0bd}
.breadcrumbs a:hover{color:var(--accent,#2F6BFF)}
.breadcrumbs li:not(:last-child)::after{color:#4a5b7a}

/* premium kit surfaces */
.pm-hero{background:var(--pm-soft)}
.pm-sec--alt{background:rgba(255,255,255,.025)}
.pm-card,.pm-pcard,.cm-card,.cm-buybox,.silo-card a{background:var(--pm-surface);border-color:rgba(148,163,184,.16)}
.pm-card:hover,.cm-card:hover{box-shadow:0 16px 44px -18px rgba(0,0,0,.65)}
.pm-chips a,.pm-chips span,.cm-cats a{border-color:rgba(148,163,184,.25);color:var(--pm-ink)}
.pm-faq details{background:var(--pm-surface);border-color:rgba(148,163,184,.16)}
.pm-pcard img,.cm-card img,.cm-hero img{background:#0E1626}
.pm-btn--ghost{border-color:rgba(226,232,240,.28);color:var(--pm-ink)}
main.page a.pm-btn--ghost{color:var(--pm-ink)}

/* readable links on dark - buttons and card copy keep their own colors */
main.page a{color:#8FB2FF}
main.page .cm-card a,main.page .cm-card__title,main.page .cm-card__price,
main.page .silo-card a,main.page .silo-card a *{color:var(--pm-ink)}
main.page .cm-card__meta,main.page .silo-card__text{color:var(--pm-mute)}

/* commerce blocks */
.cm-buybox h1{color:var(--pm-ink)}
.cm-keyspecs li{border-bottom-color:rgba(148,163,184,.2)}
.cm-specs{border-color:rgba(148,163,184,.16);background:var(--pm-surface)}
.cm-specs th,.cm-specs td{border-bottom-color:rgba(148,163,184,.12)}
.cm-specs tr:nth-child(even){background:rgba(255,255,255,.03)}
.cm-avail--in{color:#4ADE80}
.cm-avail--out{color:#F87171}
.cm-cta{background:var(--accent,#2F6BFF);color:#fff}
main.page .cm-cta h2{color:#fff}
main.page .cm-cta a{color:#fff}
.pm-cta{background:var(--accent,#2F6BFF)}
main.page .pm-cta h2{color:#fff}
main.page .pm-cta a.pm-btn{background:#fff;color:#0B1220}

/* gallery + widgets */
.cm-gallery__thumb{opacity:.85}
.cookie-banner,.cb-banner{background:#0E1626;color:var(--pm-ink);border-color:rgba(148,163,184,.2)}
.site-footer{background:#070C16}

/* article body text */
.page-article{color:var(--pm-ink)}
.page-article h1,.page-article h2,.page-article h3{color:var(--pm-ink)}
`;
