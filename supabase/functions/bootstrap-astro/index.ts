import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXPERTS = [
  { name: "Алексей Петров", bio: "SEO-эксперт с 12-летним стажем. Работал с крупнейшими e-commerce проектами Рунета.", avatar: "AP" },
  { name: "Мария Козлова", bio: "Специалист по контент-маркетингу и поисковой оптимизации. Автор курса «SEO для бизнеса».", avatar: "MK" },
  { name: "Дмитрий Волков", bio: "Технический SEO-консультант. Помог 200+ компаниям увеличить органический трафик.", avatar: "DV" },
  { name: "Елена Смирнова", bio: "Руководитель отдела контента в digital-агентстве. 8 лет в SEO и копирайтинге.", avatar: "ES" },
  { name: "Иван Новиков", bio: "Аналитик поисковых систем, эксперт Google и Яндекс. Спикер профильных конференций.", avatar: "IN" },
];

const WELCOME_ARTICLE = `---
title: "Добро пожаловать на блог"
description: "Первая статья вашего нового SEO-блога, созданного с помощью СЕО-Модуля"
pubDate: "${new Date().toISOString().split("T")[0]}"
keywords: ["блог", "seo", "старт"]
author: "${EXPERTS[0].name}"
---

# Добро пожаловать!

Это ваш новый SEO-блог, автоматически созданный с помощью платформы **СЕО-Модуль**.

## Как это работает

Все статьи публикуются автоматически через Фабрику сайтов. Вам достаточно:

1. Ввести ключевые слова
2. Нажать "Запустить генерацию"
3. Опубликовать готовую статью одним кликом

## Преимущества платформы

| Функция | Описание |
|---------|----------|
| AI-генерация | Уникальные статьи за минуты |
| SEO-оптимизация | Автоматический анализ ключевых слов |
| Публикация | Один клик для деплоя на сайт |

> Сайт обновится автоматически после каждой публикации.
`;

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "seo-factor-blog",
    type: "module",
    version: "1.0.0",
    scripts: {
      dev: "astro dev",
      start: "astro dev",
      build: "astro build",
      preview: "astro preview",
      astro: "astro"
    },
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
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
      },
      colors: {
        neutral: {
          925: '#121212',
          950: '#0a0a0a',
        },
      },
      maxWidth: {
        article: '48rem',
      },
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            '--tw-prose-headings': theme('colors.neutral.900'),
            '--tw-prose-body': theme('colors.neutral.600'),
            '--tw-prose-links': theme('colors.neutral.900'),
            maxWidth: 'none',
            fontSize: '1.0625rem',
            lineHeight: '1.8',
            h1: { fontWeight: '800', letterSpacing: '-0.04em', lineHeight: '1.1', fontSize: '2.25rem' },
            h2: { fontWeight: '700', letterSpacing: '-0.025em', marginTop: '2.5em', marginBottom: '0.75em', fontSize: '1.5rem', paddingBottom: '0.5em', borderBottom: '1px solid ' + theme('colors.neutral.100') },
            h3: { fontWeight: '600', marginTop: '2em', fontSize: '1.2rem', letterSpacing: '-0.01em' },
            p: { marginTop: '1.25em', marginBottom: '1.25em' },
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
            code: {
              backgroundColor: theme('colors.neutral.100'),
              color: theme('colors.neutral.800'),
              padding: '0.2em 0.4em',
              borderRadius: '0.375rem',
              fontSize: '0.875em',
              fontWeight: '500',
            },
            blockquote: {
              borderLeftWidth: '3px',
              borderLeftColor: theme('colors.neutral.200'),
              padding: '0 0 0 1.25rem',
              fontStyle: 'normal',
              color: theme('colors.neutral.500'),
              fontSize: '1.0625rem',
            },
            'blockquote p:first-of-type::before': { content: 'none' },
            'blockquote p:last-of-type::after': { content: 'none' },
            table: {
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.9375rem',
            },
            thead: {
              borderBottom: '2px solid ' + theme('colors.neutral.200'),
            },
            'thead th': {
              padding: '0.75rem 1rem',
              fontWeight: '600',
              fontSize: '0.8125rem',
              color: theme('colors.neutral.500'),
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            },
            'tbody td': {
              padding: '0.75rem 1rem',
              borderBottom: '1px solid ' + theme('colors.neutral.100'),
            },
            'tbody tr:last-child td': { borderBottom: 'none' },
            img: {
              borderRadius: '1.5rem',
              boxShadow: '0 8px 30px -6px rgb(0 0 0 / 0.08)',
            },
            hr: { borderColor: theme('colors.neutral.150'), marginTop: '3em', marginBottom: '3em' },
            a: {
              color: theme('colors.neutral.900'),
              textDecoration: 'underline',
              textDecorationColor: theme('colors.neutral.300'),
              textUnderlineOffset: '3px',
              transition: 'text-decoration-color 0.2s',
            },
            'a:hover': {
              textDecorationColor: theme('colors.neutral.900'),
            },
            'ul > li::marker': { color: theme('colors.neutral.400') },
            'ol > li::marker': { color: theme('colors.neutral.500'), fontWeight: '600' },
            strong: { color: theme('colors.neutral.900'), fontWeight: '600' },
          },
        },
      }),
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
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
const { title, description = 'Экспертный блог', jsonLd } = Astro.props;
const currentPath = Astro.url.pathname;
const siteName = 'SEO-Factor';
const siteCopyright = siteName;
---
<!doctype html>
<html lang="ru" class="scroll-smooth">
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
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  {jsonLd && <script type="application/ld+json" set:html={jsonLd} />}
  <title>{title} - {siteName}</title>
  <style>
    #reading-progress {
      position: fixed; top: 0; left: 0; height: 2px; z-index: 9999;
      background: #000;
      transition: width 0.1s linear; width: 0%;
    }
    .toc-link.active {
      color: #000;
      font-weight: 600;
    }
  </style>
