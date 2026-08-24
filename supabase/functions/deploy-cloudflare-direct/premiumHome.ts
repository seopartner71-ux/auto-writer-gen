// ============================================================================
// P26 - PREMIUM THEME & EXPERIENCE SYSTEM (stage 1)
//
// Presentation only. Renders the commercial homepage from the Company Profile
// + the real catalog (silos / clusters / products). Never invents numbers:
// trust facts come from the profile or, when it is empty, from catalog counts.
//
// Pure + deterministic: no DB, no LLM, no network.
// ============================================================================

import { escHtml, type SiteChrome } from "./seoChrome.ts";

export interface PremiumCompany {
  name: string;
  positioning: string;
  description: string;
  phone: string;
  email: string;
  address: string;
  workingHours: string;
  advantages: string[];
  brands: string[];
  delivery: string;
  payment: string;
  warranty: string;
  yearsInBusiness: string;
  primaryCta: string;
  heroImage?: string;
}

export interface PremiumLink { label: string; href: string; image?: string; note?: string }
export interface PremiumProduct { name: string; href: string; image?: string; price?: string; note?: string }

const t = (v: unknown) => String(v ?? "").trim();
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const tel = (v: string) => v.replace(/[^\d+]/g, "");

/** Premium UI kit. Appended to style.css, so preview and ZIP stay identical. */
export const PREMIUM_CSS = `
:root{--pm-gap:clamp(48px,6vw,88px);--pm-r:14px}
.pm-wrap{width:100%;max-width:1240px;margin:0 auto;padding:0 20px}
.pm-sec{padding:calc(var(--pm-gap)/1.6) 0}
.pm-sec--alt{background:rgba(0,0,0,.03)}
.pm-sec h2{font-size:clamp(23px,2.8vw,34px);margin:0 0 .6em;letter-spacing:-.01em}
.pm-eyebrow{font-size:13px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;opacity:.75;margin:0 0 12px}
.pm-lead{font-size:1.08em;opacity:.78;max-width:62ch}
.pm-hero{padding:clamp(40px,6vw,80px) 0}
.pm-hero__grid{display:grid;gap:clamp(24px,4vw,48px);grid-template-columns:1fr;align-items:center}
@media(min-width:900px){.pm-hero__grid{grid-template-columns:1.1fr .9fr}}
.pm-hero h1{font-size:clamp(30px,4.6vw,52px);line-height:1.1;margin:0 0 .4em;letter-spacing:-.02em}
.pm-hero__media img{width:100%;border-radius:calc(var(--pm-r) + 6px);object-fit:cover;aspect-ratio:4/3}
.pm-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}
.pm-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 26px;
  border-radius:10px;font-weight:600;text-decoration:none;border:1px solid transparent}
.pm-btn--primary{background:var(--accent,#111);color:#fff}
.pm-btn--ghost{border-color:rgba(0,0,0,.18);color:inherit}
.pm-btn:hover{text-decoration:none;filter:brightness(1.07)}
.pm-facts{list-style:none;display:flex;flex-wrap:wrap;gap:10px 22px;padding:0;margin:22px 0 0;font-size:.94em;opacity:.85}
.pm-facts li::before{content:"✓";margin-right:8px;font-weight:700;color:var(--accent,#111)}
.pm-grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.pm-card{border:1px solid rgba(0,0,0,.1);border-radius:var(--pm-r);padding:20px;background:#fff;
  transition:box-shadow .2s ease,transform .2s ease}
.pm-card:hover{box-shadow:0 14px 40px -18px rgba(0,0,0,.35);transform:translateY(-2px)}
.pm-card h3{margin:0 0 .4em;font-size:1.05em}
.pm-card p{margin:0;font-size:.94em;opacity:.75}
a.pm-card{display:block;text-decoration:none;color:inherit}
.pm-pcard{border:1px solid rgba(0,0,0,.1);border-radius:var(--pm-r);overflow:hidden;display:flex;flex-direction:column;background:#fff}
.pm-pcard img{width:100%;aspect-ratio:4/3;object-fit:cover;background:rgba(0,0,0,.04)}
.pm-pcard__b{padding:14px 16px;display:flex;flex-direction:column;gap:6px;flex:1}
.pm-pcard__t{font-weight:600;line-height:1.3;color:inherit;text-decoration:none}
.pm-pcard__p{font-weight:700}
.pm-pcard__m{font-size:.85em;opacity:.65}
.pm-chips{list-style:none;display:flex;flex-wrap:wrap;gap:10px;padding:0;margin:0}
.pm-chips a,.pm-chips span{display:inline-block;padding:8px 16px;border:1px solid rgba(0,0,0,.14);border-radius:999px;font-size:.92em;text-decoration:none;color:inherit}
.pm-faq details{border:1px solid rgba(0,0,0,.1);border-radius:var(--pm-r);padding:14px 18px;margin:0 0 10px}
.pm-faq summary{cursor:pointer;font-weight:600}
.pm-faq p{margin:.7em 0 0;opacity:.8}
.pm-cta{border-radius:calc(var(--pm-r) + 6px);padding:clamp(24px,4vw,44px);background:var(--accent,#111);color:#fff;
  display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between}
.pm-cta h2{margin:0;color:#fff}
.pm-cta p{margin:.5em 0 0;opacity:.85}
.pm-cta .pm-btn{background:#fff;color:#111}
@media(max-width:640px){
  .pm-sec{padding:34px 0}
  .pm-cta{flex-direction:column;align-items:flex-start}
}
`;

