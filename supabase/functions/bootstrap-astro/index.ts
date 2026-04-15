import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── i18n ────────────────────────────────────────────────────────────
interface I18n {
  htmlLang: string;
  dateLocale: string;
  nav: { blog: string; about: string; contacts: string };
  toc: string;
  readMore: string;
  allArticles: string;
  backToBlog: string;
  noPosts: string;
  minRead: string;
  aboutAuthor: string;
  expertReviewer: string;
  madeWith: string;
  aboutPageTitle: string;
  aboutPageContent: string;
  contactsPageTitle: string;
  contactsPageContent: string;
  welcomeTitle: string;
  welcomeDesc: string;
  publishedOn: string;
  author: string;
  relatedPosts: string;
  ourBlog: string;
  formName: string;
  formMessage: string;
  formSend: string;
  formSent: string;
}

const i18nMap: Record<string, I18n> = {
  ru: {
    htmlLang: "ru",
    dateLocale: "ru-RU",
    nav: { blog: "Блог", about: "О нас", contacts: "Контакты" },
    toc: "Содержание",
    readMore: "Читать далее",
    allArticles: "Все статьи",
    backToBlog: "Назад в блог",
    noPosts: "Статьи пока не опубликованы",
    minRead: "мин чтения",
    aboutAuthor: "Об авторе",
    expertReviewer: "Эксперт-рецензент",
    madeWith: "Создано с помощью",
    aboutPageTitle: "О нас",
    aboutPageContent: "Мы — команда экспертов, которая помогает бизнесу расти через качественный контент и SEO-оптимизацию.",
    contactsPageTitle: "Контакты",
    contactsPageContent: "Свяжитесь с нами для сотрудничества или по любым вопросам.",
    welcomeTitle: "Добро пожаловать на блог",
    welcomeDesc: "Первая статья вашего нового блога",
    publishedOn: "Опубликовано",
    author: "Автор",
    relatedPosts: "Похожие статьи",
    ourBlog: "Наш блог",
    formName: "Имя",
    formMessage: "Сообщение",
    formSend: "Отправить",
    formSent: "Сообщение отправлено! Мы свяжемся с вами в ближайшее время.",
  },
  en: {
    htmlLang: "en",
    dateLocale: "en-US",
    nav: { blog: "Blog", about: "About", contacts: "Contacts" },
    toc: "Table of Contents",
    readMore: "Read more",
    allArticles: "All articles",
    backToBlog: "Back to blog",
    noPosts: "No articles published yet",
    minRead: "min read",
    aboutAuthor: "About the author",
    expertReviewer: "Expert Reviewer",
    madeWith: "Powered by",
    aboutPageTitle: "About Us",
    aboutPageContent: "We are a team of experts helping businesses grow through quality content and SEO optimization.",
    contactsPageTitle: "Contacts",
    contactsPageContent: "Get in touch with us for collaboration or any questions.",
    welcomeTitle: "Welcome to our blog",
    welcomeDesc: "The first article of your new blog",
    publishedOn: "Published on",
    author: "Author",
    relatedPosts: "Related Posts",
    ourBlog: "Our Blog",
    formName: "Name",
    formMessage: "Message",
    formSend: "Send message",
    formSent: "Message sent! We will get back to you soon.",
  },
  de: {
    htmlLang: "de",
    dateLocale: "de-DE",
    nav: { blog: "Blog", about: "Über uns", contacts: "Kontakt" },
    toc: "Inhaltsverzeichnis",
    readMore: "Weiterlesen",
    allArticles: "Alle Artikel",
    backToBlog: "Zurück zum Blog",
    noPosts: "Noch keine Artikel veröffentlicht",
    minRead: "Min. Lesezeit",
    aboutAuthor: "Über den Autor",
    expertReviewer: "Fachgutachter",
    madeWith: "Erstellt mit",
    aboutPageTitle: "Über uns",
    aboutPageContent: "Wir sind ein Expertenteam, das Unternehmen durch hochwertigen Content und SEO-Optimierung zum Wachstum verhilft.",
    contactsPageTitle: "Kontakt",
    contactsPageContent: "Kontaktieren Sie uns für Zusammenarbeit oder Fragen.",
    welcomeTitle: "Willkommen im Blog",
    welcomeDesc: "Der erste Artikel Ihres neuen Blogs",
    publishedOn: "Veröffentlicht am",
    author: "Autor",
    relatedPosts: "Ähnliche Artikel",
    ourBlog: "Unser Blog",
    formName: "Name",
    formMessage: "Nachricht",
    formSend: "Senden",
    formSent: "Nachricht gesendet! Wir melden uns in Kürze.",
  },
  fr: {
    htmlLang: "fr",
    dateLocale: "fr-FR",
    nav: { blog: "Blog", about: "À propos", contacts: "Contact" },
    toc: "Sommaire",
    readMore: "Lire la suite",
    allArticles: "Tous les articles",
    backToBlog: "Retour au blog",
    noPosts: "Aucun article publié pour le moment",
    minRead: "min de lecture",
    aboutAuthor: "À propos de l'auteur",
    expertReviewer: "Expert Reviewer",
    madeWith: "Propulsé par",
    aboutPageTitle: "À propos",
    aboutPageContent: "Nous sommes une équipe d'experts qui aide les entreprises à croître grâce au contenu de qualité et au SEO.",
    contactsPageTitle: "Contact",
    contactsPageContent: "Contactez-nous pour toute collaboration ou question.",
    welcomeTitle: "Bienvenue sur le blog",
    welcomeDesc: "Le premier article de votre nouveau blog",
    publishedOn: "Publié le",
    author: "Auteur",
    relatedPosts: "Articles similaires",
    ourBlog: "Notre Blog",
    formName: "Nom",
    formMessage: "Message",
    formSend: "Envoyer",
    formSent: "Message envoyé ! Nous vous répondrons rapidement.",
  },
  es: {
    htmlLang: "es",
    dateLocale: "es-ES",
    nav: { blog: "Blog", about: "Sobre nosotros", contacts: "Contacto" },
    toc: "Tabla de contenidos",
    readMore: "Leer más",
    allArticles: "Todos los artículos",
    backToBlog: "Volver al blog",
    noPosts: "No hay artículos publicados aún",
    minRead: "min de lectura",
    aboutAuthor: "Sobre el autor",
    expertReviewer: "Revisor experto",
    madeWith: "Creado con",
    aboutPageTitle: "Sobre nosotros",
    aboutPageContent: "Somos un equipo de expertos que ayuda a las empresas a crecer a través de contenido de calidad y optimización SEO.",
    contactsPageTitle: "Contacto",
    contactsPageContent: "Contáctenos para colaboración o cualquier pregunta.",
    welcomeTitle: "Bienvenido al blog",
    welcomeDesc: "El primer artículo de tu nuevo blog",
    publishedOn: "Publicado el",
    author: "Autor",
    relatedPosts: "Artículos relacionados",
    ourBlog: "Nuestro Blog",
    formName: "Nombre",
    formMessage: "Mensaje",
    formSend: "Enviar",
    formSent: "¡Mensaje enviado! Nos pondremos en contacto pronto.",
  },
};

