// ============================================================================
// POC - DATA ADAPTER for the template-driven home page.
//
//   LandingContent + LandingCtx  ->  HomeTemplateData  ->  pages/home.html
//
// This module is pure and deterministic. It does NOT:
//   generate content, call an LLM, call FAL/Unsplash, choose a skin,
//   touch the DB, build URLs beyond the post paths it receives,
//   change SEO output or apply PBN randomization.
// It only reshapes already-produced data into display-ready, pre-escaped
// values for the template engine.
// ============================================================================

import type { LandingContent, LandingCtx } from "./landingPage.ts";
import type { TemplateRow } from "./dbTemplate.ts";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Same fallback URLs the existing renderer uses - URL строится, картинка не генерируется. */
function unsplashFallback(seed: string, w: number, h: number): string {
  const kw = String(seed || "business")
    .replace(/[«»"().,:;!?\-—]/g, " ")
    .trim().split(/\s+/).slice(0, 4).join(",");
  return `https://source.unsplash.com/${w}x${h}/?${encodeURIComponent(kw || "business")}`;
}
function avatarFallback(name: string): string {
  const n = encodeURIComponent(String(name || "User").slice(0, 40));
  return `https://ui-avatars.com/api/?name=${n}&size=320&background=random&format=png`;
}
function slotImage(ctx: LandingCtx, slot: string, seed: string, w: number, h: number): string {
  const url = ctx.generatedImages?.[slot];
  return url && /^https?:\/\//.test(url) ? url : unsplashFallback(seed, w, h);
}
function initialsAvatar(name: string, accent: string): string {
  const initials = String(name || "?").trim().split(/\s+/).filter(Boolean)
    .slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
  const tints = ["#fef3c7", "#dbeafe", "#fce7f3", "#dcfce7", "#ede9fe", "#ffedd5"];
  let h = 2166136261 >>> 0;
  for (let k = 0; k < name.length; k++) { h ^= name.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 42 42'><rect width='42' height='42' rx='21' fill='${tints[h % tints.length]}'/><text x='21' y='27' text-anchor='middle' font-family='Georgia,serif' font-size='17' font-weight='700' fill='${(accent || "#1a1a1a").slice(0, 9)}'>${initials}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

/** Visual tokens for assets/theme.css. Passed in by the caller (skin stays outside). */
export interface HomeThemeTokens {
  bg: string; ink: string; muted: string; surface: string; border: string;
  cardRadius: string; btnRadius: string; shadow: string; sectionPad: string;
}

export const DEFAULT_HOME_THEME: HomeThemeTokens = {
  bg: "#ffffff", ink: "#0f172a", muted: "#64748b", surface: "#f8fafc",
  border: "#e2e8f0", cardRadius: "16px", btnRadius: "10px",
  shadow: "0 10px 30px -10px rgba(15,23,42,.15)", sectionPad: "80px 24px",
};

/** Display-only data contract for pages/home.html. */
export interface HomeTemplateData extends TemplateRow {
  [key: string]: string | TemplateRow[];
}

export function buildHomeTemplateData(args: {
  ctx: LandingCtx;
  content: LandingContent;
  theme?: HomeThemeTokens;
  heroImageUrl?: string;
}): HomeTemplateData {
  const { ctx, content: c } = args;
  const t = args.theme || DEFAULT_HOME_THEME;
  const isRu = ctx.lang === "ru";
  const L = (ru: string, en: string) => (isRu ? ru : en);

  const heroImg = args.heroImageUrl && /^https?:\/\//.test(args.heroImageUrl)
    ? args.heroImageUrl
    : slotImage(ctx, "hero", `${ctx.topic} ${ctx.siteName} hero`, 1600, 900);

  const stats: TemplateRow[] = c.stats.slice(0, 4).map((s) => ({
    value: esc(s.value), label: esc(s.label),
  }));

  const features: TemplateRow[] = c.features.slice(0, 6).map((f) => ({
    icon: esc(f.icon), title: esc(f.title), text: esc(f.text),
  }));

  const services: TemplateRow[] = c.services.slice(0, 3).map((sv, i) => ({
    modifier: i === 1 ? " featured" : "",
    title: esc(sv.title),
    price: esc(sv.price),
    cta: esc(c.ctaPrimary),
    bullets: (sv.bullets || []).map((b) => ({ text: esc(b) })),
  }));

  const process: TemplateRow[] = c.process.slice(0, 4).map((p) => ({
    icon: esc(p.icon), title: esc(p.title), text: esc(p.text),
  }));

  const team: TemplateRow[] = c.team.slice(0, 3).map((m, i) => {
    const slot = `team_${i + 1}`;
    const url = ctx.generatedImages?.[slot];
    return {
      name: esc(m.name), role: esc(m.role), bio: esc(m.bio),
      image: url && /^https?:\/\//.test(url) ? url : avatarFallback(m.name),
    };
  });

  const testimonials: TemplateRow[] = c.testimonials.slice(0, 3).map((tt) => ({
    rating: String(tt.rating),
    stars: "★".repeat(tt.rating) + "☆".repeat(Math.max(0, 5 - tt.rating)),
    text: esc(tt.text), name: esc(tt.name), role: esc(tt.role),
    image: initialsAvatar(tt.name, ctx.accent),
  }));

  const posts: TemplateRow[] = (ctx.posts || []).slice(0, 3).map((p, i) => ({
    title: esc(p.title),
    excerpt: esc(p.excerpt),
    url: `/posts/${esc(p.slug)}.html`,
    image: p.featuredImageUrl && /^https?:\/\//.test(p.featuredImageUrl)
      ? p.featuredImageUrl
      : slotImage(ctx, `post_${i + 1}`, p.slug || p.title, 600, 340),
  }));

  return {
    // theme tokens
    accent: ctx.accent, bg: t.bg, ink: t.ink, muted: t.muted, surface: t.surface,
    border: t.border, card_radius: t.cardRadius, btn_radius: t.btnRadius,
    shadow: t.shadow, section_pad: t.sectionPad,
    heading_font: ctx.headingFont, body_font: ctx.bodyFont,

    // site
    site_name: esc(ctx.siteName),

    // hero
    hero_image: heroImg,
    hero_badge: esc(c.heroBadge),
    hero_title: esc(c.heroTitle),
    hero_subtitle: esc(c.heroSubtitle),
    cta_primary: esc(c.ctaPrimary),
    cta_secondary: esc(c.ctaSecondary),
    form_title: esc(L("Оставьте заявку", "Request a callback")),
    form_subtitle: esc(L("Перезвоним в течение 15 минут", "We will call back within 15 minutes")),
    form_name_placeholder: esc(L("Ваше имя", "Your name")),
    form_short_name_placeholder: esc(L("Имя", "Name")),
    form_phone_placeholder: esc(L("Телефон", "Phone")),
    form_email_placeholder: "Email",
    form_sent_label: esc(L("Заявка отправлена", "Sent")),
    form_sent_short_label: esc(L("Отправлено", "Sent")),
    consent_line: esc(L(
      "Оставляя заявку, вы соглашаетесь на обработку персональных данных.",
      "By submitting the form you agree to the processing of personal data.",
    )),

    // section labels
    label_benefits: esc(L("Преимущества", "Benefits")),
    label_services: esc(L("Услуги", "Services")),
    label_process: esc(L("Процесс", "Process")),
    label_team: esc(L("Команда", "Team")),
    label_guarantee: esc(L("Гарантии", "Guarantee")),
    label_testimonials: esc(L("Отзывы", "Testimonials")),
    label_blog: esc(L("Блог", "Blog")),
    label_about: esc(L("О нас", "About")),
    label_contacts: esc(L("Контакты", "Contacts")),
    label_address: esc(L("Адрес", "Address")),
    label_phone: esc(L("Телефон", "Phone")),
    label_hours: esc(L("Режим работы", "Hours")),
    label_more_about: esc(L("Подробнее о компании", "More about us")),
    title_services: esc(L("Наши услуги и пакеты", "Our services & packages")),
    subtitle_services: esc(L(
      "Выберите подходящий вариант или закажите индивидуальный расчет.",
      "Choose a package or request a custom quote.",
    )),
    title_process: esc(L("Как мы работаем", "How we work")),
    title_team: esc(L("Наша команда", "Meet our team")),
    title_testimonials: esc(L("Отзывы наших клиентов", "What clients say")),
    title_contacts: esc(L("Свяжитесь с нами", "Get in touch")),

    // content sections
    why_title: esc(c.whyTitle),
    why_text: esc(c.whyText),
    why_image: slotImage(ctx, "why", `${ctx.topic} professional work`, 800, 600),
    guarantee_title: esc(c.guaranteeTitle),
    guarantee_text: esc(c.guaranteeText),
    guarantee_image: slotImage(ctx, "guarantee", `${ctx.topic} quality guarantee`, 800, 600),
    blog_title: esc(c.blogTitle),
    blog_empty_text: posts.length
      ? ""
      : `<p class="muted">${esc(L("Скоро здесь появятся новые материалы.", "Posts coming soon."))}</p>`,
    about_title: esc(c.aboutShortTitle),
    about_text: esc(c.aboutShortText),
    about_image: slotImage(ctx, "about", `${ctx.topic} office team`, 800, 600),
    cta_section_title: esc(c.ctaSectionTitle),
    cta_section_text: esc(c.ctaSectionText),
    map_src: "https://www.openstreetmap.org/export/embed.html?bbox=37.5%2C55.6%2C37.8%2C55.8&layer=mapnik",

    // contacts
    phone: esc(c.phone),
    phone_href: esc((c.phone || "").replace(/[^+\d]/g, "")),
    email: esc(c.email),
    address: esc(c.address),
    work_hours: esc(c.workHours),

    // repeatable blocks
    stats, features, services, process, team, testimonials, posts,
    guarantee_bullets: (c.guaranteeBullets || []).map((b) => ({ text: esc(b) })),
  };
}