function card(title: string, text: string): string {
  return `<article class="pm-card"><h3>${escHtml(title)}</h3>${text ? `<p>${escHtml(text)}</p>` : ""}</article>`;
}

function productCard(p: PremiumProduct): string {
  return `<article class="pm-pcard">
  ${p.image ? `<img src="${escHtml(p.image)}" alt="${escHtml(p.name)}" width="600" height="450" loading="lazy">` : ""}
  <div class="pm-pcard__b">
    <a class="pm-pcard__t" href="${escHtml(p.href)}">${escHtml(p.name)}</a>
    ${p.note ? `<span class="pm-pcard__m">${escHtml(p.note)}</span>` : ""}
    ${p.price ? `<span class="pm-pcard__p">${escHtml(p.price)}</span>` : ""}
  </div>
</article>`;
}

function section(opts: { title?: string; intro?: string; alt?: boolean; body: string }): string {
  if (!t(opts.body)) return "";
  return `<section class="pm-sec${opts.alt ? " pm-sec--alt" : ""}"><div class="pm-wrap">
  ${opts.title ? `<h2>${escHtml(opts.title)}</h2>` : ""}
  ${opts.intro ? `<p class="pm-lead">${escHtml(opts.intro)}</p>` : ""}
  ${opts.body}
</div></section>`;
}

/**
 * Premium homepage body: Hero -> Categories -> Advantages -> Products ->
 * Brands -> Applications -> Articles -> FAQ -> CTA.
 * Sections without real data are omitted instead of being faked.
 */