function getI18n(lang: string): I18n {
  return i18nMap[lang] || i18nMap["en"];
}

// ─── File generators ─────────────────────────────────────────────────

// ─── Font pair configs ───────────────────────────────────────────────
interface FontConfig { heading: string; body: string; googleUrl: string; cssFamilyHeading: string; cssFamilyBody: string }

const FONT_CONFIGS: Record<string, FontConfig> = {
  inter: {
    heading: "Inter", body: "Inter",
    googleUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap",
    cssFamilyHeading: "'Inter', system-ui, -apple-system, sans-serif",
    cssFamilyBody: "'Inter', system-ui, -apple-system, sans-serif",
  },
  geist: {
    heading: "Geist", body: "Geist",
    googleUrl: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800;900&display=swap",
    cssFamilyHeading: "'Geist', system-ui, sans-serif",
    cssFamilyBody: "'Geist', system-ui, sans-serif",
  },
  roboto: {
    heading: "Roboto", body: "Roboto",
    googleUrl: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap",
    cssFamilyHeading: "'Roboto', system-ui, sans-serif",
    cssFamilyBody: "'Roboto', system-ui, sans-serif",
  },
  playfair: {
    heading: "Playfair Display", body: "Inter",
    googleUrl: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap",
    cssFamilyHeading: "'Playfair Display', Georgia, serif",
    cssFamilyBody: "'Inter', system-ui, sans-serif",
  },
  merriweather: {
    heading: "Merriweather", body: "Open Sans",
    googleUrl: "https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700;900&family=Open+Sans:wght@400;500;600;700&display=swap",
    cssFamilyHeading: "'Merriweather', Georgia, serif",
    cssFamilyBody: "'Open Sans', system-ui, sans-serif",
  },
};

