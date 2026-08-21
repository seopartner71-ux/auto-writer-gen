// ============================================================================
// P18 - VISUAL RENDERER / SITE COMPONENTS (/components/site)
//
// Every component takes plain JSON props, contains NO business logic and is
// responsive by construction (the responsive rules live in the design system).
// Same kit for the homepage and for every internal page.
// ============================================================================

export const esc = (v: unknown): string =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const t = (v: unknown) => String(v ?? "").trim();
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(t).filter(Boolean) : []);

export interface LinkProps { href: string; label: string }
export interface CtaProps { label?: string; href?: string; secondary?: string }

// ---------------------------------------------------------------------------
// HEADER / FOOTER / BREADCRUMBS
// ---------------------------------------------------------------------------
export interface HeaderProps {
  logo?: string; logoAccent?: string; nav?: LinkProps[]; phone?: string; cta?: string; variant?: string;
}
export function Header(p: HeaderProps): string {
  const nav = (p.nav || []).slice(0, 6)
    .map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join("");
  return `<header class="site-header"><div class="wrap site-header__in">
  <a class="logo" href="/">${esc(p.logo || "Site")}${p.logoAccent ? `<span>${esc(p.logoAccent)}</span>` : ""}</a>
  <nav class="nav" aria-label="Main">${nav}</nav>
  ${nav ? `<details class="burger"><summary aria-label="\u041c\u0435\u043d\u044e"><span></span><span></span><span></span></summary><nav class="burger__nav" aria-label="Mobile">${nav}</nav></details>` : ""}
  ${p.phone ? `<a class="hdr-contact" href="tel:${esc(p.phone.replace(/[^\d+]/g, ""))}">${esc(p.phone)}</a>` : ""}
  ${p.cta ? `<a class="btn btn--primary" href="#lead">${esc(p.cta)}</a>` : ""}
</div></header>`;
}

export interface FooterProps {
  company?: string; about?: string; phone?: string; email?: string; address?: string;
  columns?: { title: string; links: LinkProps[] }[]; copyright?: string;
}
export function Footer(p: FooterProps): string {
  const cols = (p.columns || []).slice(0, 3).map((c) => `<div><h4>${esc(c.title)}</h4><ul>${
    c.links.slice(0, 8).map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`).join("")
  }</ul></div>`).join("");
  return `<footer class="site-footer"><div class="wrap">
  <div class="grid grid-4">
    <div><h4>${esc(p.company || "")}</h4><p style="font-size:14px;color:rgba(255,255,255,.7)">${esc(p.about || "")}</p></div>
    ${cols}
    <div><h4>Контакты</h4><ul>
      ${p.phone ? `<li><a href="tel:${esc(p.phone.replace(/[^\d+]/g, ""))}">${esc(p.phone)}</a></li>` : ""}
      ${p.email ? `<li><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></li>` : ""}
      ${p.address ? `<li>${esc(p.address)}</li>` : ""}
    </ul></div>
  </div>
  <div class="site-footer__bottom">${esc(p.copyright || p.company || "")}</div>
</div></footer>`;
}

export function Breadcrumbs(p: { items?: LinkProps[] }): string {
  const items = (p.items || []).filter((i) => t(i.label));
  if (!items.length) return "";
  const html = items.map((i, idx) => idx === items.length - 1
    ? `<span>${esc(i.label)}</span>`
    : `<a href="${esc(i.href)}">${esc(i.label)}</a> / `).join("");
  return `<div class="wrap"><nav class="crumbs" aria-label="Breadcrumb">${html}</nav></div>`;
}

// ---------------------------------------------------------------------------
// HERO
// ---------------------------------------------------------------------------
export interface HeroProps {
  eyebrow?: string; title: string; subtitle?: string; image?: string;
  facts?: string[]; cta?: CtaProps; variant?: string;
}
export function Hero(p: HeroProps): string {
  const facts = list(p.facts).slice(0, 4);
  const media = p.image
    ? `<div class="hero__media"><img src="${esc(p.image)}" alt="${esc(p.title)}" loading="eager"></div>`
    : "";
  return `<section class="hero"><div class="wrap"><div class="hero__grid">
  <div>
    ${p.eyebrow ? `<p class="eyebrow">${esc(p.eyebrow)}</p>` : ""}
    <h1>${esc(p.title)}</h1>
    ${p.subtitle ? `<p class="lead">${esc(p.subtitle)}</p>` : ""}
    ${facts.length ? `<ul class="facts">${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
    <div class="hero__actions">
      <a class="btn btn--primary" href="#lead">${esc(p.cta?.label || "Оставить заявку")}</a>
      ${p.cta?.secondary ? `<a class="btn btn--ghost" href="#content">${esc(p.cta.secondary)}</a>` : ""}
    </div>
  </div>
  ${media}
</div></div></section>`;
}