export function renderPremiumHome(args: {
  chrome: SiteChrome;
  company: PremiumCompany;
  categories: PremiumLink[];
  products: PremiumProduct[];
  applications: PremiumLink[];
  articles: PremiumLink[];
  faq: { q: string; a: string }[];
  counts: { products: number; categories: number; silos: number };
}): string {
  const { company: c, counts } = args;
  const en = args.chrome.lang === "en";
  const tr = (ru: string, eng: string) => (en ? eng : ru);
  const title = t(c.positioning) || t(c.name) || args.chrome.siteName;
  const subtitle = t(c.description) || t(args.chrome.siteAbout);
  const cta = t(c.primaryCta) || tr("Оставить заявку", "Request a quote");

  // Trust facts: profile first, catalog counts as the factual fallback.
  const facts = [
    t(c.yearsInBusiness) ? tr(`Опыт: ${c.yearsInBusiness}`, `Experience: ${c.yearsInBusiness}`) : "",
    counts.products ? `${counts.products} ${tr(plural(counts.products, "позиция", "позиции", "позиций"), "items")} ${tr("в каталоге", "in catalog")}` : "",
    counts.categories ? `${counts.categories} ${tr(plural(counts.categories, "категория", "категории", "категорий"), "categories")}` : "",
    t(c.delivery) ? tr("Доставка", "Delivery") : "",
    t(c.warranty) ? tr("Гарантия", "Warranty") : "",
  ].filter(Boolean).slice(0, 4);

  const hero = `<section class="pm-hero"><div class="pm-wrap"><div class="pm-hero__grid">
  <div>
    ${t(c.name) ? `<p class="pm-eyebrow">${escHtml(c.name)}</p>` : ""}
    <h1>${escHtml(title)}</h1>
    ${subtitle ? `<p class="pm-lead">${escHtml(subtitle)}</p>` : ""}
    ${facts.length ? `<ul class="pm-facts">${facts.map((f) => `<li>${escHtml(f)}</li>`).join("")}</ul>` : ""}
    <div class="pm-actions">
      <a class="pm-btn pm-btn--primary" href="/catalog/">${escHtml(tr("Смотреть каталог", "Browse catalog"))}</a>
      ${t(c.phone) ? `<a class="pm-btn pm-btn--ghost" href="tel:${escHtml(tel(c.phone))}">${escHtml(c.phone)}</a>` : ""}
    </div>
  </div>
  ${c.heroImage ? `<div class="pm-hero__media"><img src="${escHtml(c.heroImage)}" alt="${escHtml(title)}" width="800" height="600" loading="eager" fetchpriority="high"></div>` : ""}
</div></div></section>`;

  const categories = section({
    title: tr("Каталог по разделам", "Catalog sections"),
    body: args.categories.length
      ? `<div class="pm-grid">${args.categories.slice(0, 12).map((x) =>
          `<a class="pm-card" href="${escHtml(x.href)}"><h3>${escHtml(x.label)}</h3>${x.note ? `<p>${escHtml(x.note)}</p>` : ""}</a>`).join("")}</div>`
      : "",
  });

  const advantageItems = c.advantages.length
    ? c.advantages.slice(0, 6).map((a) => ({ title: a, text: "" }))
    : [
        counts.products ? { title: tr("Каталог", "Catalog"), text: `${counts.products} ${tr(plural(counts.products, "позиция", "позиции", "позиций"), "items")}` } : null,
        counts.categories ? { title: tr("Разделы", "Sections"), text: `${counts.categories} ${tr(plural(counts.categories, "категория", "категории", "категорий"), "categories")}` } : null,
        t(c.delivery) ? { title: tr("Доставка", "Delivery"), text: c.delivery } : null,
        t(c.payment) ? { title: tr("Оплата", "Payment"), text: c.payment } : null,
        t(c.warranty) ? { title: tr("Гарантия", "Warranty"), text: c.warranty } : null,
      ].filter(Boolean) as { title: string; text: string }[];

  const advantages = section({
    title: tr("Почему нам доверяют", "Why clients choose us"),
    alt: true,
    body: advantageItems.length ? `<div class="pm-grid">${advantageItems.map((i) => card(i.title, i.text)).join("")}</div>` : "",
  });

  const products = section({
    title: tr("Популярные позиции", "Featured items"),
    body: args.products.length ? `<div class="pm-grid">${args.products.slice(0, 8).map(productCard).join("")}</div>` : "",
  });

  const brands = section({
    title: tr("Бренды", "Brands"),
    alt: true,
    body: c.brands.length ? `<ul class="pm-chips">${c.brands.slice(0, 18).map((b) => `<li><span>${escHtml(b)}</span></li>`).join("")}</ul>` : "",
  });

  const applications = section({
    title: tr("Направления", "Areas of work"),
    body: args.applications.length
      ? `<ul class="pm-chips">${args.applications.slice(0, 16).map((a) => `<li><a href="${escHtml(a.href)}">${escHtml(a.label)}</a></li>`).join("")}</ul>`
      : "",
  });

  const articles = section({
    title: tr("Статьи и материалы", "Guides and articles"),
    alt: true,
    body: args.articles.length
      ? `<div class="pm-grid">${args.articles.slice(0, 6).map((a) =>
          `<a class="pm-card" href="${escHtml(a.href)}"><h3>${escHtml(a.label)}</h3><p>${escHtml(tr("Читать", "Read"))}</p></a>`).join("")}</div>`
      : "",
  });

  const faq = section({
    title: tr("Вопросы и ответы", "FAQ"),
    body: args.faq.length
      ? `<div class="pm-faq">${args.faq.slice(0, 8).map((f) =>
          `<details><summary>${escHtml(f.q)}</summary><p>${escHtml(f.a)}</p></details>`).join("")}</div>`
      : "",
  });

  const ctaBand = `<section class="pm-sec"><div class="pm-wrap"><div class="pm-cta">
  <div>
    <h2>${escHtml(tr("Готовы обсудить задачу?", "Ready to discuss your task?"))}</h2>
    <p>${escHtml(t(c.workingHours) || tr("Ответим и подберем решение под ваш запрос.", "We will get back with a tailored option."))}</p>
  </div>
  <div class="pm-actions" style="margin:0">
    ${t(c.phone) ? `<a class="pm-btn" href="tel:${escHtml(tel(c.phone))}">${escHtml(c.phone)}</a>` : ""}
    ${t(c.email) ? `<a class="pm-btn pm-btn--ghost" style="border-color:rgba(255,255,255,.5);color:#fff" href="mailto:${escHtml(c.email)}">${escHtml(cta)}</a>` : ""}
  </div>
</div></div></section>`;

  return [hero, categories, advantages, products, brands, applications, articles, faq, ctaBand]
    .filter(Boolean).join("\n");
}