</head>
<body class="font-sans bg-white text-neutral-900 antialiased min-h-screen flex flex-col">
  <!-- Reading Progress -->
  <div id="reading-progress"></div>

  <!-- Header -->
  <header class="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-neutral-100">
    <nav class="max-w-screen-xl mx-auto px-6 h-14 flex items-center justify-between">
      <a href="/" class="text-lg font-extrabold tracking-tight text-neutral-900 hover:opacity-70 transition-opacity">
        {siteName}
      </a>
      <div class="flex items-center gap-8">
        <a href="/"
          class:list={[
            "text-[13px] font-medium tracking-wide uppercase transition-colors",
            currentPath === "/" ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-600"
          ]}>
          Блог
        </a>
        <a href="/"
          class:list={[
            "text-[13px] font-medium tracking-wide uppercase transition-colors",
            "text-neutral-400 hover:text-neutral-600"
          ]}>
          Статьи
        </a>
      </div>
    </nav>
  </header>

  <!-- Main -->
  <main class="flex-1 w-full">
    <slot />
  </main>

  <!-- Footer -->
  <footer class="border-t border-neutral-100">
    <div class="max-w-screen-xl mx-auto px-6 py-12">
      <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
        <span class="text-sm font-semibold text-neutral-900">{siteName}</span>
        <p class="text-xs text-neutral-400">
          &copy; {new Date().getFullYear()} {siteCopyright}. Создано с помощью
          <a href="https://seo-modul.pro" target="_blank" rel="noopener" class="text-neutral-500 hover:text-neutral-900 transition-colors underline underline-offset-2">СЕО-Модуля</a>.
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
const siteName = 'SEO-Factor';
const siteAbout = 'Авторские статьи по SEO, маркетингу и продвижению - написаны экспертами, проверены практикой.';
---
<Layout title={siteName} description={siteAbout}>
  <div class="max-w-screen-xl mx-auto px-6 py-20">
    <!-- Hero -->
    <div class="max-w-2xl mb-16">
      <h1 class="text-5xl sm:text-6xl font-extrabold tracking-tight text-neutral-900 leading-[1.05]">
        {siteName}
      </h1>
      <p class="text-lg text-neutral-500 mt-5 leading-relaxed">
        {siteAbout}
      </p>
    </div>

    {posts.length === 0 && (
      <div class="text-center py-24">
        <p class="text-neutral-400 text-lg">Статьи пока не опубликованы</p>
      </div>
    )}

    <!-- Articles Grid -->
    <div class="grid gap-px bg-neutral-100 border border-neutral-100 rounded-2xl overflow-hidden">
      {posts.map((post, idx) => {
        const pubDate = post.data.pubDate || post.data.date;
        const kw = (post.data.keywords || [])[0] || 'article';
        const heroSrc = post.data.heroImage || \`https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&h=400&fit=crop&q=80\`;
        return (
          <a href={\`/blog/\${post.id}/\`}
            class="group flex flex-col sm:flex-row bg-white transition-colors hover:bg-neutral-50">
            <!-- Thumbnail -->
            <div class="sm:w-72 shrink-0 overflow-hidden">
              <img
                src={heroSrc}
                alt={post.data.title}
                class="w-full h-48 sm:h-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
            </div>
            <!-- Content -->
            <div class="flex-1 p-6 sm:p-8 flex flex-col justify-center">
              <div class="flex items-center gap-3 mb-3">
                {pubDate && (
                  <time class="text-xs text-neutral-400 tabular-nums uppercase tracking-wider">
                    {new Date(pubDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </time>
                )}
                {post.data.author && (
                  <span class="text-xs text-neutral-400">-  {post.data.author}</span>
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
                  Читать далее &rarr;
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
  ? new Date(pubDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  : null;

// Reading time estimate
const wordCount = post.body ? post.body.split(/\\s+/).length : 0;
const readingTime = Math.max(1, Math.ceil(wordCount / 200));

// Expert author
const experts = [
  { name: "Алексей Петров", bio: "SEO-эксперт с 12-летним стажем", initials: "АП" },
  { name: "Мария Козлова", bio: "Специалист по контент-маркетингу", initials: "МК" },
  { name: "Дмитрий Волков", bio: "Технический SEO-консультант", initials: "ДВ" },
  { name: "Елена Смирнова", bio: "Руководитель отдела контента", initials: "ЕС" },
  { name: "Иван Новиков", bio: "Аналитик поисковых систем", initials: "ИН" },
];

const authorName = post.data.author || experts[0].name;
const expert = experts.find(e => e.name === authorName) || experts[Math.floor(post.id.length % experts.length)];

// TOC
const tocItems = headings.filter(h => h.depth === 2);
const hasToc = tocItems.length >= 3;

// Unsplash fallback cover
const kw = (post.data.keywords || [])[0] || 'technology';
const heroImage = post.data.heroImage || \`https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=1200&h=600&fit=crop&q=80\`;

// JSON-LD
const jsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": post.data.title,
  "description": post.data.description || "",
  "datePublished": pubDate || new Date().toISOString(),
  "dateModified": pubDate || new Date().toISOString(),
  "author": { "@type": "Person", "name": expert.name },
  "publisher": { "@type": "Organization", "name": "SEO-Factor" },
  "keywords": (post.data.keywords || []).join(", "),
  "mainEntityOfPage": { "@type": "WebPage", "@id": Astro.url.href },
});
---
<Layout title={post.data.title} description={post.data.description} jsonLd={jsonLd}>
  <article>
    <!-- Hero Section -->
    <div class="max-w-article mx-auto px-6 pt-16 pb-8">
      <!-- Back link -->
      <a href="/" class="inline-flex items-center gap-1 text-[13px] text-neutral-400 hover:text-neutral-900 transition-colors mb-10 uppercase tracking-wider font-medium">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Все статьи
      </a>

      <!-- Title -->
      <h1 class="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-[-0.04em] text-neutral-900 leading-[1.08]">
        {post.data.title}
      </h1>

      <!-- Meta line -->
      <div class="flex flex-wrap items-center gap-4 mt-6 pb-8 border-b border-neutral-100">
        <span class="text-sm text-neutral-400">{expert.name}</span>
        {formattedDate && (
          <span class="text-sm text-neutral-300">{formattedDate}</span>
        )}
        <span class="text-sm text-neutral-300">{readingTime} мин чтения</span>
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

    <!-- Cover Image -->
    <div class="max-w-screen-lg mx-auto px-6 mb-12">
      <img
        src={heroImage}
        alt={post.data.title}
        class="w-full aspect-[2/1] object-cover rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)]"
        loading="eager"
      />
    </div>

    <!-- Content Area with optional TOC -->
    <div class="max-w-screen-xl mx-auto px-6 pb-20">
      <div class={\`flex gap-16 \${hasToc ? 'lg:flex-row' : ''} flex-col\`}>

        <!-- TOC Sidebar -->
        {hasToc && (
          <aside class="hidden lg:block w-56 shrink-0 order-first">
            <nav class="sticky top-20">
              <p class="text-[11px] font-semibold text-neutral-400 uppercase tracking-[0.15em] mb-4">Содержание</p>
              <ul class="space-y-2.5 border-l border-neutral-100 pl-4">
                {tocItems.map((item, i) => (
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

        <!-- Main content -->
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

          <!-- Author Block -->
          <div class="mt-16 pt-8 border-t border-neutral-100">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 rounded-full bg-neutral-900 flex items-center justify-center shrink-0">
                <span class="text-sm font-semibold text-white">{expert.initials}</span>
              </div>
              <div>
                <p class="text-sm font-semibold text-neutral-900">{expert.name}</p>
                <p class="text-xs text-neutral-400">Expert Reviewer</p>
              </div>
            </div>
          </div>

          <!-- Back -->
          <div class="mt-10 pt-8 border-t border-neutral-100">
            <a href="/" class="inline-flex items-center gap-2 text-sm font-medium text-neutral-400 hover:text-neutral-900 transition-colors uppercase tracking-wider">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Все статьи
            </a>
          </div>
        </div>
      </div>
    </div>
  </article>

  <!-- TOC highlight script -->
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

  "src/content/blog/dobro-pozhalovat.md": WELCOME_ARTICLE,
};

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

    const { project_id, action, site_name, site_copyright, site_about } = await req.json();
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

    // Apply dynamic site config
    const sName = site_name || "SEO-Factor";
    const sCopyright = site_copyright || sName;
    const sAbout = site_about || "Авторские статьи по SEO, маркетингу и продвижению - написаны экспертами, проверены практикой.";

    const dynamicFiles: Record<string, string> = {};
    for (const [path, content] of Object.entries(FILES)) {
      dynamicFiles[path] = content
        .replace(/const siteName = 'SEO-Factor';/g, `const siteName = '${sName.replace(/'/g, "\\'")}';`)
        .replace(/const siteCopyright = siteName;/g, `const siteCopyright = '${sCopyright.replace(/'/g, "\\'")}';`)
        .replace(/"publisher": \{ "@type": "Organization", "name": "SEO-Factor" \}/g, `"publisher": { "@type": "Organization", "name": "${sName}" }`)
        .replace(/Авторские статьи по SEO, маркетингу и продвижению - написаны экспертами, проверены практикой\./g, sAbout);
    }

    const results: { file: string; status: string }[] = [];

    for (const [filePath, content] of Object.entries(dynamicFiles)) {
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