// ---------------------------------------------------------------------------
// SECTION SHELL
// ---------------------------------------------------------------------------
export function Section(opts: { id?: string; title?: string; intro?: string; alt?: boolean; body: string }): string {
  if (!t(opts.body)) return "";
  return `<section class="section${opts.alt ? " section--alt" : ""}"${opts.id ? ` id="${esc(opts.id)}"` : ""}><div class="wrap">
  ${opts.title ? `<h2>${esc(opts.title)}</h2>` : ""}
  ${opts.intro ? `<p class="lead">${esc(opts.intro)}</p>` : ""}
  ${opts.body}
</div></section>`;
}

// ---------------------------------------------------------------------------
// TRUST / ADVANTAGES / INFO CARDS
// ---------------------------------------------------------------------------
export interface CardItem { title: string; text?: string }
export function CardGrid(p: { items?: CardItem[]; cols?: number; flat?: boolean }): string {
  const items = (p.items || []).filter((i) => t(i.title)).slice(0, 8);
  if (!items.length) return "";
  return `<div class="grid grid-${p.cols || 3}">${items.map((i) => `<article class="card${p.flat ? " card--flat" : ""}">
    <h3>${esc(i.title)}</h3>${i.text ? `<p class="card__meta">${esc(i.text)}</p>` : ""}</article>`).join("")}</div>`;
}
export const TrustBlock = (p: { items?: CardItem[] }) => CardGrid({ items: p.items, cols: 4, flat: true });
export const Advantages = (p: { items?: CardItem[] }) => CardGrid({ items: p.items, cols: 3 });