function getFontConfig(pair: string): FontConfig {
  return FONT_CONFIGS[pair] || FONT_CONFIGS["inter"];
}

// ─── File generators ─────────────────────────────────────────────────

function generateFiles(
  lang: string,
  siteName: string,
  siteAbout: string,
  siteCopyright: string,
  authorName: string,
  authorBio: string,
  authorAvatar: string,
  primaryColor: string,
  fontPair: string,
): Record<string, string> {
  const i = getI18n(lang);
  const font = getFontConfig(fontPair);
  const color = primaryColor || "#6366f1";
  const authorDisplay = authorName || "Expert";
  const authorBioText = authorBio || "";
  const authorAvatarUrl = authorAvatar || "";

  // Generate random layout variation
  const authorAlign = Math.random() > 0.5 ? "items-center text-center" : "items-start";
  const heroSpacing = Math.random() > 0.5 ? "py-20" : "py-24";

  const WELCOME_ARTICLE = `---
title: "${i.welcomeTitle}"
description: "${i.welcomeDesc}"
pubDate: "${new Date().toISOString().split("T")[0]}"
keywords: ["blog", "seo"]
author: "${authorDisplay}"
---

# ${i.welcomeTitle}

${i.welcomeDesc}.
`;

  return {
    "package.json": JSON.stringify({
      name: "seo-factor-blog",
      type: "module",
      version: "1.0.0",
      scripts: { dev: "astro dev", start: "astro dev", build: "astro build", preview: "astro preview", astro: "astro" },
      dependencies: {
        "astro": "^5.9.3",
        "@astrojs/tailwind": "^6.0.2",
        "tailwindcss": "^3.4.17",
        "@tailwindcss/typography": "^0.5.16"
      }
    }, null, 2),

    "astro.config.mjs": `import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  integrations: [tailwind()],
});
`,

    "tailwind.config.mjs": `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        accent: '${color}',
      },
      fontFamily: {
        heading: [${font.cssFamilyHeading.split(',').map(f => f.trim()).map(f => f.startsWith("'") ? f : `'${f}'`).join(', ')}],
        sans: [${font.cssFamilyBody.split(',').map(f => f.trim()).map(f => f.startsWith("'") ? f : `'${f}'`).join(', ')}],
      },
      maxWidth: { article: '48rem' },
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            '--tw-prose-headings': theme('colors.neutral.900'),
            '--tw-prose-body': theme('colors.neutral.600'),
            '--tw-prose-links': '${color}',
            maxWidth: 'none',
            fontSize: '1.0625rem',
            lineHeight: '1.8',
            h1: { fontFamily: theme('fontFamily.heading').join(', '), fontWeight: '800', letterSpacing: '-0.04em', lineHeight: '1.1', fontSize: '2.25rem' },
            h2: { fontFamily: theme('fontFamily.heading').join(', '), fontWeight: '700', letterSpacing: '-0.025em', marginTop: '2.5em', marginBottom: '0.75em', fontSize: '1.5rem', paddingBottom: '0.5em', borderBottom: '1px solid ' + theme('colors.neutral.100') },
            h3: { fontFamily: theme('fontFamily.heading').join(', '), fontWeight: '600', marginTop: '2em', fontSize: '1.2rem' },
            p: { marginTop: '1.25em', marginBottom: '1.25em' },
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
            code: { backgroundColor: theme('colors.neutral.100'), color: theme('colors.neutral.800'), padding: '0.2em 0.4em', borderRadius: '0.375rem', fontSize: '0.875em', fontWeight: '500' },
            blockquote: { borderLeftWidth: '3px', borderLeftColor: '${color}33', padding: '0 0 0 1.25rem', fontStyle: 'normal', color: theme('colors.neutral.500') },
            'blockquote p:first-of-type::before': { content: 'none' },
            'blockquote p:last-of-type::after': { content: 'none' },
            table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9375rem' },
            thead: { borderBottom: '2px solid ' + theme('colors.neutral.200') },
            'thead th': { padding: '0.75rem 1rem', fontWeight: '600', fontSize: '0.8125rem', color: theme('colors.neutral.500'), textTransform: 'uppercase', letterSpacing: '0.05em' },
            'tbody td': { padding: '0.75rem 1rem', borderBottom: '1px solid ' + theme('colors.neutral.100') },
            'tbody tr:last-child td': { borderBottom: 'none' },
            img: { borderRadius: '1.5rem', boxShadow: '0 8px 30px -6px rgb(0 0 0 / 0.08)' },
            a: { color: '${color}', textDecoration: 'underline', textDecorationColor: '${color}44', textUnderlineOffset: '3px', transition: 'text-decoration-color 0.2s' },
            'a:hover': { textDecorationColor: '${color}' },
            'ul > li::marker': { color: theme('colors.neutral.400') },
            'ol > li::marker': { color: theme('colors.neutral.500'), fontWeight: '600' },
            strong: { color: theme('colors.neutral.900'), fontWeight: '600' },
          },
        },
      }),
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
`,

    "tsconfig.json": JSON.stringify({ extends: "astro/tsconfigs/strict" }, null, 2),

    "src/content.config.ts": `import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    pubDate: z.string().optional(),
    date: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    heroImage: z.string().optional(),
    author: z.string().optional(),
  }),
});

export const collections = { blog };
`,

    "src/layouts/Layout.astro": `---
interface Props {
  title: string;
  description?: string;
  jsonLd?: string;
}
const { title, description = '${siteAbout}', jsonLd } = Astro.props;
const currentPath = Astro.url.pathname;
const siteName = '${siteName}';
const siteCopyright = '${siteCopyright}';
---
<!doctype html>
<html lang="${i.htmlLang}" class="scroll-smooth">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content={description} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:type" content="article" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="${font.googleUrl}" rel="stylesheet" />
  {jsonLd && <script type="application/ld+json" set:html={jsonLd} />}
  <title>{title} - {siteName}</title>
  <style>
    #reading-progress {
      position: fixed; top: 0; left: 0; height: 2px; z-index: 9999;
      background: ${color};
      transition: width 0.1s linear; width: 0%;
    }
    .toc-link.active { color: ${color}; font-weight: 600; }
  </style>
</head>
<body class="font-sans bg-white text-neutral-900 antialiased min-h-screen flex flex-col">
  <div id="reading-progress"></div>

  <header class="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-neutral-100">
    <nav class="max-w-screen-xl mx-auto px-6 h-14 flex items-center justify-between">
      <a href="/" class="text-lg font-extrabold tracking-tight text-neutral-900 hover:opacity-70 transition-opacity">
        {siteName}
      </a>
      <div class="flex items-center gap-8">
        <a href="/" class:list={["text-[13px] font-medium tracking-wide uppercase transition-colors", currentPath === "/" ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-600"]}>
          ${i.nav.blog}
        </a>
        <a href="/about/" class:list={["text-[13px] font-medium tracking-wide uppercase transition-colors", currentPath.startsWith("/about") ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-600"]}>
          ${i.nav.about}
        </a>
        <a href="/contacts/" class:list={["text-[13px] font-medium tracking-wide uppercase transition-colors", currentPath.startsWith("/contacts") ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-600"]}>
          ${i.nav.contacts}
        </a>
      </div>
    </nav>
  </header>

  <main class="flex-1 w-full">
    <slot />
  </main>

  <footer class="border-t border-neutral-100">
    <div class="max-w-screen-xl mx-auto px-6 py-12">
      <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
        <span class="text-sm font-semibold text-neutral-900">{siteName}</span>
        <p class="text-xs text-neutral-400">
          &copy; {new Date().getFullYear()} {siteCopyright}. ${i.madeWith}
          <a href="https://seo-modul.pro" target="_blank" rel="noopener" class="text-neutral-500 hover:text-neutral-900 transition-colors underline underline-offset-2">SEO-Module</a>.
        </p>
      </div>
    </div>
  </footer>

  <script>
    const bar = document.getElementById('reading-progress');
    if (bar) {
      window.addEventListener('scroll', () => {
        const h = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.width = h > 0 ? (window.scrollY / h * 100) + '%' : '0%';
      }, { passive: true });
    }
  </script>
</body>
</html>
`,

    "src/pages/index.astro": `---
import Layout from '../layouts/Layout.astro';
import { getCollection } from 'astro:content';

const posts = (await getCollection('blog')).sort(
  (a, b) => new Date(b.data.pubDate || b.data.date || 0).getTime() - new Date(a.data.pubDate || a.data.date || 0).getTime()
);
const siteName = '${siteName}';
const siteAbout = '${siteAbout}';
---
<Layout title={"${i.ourBlog} — " + siteName} description={siteAbout}>
  <div class="max-w-screen-xl mx-auto px-6 py-20">
    <div class="max-w-2xl mb-16">
      <h1 class="text-5xl sm:text-6xl font-extrabold tracking-tight text-neutral-900 leading-[1.05]">
        ${i.ourBlog}
      </h1>
      <p class="text-lg text-neutral-500 mt-5 leading-relaxed">
        {siteAbout}
      </p>
    </div>

    {posts.length === 0 && (
      <div class="text-center py-24">
        <p class="text-neutral-400 text-lg">${i.noPosts}</p>
      </div>
    )}

    <div class="grid gap-px bg-neutral-100 border border-neutral-100 rounded-2xl overflow-hidden">
      {posts.map((post) => {
        const pubDate = post.data.pubDate || post.data.date;
        const heroSrc = post.data.heroImage || \`https://picsum.photos/seed/\${encodeURIComponent(post.data.title || post.id)}/800/400\`;
        return (
          <a href={\`/blog/\${post.id}/\`}
            class="group flex flex-col sm:flex-row bg-white transition-colors hover:bg-neutral-50">
            <div class="sm:w-72 shrink-0 overflow-hidden">
              <img src={heroSrc} alt={post.data.title} class="w-full h-48 sm:h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
            </div>
            <div class="flex-1 p-6 sm:p-8 flex flex-col justify-center">
              <div class="flex items-center gap-3 mb-3">
                {pubDate && (
                  <time class="text-xs text-neutral-400 tabular-nums uppercase tracking-wider">
                    {new Date(pubDate).toLocaleDateString('${i.dateLocale}', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </time>
                )}
                {post.data.author && (
                  <span class="text-xs text-neutral-400">— {post.data.author}</span>
                )}
              </div>
              <h2 class="text-xl font-bold text-neutral-900 group-hover:text-neutral-600 transition-colors leading-snug tracking-tight">
                {post.data.title}
              </h2>
              {post.data.description && (
                <p class="text-sm text-neutral-500 mt-2 line-clamp-2 leading-relaxed">{post.data.description}</p>
              )}
              <div class="mt-4">
                <span class="text-xs font-medium text-neutral-400 group-hover:text-neutral-900 transition-colors uppercase tracking-wider">
                  ${i.readMore} &rarr;
                </span>
              </div>
            </div>
          </a>
        );
      })}
    </div>
  </div>
</Layout>
`,

    "src/pages/about.astro": `---
import Layout from '../layouts/Layout.astro';
const siteName = '${siteName}';
const siteAbout = '${siteAbout}';
---
<Layout title="${i.aboutPageTitle}" description={siteAbout}>
  <div class="max-w-article mx-auto px-6 py-20">
    <h1 class="text-4xl sm:text-5xl font-extrabold tracking-tight text-neutral-900 leading-[1.08] mb-8">
      ${i.aboutPageTitle}
    </h1>
    <div class="prose prose-neutral prose-lg max-w-none">
      <p class="text-xl text-neutral-500 leading-relaxed mb-8">{siteAbout}</p>
      <p>${i.aboutPageContent}</p>
    </div>
  </div>
</Layout>
`,

    "src/pages/contacts.astro": `---
import Layout from '../layouts/Layout.astro';
const siteName = '${siteName}';
---
<Layout title="${i.contactsPageTitle}">
  <div class="max-w-article mx-auto px-6 py-20">
    <h1 class="text-4xl sm:text-5xl font-extrabold tracking-tight text-neutral-900 leading-[1.08] mb-8">
      ${i.contactsPageTitle}
    </h1>
    <div class="prose prose-neutral prose-lg max-w-none">
      <p>${i.contactsPageContent}</p>
    </div>

    <form id="contact-form" class="mt-10 space-y-5 max-w-lg">
      <div>
        <label for="name" class="block text-sm font-medium text-neutral-700 mb-1.5">${i.formName}</label>
        <input type="text" id="name" name="name" required
          class="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-400 transition-all" />
      </div>
      <div>
        <label for="email" class="block text-sm font-medium text-neutral-700 mb-1.5">Email</label>
        <input type="email" id="email" name="email" required
          class="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-400 transition-all"
          placeholder="email@example.com" />
      </div>
      <div>
        <label for="message" class="block text-sm font-medium text-neutral-700 mb-1.5">${i.formMessage}</label>
        <textarea id="message" name="message" rows="5" required
          class="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-400 transition-all resize-none"></textarea>
      </div>
      <button type="submit"
        class="w-full px-6 py-3 bg-neutral-900 text-white font-medium rounded-xl hover:bg-neutral-800 transition-colors">
        ${i.formSend}
      </button>
      <p id="form-status" class="text-sm text-center hidden"></p>
    </form>

    <script>
      document.getElementById('contact-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const status = document.getElementById('form-status');
        const btn = e.target.querySelector('button[type="submit"]');
        if (status && btn) {
          btn.disabled = true;
          btn.textContent = '...';
          setTimeout(() => {
            status.classList.remove('hidden');
            status.classList.add('text-green-600');
            status.textContent = '${i.formSent}';
            e.target.reset();
            btn.disabled = false;
            btn.textContent = '${i.formSend}';
          }, 1000);
        }
      });
    </script>
  </div>
</Layout>
`,

    "src/pages/blog/[...slug].astro": `---
import Layout from '../../layouts/Layout.astro';
import { getCollection, render } from 'astro:content';

export async function getStaticPaths() {
  const posts = await getCollection('blog');
  return posts.map((post) => ({
    params: { slug: post.id },
    props: { post },
  }));
}

const { post } = Astro.props;
const { Content, headings } = await render(post);

const pubDate = post.data.pubDate || post.data.date;
const formattedDate = pubDate
  ? new Date(pubDate).toLocaleDateString('${i.dateLocale}', { day: 'numeric', month: 'long', year: 'numeric' })
  : null;

const wordCount = post.body ? post.body.split(/\\s+/).length : 0;
const readingTime = Math.max(1, Math.ceil(wordCount / 200));

const authorName = post.data.author || 'Expert';
const initials = authorName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

const tocItems = headings.filter(h => h.depth === 2);
const hasToc = tocItems.length >= 3;

const kw = (post.data.keywords && post.data.keywords[0]) || post.data.title || 'business';
const heroImage = post.data.heroImage || \`https://picsum.photos/seed/\${encodeURIComponent(post.data.title || post.id)}/1200/600\`;

const jsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": post.data.title,
  "description": post.data.description || "",
  "datePublished": pubDate || new Date().toISOString(),
  "dateModified": pubDate || new Date().toISOString(),
  "author": { "@type": "Person", "name": authorName },
  "publisher": { "@type": "Organization", "name": "${siteName}" },
  "keywords": (post.data.keywords || []).join(", "),
  "mainEntityOfPage": { "@type": "WebPage", "@id": Astro.url.href },
});
---
<Layout title={post.data.title} description={post.data.description} jsonLd={jsonLd}>
  <article>
    <div class="max-w-article mx-auto px-6 pt-16 pb-8">
      <a href="/" class="inline-flex items-center gap-1 text-[13px] text-neutral-400 hover:text-neutral-900 transition-colors mb-10 uppercase tracking-wider font-medium">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        ${i.backToBlog}
      </a>

      <h1 class="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-[-0.04em] text-neutral-900 leading-[1.08]">
        {post.data.title}
      </h1>

      <div class="flex flex-wrap items-center gap-4 mt-6 pb-8 border-b border-neutral-100">
        <span class="text-sm text-neutral-400">${i.author}: {authorName}</span>
        {formattedDate && (
          <span class="text-sm text-neutral-300">${i.publishedOn} {formattedDate}</span>
        )}
        <span class="text-sm text-neutral-300">{readingTime} ${i.minRead}</span>
        {post.data.keywords && post.data.keywords.length > 0 && (
          <div class="flex gap-2 ml-auto">
            {post.data.keywords.slice(0, 3).map((kw: string) => (
              <span class="text-[11px] font-medium uppercase tracking-wider px-2.5 py-1 rounded-full border border-neutral-200 text-neutral-500">
                {kw}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>

    <div class="max-w-screen-lg mx-auto px-6 mb-12">
      <img src={heroImage} alt={post.data.title} class="w-full aspect-[2/1] object-cover rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)]" loading="eager" />
    </div>

    <div class="max-w-screen-xl mx-auto px-6 pb-20">
      <div class={\`flex gap-16 \${hasToc ? 'lg:flex-row' : ''} flex-col\`}>

        {hasToc && (
          <aside class="hidden lg:block w-56 shrink-0 order-first">
            <nav class="sticky top-20">
              <p class="text-[11px] font-semibold text-neutral-400 uppercase tracking-[0.15em] mb-4">${i.toc}</p>
              <ul class="space-y-2.5 border-l border-neutral-100 pl-4">
                {tocItems.map((item, idx) => (
                  <li>
                    <a href={\`#\${item.slug}\`} class="toc-link text-[13px] text-neutral-400 hover:text-neutral-900 transition-colors leading-snug block">
                      {item.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        )}

        <div class="flex-1 max-w-article mx-auto w-full">
          {post.data.description && (
            <p class="text-xl text-neutral-500 leading-relaxed mb-10 font-light">{post.data.description}</p>
          )}

          <div class="prose prose-neutral prose-lg max-w-none
            prose-headings:scroll-mt-24
            prose-a:text-neutral-900 prose-a:underline prose-a:decoration-neutral-300 prose-a:underline-offset-[3px] hover:prose-a:decoration-neutral-900
            prose-img:rounded-3xl prose-img:shadow-lg
            prose-pre:bg-neutral-950 prose-pre:rounded-2xl
            prose-code:text-neutral-800 prose-code:bg-neutral-100 prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:text-sm prose-code:font-medium prose-code:before:content-none prose-code:after:content-none
            prose-blockquote:border-l-neutral-200 prose-blockquote:not-italic prose-blockquote:text-neutral-500
            prose-strong:text-neutral-900 prose-strong:font-semibold
            prose-hr:border-neutral-100
            prose-li:marker:text-neutral-400
            prose-h2:border-b prose-h2:border-neutral-100 prose-h2:pb-3
          ">
            <Content />
          </div>

          <div class="mt-16 pt-8 border-t border-neutral-100">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 rounded-full bg-neutral-900 flex items-center justify-center shrink-0">
                <span class="text-sm font-semibold text-white">{initials}</span>
              </div>
              <div>
                <p class="text-sm font-semibold text-neutral-900">{authorName}</p>
                <p class="text-xs text-neutral-400">${i.expertReviewer}</p>
              </div>
            </div>
          </div>

          <div class="mt-10 pt-8 border-t border-neutral-100">
            <a href="/" class="inline-flex items-center gap-2 text-sm font-medium text-neutral-400 hover:text-neutral-900 transition-colors uppercase tracking-wider">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              ${i.backToBlog}
            </a>
          </div>
        </div>
      </div>
    </div>
  </article>

  <script>
    const tocLinks = document.querySelectorAll('.toc-link');
    if (tocLinks.length > 0) {
      const headings = Array.from(tocLinks).map(link => {
        const id = link.getAttribute('href')?.replace('#', '');
        return id ? document.getElementById(id) : null;
      }).filter(Boolean);

      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            tocLinks.forEach(l => l.classList.remove('active'));
            const activeLink = document.querySelector(\`.toc-link[href="#\${entry.target.id}"]\`);
            if (activeLink) activeLink.classList.add('active');
          }
        });
      }, { rootMargin: '-80px 0px -70% 0px' });

      headings.forEach(h => { if (h) observer.observe(h); });
    }
  </script>
</Layout>
`,

    "src/content/blog/welcome.md": WELCOME_ARTICLE,
  };
}

