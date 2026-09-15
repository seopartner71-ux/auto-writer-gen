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
export const LIGHT_SHOP_FONT_PAIR: [string, string] = ["Inter", "Inter"];

export const LIGHT_SHOP_CSS = `
/* ---- Light Shop theme --------------------------------------------------- */
:root{
  color-scheme:light;
  --font-primary:'Inter',sans-serif;
  --font-weight-regular:400;
  --font-weight-medium:500;
  --font-weight-semibold:600;
  --font-weight-bold:700;
  --text-primary:#1F2937;
  --text-secondary:#6B7280;
  --text-muted:#9CA3AF;
  --heading-line-height:1.15;
  --body-line-height:1.6;
  --pm-bg:#F1F4F8;
  --pm-ink:#16202F;
  --pm-mute:#5C6B80;
  --pm-line:#DDE3EC;
  --pm-surface:#FFFFFF;
  --pm-soft:#F7F9FC;
}
html,body{background:var(--pm-bg);color:#374151;font-family:var(--font-primary);font-size:16px;line-height:var(--body-line-height);font-weight:var(--font-weight-regular);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
::selection{background:rgba(31,73,198,.18);color:#16202F}

main.page{background:transparent}
main.page h1,main.page h2,main.page h3{color:var(--text-primary);font-family:var(--font-primary);letter-spacing:0;overflow-wrap:break-word;word-break:normal;hyphens:auto}
main.page h1{font-size:clamp(2rem,4vw,3rem);line-height:var(--heading-line-height);font-weight:var(--font-weight-bold);margin:.25em 0 .6em}
main.page h2{font-size:clamp(1.6rem,3vw,2.25rem);line-height:1.2;font-weight:var(--font-weight-bold);margin:1.5em 0 .6em}
main.page h3{font-size:clamp(1.25rem,2vw,1.625rem);line-height:1.25;font-weight:var(--font-weight-semibold);margin:1.35em 0 .5em}
main.page p{line-height:var(--body-line-height)}

/* header */
.site-header{background:#fff;border-bottom:1px solid var(--pm-line);box-shadow:0 1px 0 rgba(16,32,47,.04)}
.site-header__brand{color:#101B2B;font-weight:var(--font-weight-bold)}
.site-header__tagline{color:var(--pm-mute)}
.site-header__burger span{background:#101B2B}
.site-nav{background:#fff}
.site-nav a{color:var(--text-primary);font-weight:var(--font-weight-semibold);text-transform:uppercase;font-size:clamp(14px,1.2vw,15px);letter-spacing:.02em;line-height:1.35}
.site-nav a:hover{color:var(--accent,#1F49C6)}
@media (max-width:760px){.site-nav{border-top-color:var(--pm-line)}}

/* breadcrumbs */
.breadcrumbs{color:var(--text-secondary);font-size:clamp(13px,1vw,14px);font-weight:var(--font-weight-regular);line-height:1.5}
.breadcrumbs a{color:var(--text-secondary);font-weight:var(--font-weight-regular)}
.breadcrumbs li:last-child{color:#374151;font-weight:var(--font-weight-regular)}
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
main.page .cm-card__title{font-size:clamp(15px,1.25vw,17px);font-weight:var(--font-weight-semibold);line-height:1.4;overflow-wrap:break-word;word-break:normal;hyphens:auto}
main.page .cm-card__price{color:#101B2B;font-size:clamp(18px,1.6vw,22px);line-height:1.25;font-weight:var(--font-weight-bold)}
main.page .cm-card__meta,main.page .silo-card__text{color:var(--text-secondary);font-size:14px;line-height:1.5;font-weight:var(--font-weight-regular)}
.cm-card__body{gap:.5rem;padding:1rem}
.cm-card__sku{font-family:var(--font-primary);font-size:13px;line-height:1.4;color:var(--text-secondary);opacity:1}
.cm-card__desc{font-size:14px;line-height:1.55;color:var(--text-secondary);opacity:1}
.cm-card__foot{padding-top:.9rem}

/* commerce blocks */
.cm-buybox h1{color:var(--text-primary);font-size:clamp(1.875rem,4vw,3rem);line-height:var(--heading-line-height);font-weight:var(--font-weight-semibold);margin:0 0 20px;overflow-wrap:break-word;word-break:normal;hyphens:auto}
.cm-keyspecs{gap:10px;margin-bottom:20px}
.cm-keyspecs li{border-bottom-color:var(--pm-line);font-size:clamp(14px,1.2vw,16px);line-height:1.5;padding-bottom:8px}
.cm-keyspecs span{color:var(--text-secondary);font-weight:var(--font-weight-regular);opacity:1}
.cm-keyspecs b{color:var(--text-primary);font-size:clamp(15px,1.25vw,17px);font-weight:var(--font-weight-semibold)}
.cm-price{font-size:clamp(1.875rem,3vw,2.25rem);line-height:1.2;font-weight:var(--font-weight-bold);letter-spacing:0;margin:12px 0 8px}
.cm-avail{font-size:clamp(15px,1.2vw,16px);line-height:1.5;color:var(--text-secondary);font-weight:var(--font-weight-regular);opacity:1}
.cm-avail--in,.cm-avail--out{font-weight:var(--font-weight-semibold)}
.cm-specs{border-color:var(--pm-line);background:#fff}
.cm-specs th,.cm-specs td{border-bottom-color:var(--pm-line);font-size:clamp(14px,1.2vw,16px);line-height:1.5;padding:12px 16px}
.cm-specs th{color:var(--text-secondary);font-weight:var(--font-weight-medium);opacity:1}
.cm-specs td{color:var(--text-primary);font-weight:var(--font-weight-semibold)}
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
.pm-btn,.cm-btn--buy,.cm-btn--more,.lsh-hero__actions a,.lsh-product__actions a{min-height:48px;display:inline-flex;align-items:center;justify-content:center;font-family:var(--font-primary);font-size:clamp(15px,1.2vw,16px);line-height:1.2;font-weight:var(--font-weight-semibold);letter-spacing:0;padding:0 20px}

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
.site-header__brand{font-weight:var(--font-weight-bold);letter-spacing:0;font-size:24px;text-transform:uppercase}
.site-header__tagline{font-size:11px;letter-spacing:.08em}
.ls-search{flex:1 1 320px;display:flex;min-width:220px;max-width:560px}
.ls-search input{flex:1;border:1px solid #C9D3E2;border-right:0;border-radius:4px 0 0 4px;padding:11px 14px;font:inherit;font-size:15px;color:#16202F;background:#fff}
.ls-search input:focus{outline:2px solid rgba(31,73,198,.25);outline-offset:-2px}
.ls-search button{border:0;background:var(--accent,#1F49C6);color:#fff;padding:0 18px;border-radius:0 4px 4px 0;cursor:pointer;display:flex;align-items:center}
.ls-contact{display:flex;flex-direction:column;align-items:flex-end;line-height:1.25}
.ls-contact__tel{font-size:20px;font-weight:var(--font-weight-bold);color:#101B2B;text-decoration:none;white-space:nowrap}
.ls-contact__cb{font-size:13px;color:var(--accent,#1F49C6);border-bottom:1px dashed currentColor;text-decoration:none}
.site-nav{order:9;flex:0 0 100%;border-top:1px solid var(--pm-line);margin-top:12px;padding-top:10px;display:flex;flex-wrap:wrap;gap:26px}
.site-nav a{text-transform:uppercase;font-size:clamp(14px,1.2vw,15px);font-weight:var(--font-weight-semibold);letter-spacing:.02em;color:var(--text-primary);text-decoration:none}
.site-nav a:hover{color:var(--accent,#1F49C6)}
@media(max-width:820px){.ls-search{order:9;flex:0 0 100%;max-width:none}.ls-contact{align-items:flex-start}}

/* compact section chips on the catalog index */
.cm-subnav{margin:1rem 0 1.75rem;display:flex;flex-direction:column;gap:.6rem}
.cm-subnav__row{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}
.cm-subnav__silo{font-weight:var(--font-weight-semibold);font-size:15px;color:#101B2B;text-decoration:none;margin-right:.35rem}
.cm-chip{display:inline-flex;align-items:center;gap:.4rem;background:#fff;border:1px solid #D7DEE9;border-radius:20px;padding:.35rem .8rem;font-size:13.5px;color:#1B2A3D;text-decoration:none}
.cm-chip span{color:#7C8AA0;font-size:12.5px}
.cm-chip:hover{border-color:var(--accent,#1F49C6);color:var(--accent,#1F49C6)}

/* filter rail header like the reference */
.cm-filters__head{align-items:center;border-bottom:2px solid var(--accent,#1F49C6);padding-bottom:.6rem;margin-bottom:.9rem}
.cm-filters__title{font-weight:var(--font-weight-semibold);font-size:16px;color:#101B2B;display:inline-flex;align-items:center;gap:.45rem}
.cm-filters__title::before{content:"";width:14px;height:12px;background:var(--accent,#1F49C6);clip-path:polygon(0 0,100% 0,62% 45%,62% 100%,38% 80%,38% 45%)}
.cm-toolbar__q{margin-left:.6rem;color:#5C6B80;font-size:13.5px}

/* reference-shaped commerce homepage */
body.pm-home main.page{background:#fff}
.lsh-hero{background:#F4F6F9;color:#101B2B;border-bottom:1px solid var(--pm-line)}
.lsh-hero__inner{min-height:520px;padding:78px 0;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr);gap:70px;align-items:center}
.lsh-hero__copy{max-width:760px}.lsh-kicker{display:inline-flex;margin:0 0 18px;color:#1F49C6;font-size:13px;font-weight:var(--font-weight-semibold);text-transform:uppercase;letter-spacing:.03em}
main.page .lsh-hero h1{margin:0 0 24px;color:#101B2B;font-size:clamp(2rem,4vw,3rem);line-height:var(--heading-line-height);font-weight:var(--font-weight-bold);letter-spacing:0}
.lsh-hero__copy>p:not(.lsh-kicker){margin:0;max-width:700px;color:#536277;font-size:18px;line-height:1.65}
.lsh-hero__actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}.lsh-hero__actions a{border-radius:4px;text-decoration:none}
main.page .lsh-primary{background:#1F49C6;color:#fff}main.page .lsh-secondary{border:1px solid #B7C2D2;color:#16202F}
.lsh-hero__catalog{background:#fff;border-top:4px solid #1F49C6;padding:26px 28px}.lsh-hero__catalog>p{margin:0 0 14px;font-size:13px;font-weight:var(--font-weight-semibold);text-transform:uppercase;color:#78869A;letter-spacing:.03em}.lsh-hero__catalog ul{list-style:none;margin:0;padding:0}.lsh-hero__catalog li+li{border-top:1px solid #E5E9EF}.lsh-hero__catalog a{display:flex;justify-content:space-between;gap:16px;padding:14px 0;color:#16202F;text-decoration:none;font-weight:var(--font-weight-semibold);line-height:1.4}.lsh-hero__catalog a:hover{color:#1F49C6}
.lsh-facts{border-bottom:1px solid var(--pm-line);background:#fff}.lsh-facts__grid{display:grid;grid-template-columns:repeat(4,1fr)}
.lsh-facts article{display:flex;gap:16px;padding:32px 20px;border-right:1px solid var(--pm-line)}.lsh-facts article:last-child{border-right:0}.lsh-facts h2{font-size:15px;margin:0 0 6px;color:#101B2B}.lsh-facts p{font-size:13px;line-height:1.45;margin:0;color:#66758A}.lsh-fact-icon{width:32px;height:32px;flex:0 0 32px;border:2px solid #FF5A1F;color:#FF5A1F;display:grid;place-items:center;font-size:12px;font-weight:800;transform:rotate(45deg)}.lsh-fact-icon::first-line{transform:rotate(-45deg)}
.lsh-copy h2,.lsh-section h2,.lsh-contact h2{font-size:clamp(1.6rem,3vw,2.25rem);line-height:1.2;font-weight:var(--font-weight-bold);margin:0 0 16px;letter-spacing:0;color:#101B2B}.lsh-copy p{max-width:920px;margin:0;color:#536277;font-size:clamp(16px,1.35vw,18px);line-height:var(--body-line-height)}.lsh-section--soft{background:#F5F7FA}.lsh-overline{margin:0 0 10px!important;color:#1F49C6!important;font-size:12px!important;font-weight:var(--font-weight-semibold);text-transform:uppercase;letter-spacing:.03em}
.lsh-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:24px}.lsh-heading h2{margin:0}.lsh-heading>a{color:#1F49C6;font-weight:700;text-decoration:none;white-space:nowrap}
.lsh-category-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#DDE3EC;border:1px solid #DDE3EC}.lsh-category{background:#fff;padding:28px;min-height:250px}.lsh-category h3{font-size:21px;margin:0 0 16px;color:#101B2B}.lsh-category ul{list-style:none;padding:0;margin:0 0 20px}.lsh-category li+li{margin-top:9px}.lsh-category li a{color:#536277;text-decoration:none}.lsh-category__all{display:inline-block;margin-top:auto;color:#1F49C6;font-weight:700;text-decoration:none}
.lsh-assortment{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid #DDE3EC;border-left:1px solid #DDE3EC}.lsh-assortment a{min-height:62px;padding:15px 18px;display:flex;align-items:center;justify-content:space-between;gap:14px;border-right:1px solid #DDE3EC;border-bottom:1px solid #DDE3EC;color:#26374E;text-decoration:none;font-weight:700}.lsh-assortment a:hover,.lsh-assortment a:hover b{color:#1F49C6}.lsh-assortment b{color:#94A0B2}
.lsh-section--selector{background:#122B68;color:#fff}.lsh-selector{display:grid;grid-template-columns:minmax(260px,.65fr) minmax(0,1.35fr);gap:64px;align-items:start}.lsh-selector h2{color:#fff}.lsh-selector>div:first-child>p:last-child{color:#D7E2FB;line-height:1.65}.lsh-selector__links{display:grid;grid-template-columns:repeat(2,1fr);border-top:1px solid rgba(255,255,255,.22);border-left:1px solid rgba(255,255,255,.22)}.lsh-selector__links a{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:58px;padding:14px 16px;border-right:1px solid rgba(255,255,255,.22);border-bottom:1px solid rgba(255,255,255,.22);color:#fff;text-decoration:none;font-weight:700}.lsh-selector__links a:hover{background:rgba(255,255,255,.08)}
.lsh-products{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.lsh-product{border:1px solid #DDE3EC;background:#fff;display:flex;flex-direction:column;min-width:0}.lsh-product__media{display:block;aspect-ratio:4/3;background:#F3F6FA;overflow:hidden}.lsh-product__media img{width:100%;height:100%;object-fit:cover}.lsh-product__placeholder{display:block;width:100%;height:100%;position:relative}.lsh-product__placeholder::before{content:"";position:absolute;width:82px;height:82px;border:8px solid #A4B1C2;border-radius:50%;left:50%;top:50%;transform:translate(-50%,-50%)}.lsh-product__placeholder::after{content:"";position:absolute;width:120px;height:34px;border:8px solid #A4B1C2;left:50%;top:50%;transform:translate(-50%,-50%) rotate(30deg)}
.lsh-product__body{padding:16px;display:flex;flex-direction:column;gap:9px;flex:1}.lsh-product__sku{font-family:var(--font-primary);font-size:13px;line-height:1.4;font-weight:var(--font-weight-regular);color:var(--text-secondary)}.lsh-product__title{font-size:clamp(15px,1.25vw,17px);font-weight:var(--font-weight-semibold);line-height:1.4;color:#101B2B;text-decoration:none;overflow-wrap:break-word;word-break:normal;hyphens:auto}.lsh-product__note{font-size:14px;line-height:1.5;color:var(--text-secondary)}.lsh-product__price{font-size:clamp(18px,1.6vw,22px);line-height:1.25;font-weight:var(--font-weight-bold);color:#101B2B;margin-top:auto}.lsh-product__actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 16px 16px}.lsh-product__actions a{text-align:center;border-radius:4px;text-decoration:none}.lsh-buy{background:#1F49C6;color:#fff}.lsh-more{border:1px solid #CAD3E0;color:#26374E}
.lsh-applications{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.lsh-applications a{min-height:116px;padding:18px;border:1px solid #DDE3EC;display:grid;grid-template-columns:1fr auto;grid-template-rows:auto 1fr;gap:12px;color:#16202F;text-decoration:none}.lsh-applications small{grid-column:1/-1;color:#8B98AA;font:12px ui-monospace,monospace}.lsh-applications span{align-self:end;font-weight:750}.lsh-applications b{align-self:end;color:#1F49C6}
.lsh-guides{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.lsh-guides>a{display:flex;flex-direction:column;min-height:190px;padding:24px;background:#fff;border:1px solid #DDE3EC;text-decoration:none}.lsh-guides h3{font-size:17px;line-height:1.4;margin:18px 0 20px;color:#101B2B}.lsh-guides span{margin-top:auto;color:#1F49C6;font-weight:700}.lsh-guide__num{margin:0!important;color:#8B98AA!important;font:12px ui-monospace,monospace!important}
.lsh-faq{display:grid;grid-template-columns:minmax(220px,.55fr) minmax(0,1.45fr);gap:64px;align-items:start}.lsh-faq details{border-top:1px solid #DDE3EC}.lsh-faq details:last-child{border-bottom:1px solid #DDE3EC}.lsh-faq summary{padding:20px 36px 20px 0;cursor:pointer;color:#16202F;font-weight:750;position:relative;list-style:none}.lsh-faq summary::-webkit-details-marker{display:none}.lsh-faq summary::after{content:"+";position:absolute;right:4px;top:17px;color:#1F49C6;font-size:22px}.lsh-faq details[open] summary::after{content:"−"}.lsh-faq details p{margin:0;padding:0 36px 20px 0;color:#536277;line-height:1.65}
.lsh-contact{background:#122B68;color:#fff;padding:38px 0}.lsh-contact>.pm-wrap{display:flex;align-items:center;justify-content:space-between;gap:24px}main.page .lsh-contact h2{color:#fff;margin:0}.lsh-contact p{color:#D7E2FB;margin:8px 0 0}.lsh-contact>.pm-wrap>div:last-child{display:flex;flex-direction:column;align-items:flex-end;gap:5px}.lsh-contact a{color:#fff;font-weight:750;text-decoration:none}
@media(max-width:960px){.lsh-hero__inner{grid-template-columns:1fr}.lsh-facts__grid{grid-template-columns:repeat(2,1fr)}.lsh-facts article:nth-child(2){border-right:0}.lsh-category-grid,.lsh-guides{grid-template-columns:1fr}.lsh-assortment{grid-template-columns:repeat(2,1fr)}.lsh-selector,.lsh-faq{grid-template-columns:1fr;gap:30px}.lsh-applications{grid-template-columns:repeat(2,1fr)}.lsh-products{grid-template-columns:repeat(2,1fr)}}
@media(max-width:760px){.site-nav{display:none}.site-nav.open{display:flex}}
@media(max-width:600px){.lsh-hero__inner{min-height:0;padding:50px 0}main.page .lsh-hero h1{font-size:clamp(2rem,9vw,2.25rem)}.cm-buybox{padding:20px 18px}.cm-buybox h1{font-size:clamp(1.875rem,9vw,2.125rem)}.cm-keyspecs li{align-items:flex-start;flex-direction:column;gap:2px}.cm-specs th,.cm-specs td{padding:10px 12px}.lsh-facts__grid{grid-template-columns:1fr}.lsh-facts article{border-right:0;border-bottom:1px solid var(--pm-line)}.lsh-products,.lsh-assortment,.lsh-selector__links,.lsh-applications{grid-template-columns:1fr}.lsh-heading{align-items:flex-start;flex-direction:column}.lsh-contact>.pm-wrap{align-items:flex-start;flex-direction:column}.lsh-contact>.pm-wrap>div:last-child{align-items:flex-start}}
`;