// ---------------------------------------------------------------------------
// CHARACTERISTICS / SPEC TABLE
// ---------------------------------------------------------------------------
export function Characteristics(p: { rows?: [string, string][] }): string {
  const rows = (p.rows || []).filter(([k]) => t(k)).slice(0, 40);
  if (!rows.length) return "";
  return `<table class="tbl"><tbody>${rows.map(([k, v]) =>
    `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// CATALOG
// ---------------------------------------------------------------------------
export interface ProductCardProps { title: string; href?: string; image?: string; price?: string; note?: string; cta?: string }
export function ProductCard(p: ProductCardProps): string {
  return `<article class="pcard">
  <div class="pcard__img">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy">` : ""}</div>
  <div class="pcard__body">
    <span class="pcard__title">${esc(p.title)}</span>
    ${p.note ? `<span class="card__meta">${esc(p.note)}</span>` : ""}
    ${p.price ? `<span class="pcard__price">${esc(p.price)}</span>` : ""}
    <a class="btn btn--ghost" href="${esc(p.href || "#")}">${esc(p.cta || "Подробнее")}</a>
  </div>
</article>`;
}
export function CatalogGrid(p: { items?: ProductCardProps[]; cols?: number }): string {
  const items = (p.items || []).filter((i) => t(i.title)).slice(0, 12);
  if (!items.length) return "";
  return `<div class="grid grid-${p.cols || 3}">${items.map(ProductCard).join("")}</div>`;
}
export function Chips(p: { items?: LinkProps[] }): string {
  const items = (p.items || []).filter((i) => t(i.label)).slice(0, 24);
  if (!items.length) return "";
  return `<ul class="chips">${items.map((i) => `<li><a href="${esc(i.href)}">${esc(i.label)}</a></li>`).join("")}</ul>`;
}
export function Gallery(p: { images?: string[]; alt?: string }): string {
  const imgs = list(p.images).slice(0, 6);
  if (!imgs.length) return "";
  return `<div class="grid grid-3">${imgs.map((src, i) =>
    `<div class="hero__media" style="aspect-ratio:4/3"><img src="${esc(src)}" alt="${esc(p.alt || "")} ${i + 1}" loading="lazy"></div>`).join("")}</div>`;
}
export function PriceBlock(p: { price?: string; availability?: string; cta?: string; note?: string }): string {
  return `<div class="price-box">
  <span class="price-box__value">${esc(p.price || "Цена по запросу")}</span>
  ${p.availability ? `<span class="badge">${esc(p.availability)}</span>` : ""}
  ${p.note ? `<span class="card__meta">${esc(p.note)}</span>` : ""}
  <a class="btn btn--accent" href="#lead" style="margin-left:auto">${esc(p.cta || "Запросить цену")}</a>
</div>`;
}
export function ComparisonTable(p: { head?: string[]; rows?: string[][] }): string {
  const head = list(p.head);
  const rows = (p.rows || []).filter((r) => Array.isArray(r) && r.length).slice(0, 12);
  if (!head.length || !rows.length) return "";
  return `<div style="overflow-x:auto"><table class="tbl"><thead><tr>${
    head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------
// SERVICE / PROCESS / REVIEWS
// ---------------------------------------------------------------------------
export function ServiceSteps(p: { steps?: CardItem[] }): string {
  const steps = (p.steps || []).filter((s) => t(s.title)).slice(0, 8);
  if (!steps.length) return "";
  return `<ol class="steps">${steps.map((s) => `<li><h3>${esc(s.title)}</h3>${
    s.text ? `<p class="card__meta">${esc(s.text)}</p>` : ""}</li>`).join("")}</ol>`;
}
export function Reviews(p: { items?: { text: string; author?: string }[] }): string {
  const items = (p.items || []).filter((i) => t(i.text)).slice(0, 6);
  if (!items.length) return "";
  return `<div class="grid grid-3">${items.map((i) => `<blockquote class="card">
    <p class="quote">${esc(i.text)}</p>${i.author ? `<p class="card__meta">${esc(i.author)}</p>` : ""}</blockquote>`).join("")}</div>`;
}
export function ExpertBlock(p: { text?: string; author?: string; role?: string }): string {
  if (!t(p.text)) return "";
  return `<div class="card"><p class="quote">${esc(p.text)}</p>
  <p class="card__meta">${esc(p.author || "")}${p.role ? ` - ${esc(p.role)}` : ""}</p></div>`;
}

// ---------------------------------------------------------------------------
// CONTENT
// ---------------------------------------------------------------------------
export function Prose(p: { html?: string; text?: string }): string {
  if (t(p.html)) return `<div class="prose">${p.html}</div>`;
  const paras = t(p.text).split(/\n{2,}/).filter(Boolean);
  if (!paras.length) return "";
  return `<div class="prose">${paras.map((x) => `<p>${esc(x)}</p>`).join("")}</div>`;
}
export function ArticleContent(p: { blocks?: { heading?: string; text?: string }[]; html?: string }): string {
  if (t(p.html)) return `<div class="prose">${p.html}</div>`;
  const blocks = (p.blocks || []).filter((b) => t(b.heading) || t(b.text)).slice(0, 30);
  if (!blocks.length) return "";
  return `<div class="prose">${blocks.map((b) => `${b.heading ? `<h2>${esc(b.heading)}</h2>` : ""}${
    t(b.text).split(/\n{2,}/).filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join("")}`).join("")}</div>`;
}
export function AuthorCard(p: { name?: string; role?: string; date?: string }): string {
  if (!t(p.name)) return "";
  return `<div class="card card--flat" style="display:flex;gap:14px;align-items:center">
  <div style="width:44px;height:44px;border-radius:50%;background:var(--primary-soft)"></div>
  <div><strong>${esc(p.name)}</strong><div class="card__meta">${esc(p.role || "")}${p.date ? ` - ${esc(p.date)}` : ""}</div></div>
</div>`;
}
export function RelatedContent(p: { items?: LinkProps[]; title?: string }): string {
  const items = (p.items || []).filter((i) => t(i.label)).slice(0, 6);
  if (!items.length) return "";
  return `<div class="grid grid-3">${items.map((i) => `<a class="card" href="${esc(i.href)}">
    <h3 style="font-size:16px">${esc(i.label)}</h3><span class="card__meta">Читать</span></a>`).join("")}</div>`;
}

// ---------------------------------------------------------------------------
// CONVERSION
// ---------------------------------------------------------------------------
export function FAQ(p: { items?: { q: string; a: string }[] }): string {
  const items = (p.items || []).filter((i) => t(i.q) && t(i.a)).slice(0, 12);
  if (!items.length) return "";
  return `<div class="faq">${items.map((i) => `<details><summary>${esc(i.q)}</summary><p>${esc(i.a)}</p></details>`).join("")}</div>`;
}
export function CTA(p: { title?: string; text?: string; primary?: string; secondary?: string; phone?: string }): string {
  return `<div class="cta-band">
  <div><h2>${esc(p.title || "Готовы обсудить задачу?")}</h2>${p.text ? `<p>${esc(p.text)}</p>` : ""}</div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <a class="btn btn--accent" href="#lead">${esc(p.primary || "Оставить заявку")}</a>
    ${p.phone ? `<a class="btn btn--ghost" href="tel:${esc(p.phone.replace(/[^\d+]/g, ""))}">${esc(p.phone)}</a>` : ""}
  </div>
</div>`;
}
export function LeadForm(p: { title?: string; text?: string; cta?: string }): string {
  return `<div class="card" id="lead">
  <h2>${esc(p.title || "Оставить заявку")}</h2>
  ${p.text ? `<p class="lead">${esc(p.text)}</p>` : ""}
  <form class="grid grid-3" onsubmit="return false">
    <label class="field"><span>Имя</span><input name="name" autocomplete="name"></label>
    <label class="field"><span>Телефон</span><input name="phone" autocomplete="tel"></label>
    <label class="field"><span>Комментарий</span><input name="comment"></label>
  </form>
  <div style="margin-top:16px"><button class="btn btn--primary" type="submit">${esc(p.cta || "Отправить")}</button></div>
</div>`;
}
export function StickyCta(p: { label?: string; phone?: string }): string {
  return `<div class="sticky-cta">
  <a class="btn btn--primary" href="#lead">${esc(p.label || "Заявка")}</a>
  ${p.phone ? `<a class="btn btn--ghost" href="tel:${esc(p.phone.replace(/[^\d+]/g, ""))}">Позвонить</a>` : ""}
</div>`;
}