// ─── Server ──────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { project_id, action, site_name, site_copyright, site_about, language } = await req.json();
    if (!project_id) {
      return new Response(JSON.stringify({ error: "Missing project_id" }), { status: 400, headers: corsHeaders });
    }

    const { data: config } = await supabase.rpc("get_project_github_config", { p_project_id: project_id });
    if (!config || !config.configured) {
      return new Response(JSON.stringify({ error: "GitHub not configured" }), { status: 400, headers: corsHeaders });
    }

    const { github_token, github_repo } = config;

    // Action: check
    if (action === "check") {
      try {
        const checkRes = await fetch(`https://api.github.com/repos/${github_repo}/contents/package.json`, {
          headers: { Authorization: `token ${github_token}`, Accept: "application/vnd.github.v3+json" },
        });
        if (checkRes.ok) {
          return new Response(JSON.stringify({ status: "ready" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (checkRes.status === 404) {
          return new Response(JSON.stringify({ status: "empty" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ status: "error", message: `GitHub API ${checkRes.status}` }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ status: "error", message: String(e) }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Determine language from project record or param
    const { data: projData } = await supabase.from("projects").select("language").eq("id", project_id).single();
    const siteLang = language || projData?.language || "en";
    const sName = site_name || "Blog";
    const sCopyright = site_copyright || sName;
    const sAbout = site_about || "";

    const files = generateFiles(siteLang, sName, sAbout, sCopyright);

    const results: { file: string; status: string }[] = [];

    for (const [filePath, content] of Object.entries(files)) {
      try {
        const encoded = btoa(unescape(encodeURIComponent(content)));

        let sha: string | undefined;
        try {
          const checkRes = await fetch(`https://api.github.com/repos/${github_repo}/contents/${filePath}`, {
            headers: { Authorization: `token ${github_token}`, Accept: "application/vnd.github.v3+json" },
          });
          if (checkRes.ok) {
            const existing = await checkRes.json();
            sha = existing.sha;
          }
        } catch { /* doesn't exist */ }

        const body: Record<string, unknown> = {
          message: `[SEO-Module] ${sha ? 'Update' : 'Add'} ${filePath}`,
          content: encoded,
          branch: "main",
        };
        if (sha) body.sha = sha;

        const res = await fetch(`https://api.github.com/repos/${github_repo}/contents/${filePath}`, {
          method: "PUT",
          headers: {
            Authorization: `token ${github_token}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          results.push({ file: filePath, status: "ok" });
        } else {
          const errText = await res.text();
          console.error(`[bootstrap-astro] Failed ${filePath}:`, errText);
          results.push({ file: filePath, status: `error: ${res.status}` });
        }
      } catch (e) {
        console.error(`[bootstrap-astro] Exception ${filePath}:`, e);
        results.push({ file: filePath, status: `exception: ${String(e).substring(0, 100)}` });
      }
    }

    const allOk = results.every((r) => r.status === "ok");
    return new Response(JSON.stringify({ success: allOk, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("bootstrap-astro error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
