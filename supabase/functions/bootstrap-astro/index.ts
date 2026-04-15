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
      },
      colors: {
        brand: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            '--tw-prose-headings': theme('colors.gray.900'),
            '--tw-prose-body': theme('colors.gray.700'),
            '--tw-prose-links': theme('colors.violet.600'),
            maxWidth: 'none',
            h1: { fontWeight: '800', letterSpacing: '-0.03em', lineHeight: '1.1' },
            h2: { fontWeight: '700', letterSpacing: '-0.02em', marginTop: '2.5em', marginBottom: '0.8em', fontSize: '1.5em' },
            h3: { fontWeight: '600', marginTop: '2em', fontSize: '1.25em' },
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
            code: {
              backgroundColor: theme('colors.violet.50'),
              color: theme('colors.violet.700'),
              padding: '0.2em 0.4em',
              borderRadius: '0.375rem',
              fontSize: '0.875em',
              fontWeight: '500',
            },
            blockquote: {
              borderLeftWidth: '4px',
              borderLeftColor: theme('colors.violet.400'),
              backgroundColor: theme('colors.violet.50'),
              padding: '1.25rem 1.5rem',
              borderRadius: '0 0.75rem 0.75rem 0',
              fontStyle: 'normal',
              color: theme('colors.gray.700'),
            },
            'blockquote p:first-of-type::before': { content: 'none' },
            'blockquote p:last-of-type::after': { content: 'none' },
            table: {
              width: '100%',
              borderCollapse: 'separate',
              borderSpacing: '0',
              overflow: 'hidden',
              borderRadius: '1rem',
              boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
            },
            thead: {
              background: 'linear-gradient(135deg, ' + theme('colors.violet.600') + ', ' + theme('colors.purple.600') + ')',
            },
            'thead th': {
              padding: '0.875rem 1.25rem',
              fontWeight: '600',
              fontSize: '0.8rem',
              color: '#ffffff',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              borderBottom: 'none',
            },
            'tbody td': {
              padding: '0.875rem 1.25rem',
              borderBottom: '1px solid ' + theme('colors.gray.100'),
            },
            'tbody tr:last-child td': { borderBottom: 'none' },
            'tbody tr:nth-child(even)': { backgroundColor: theme('colors.gray.50') },
            'tbody tr': { transition: 'background-color 0.15s' },
            img: {
              borderRadius: '1rem',
              boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1)',
            },
            hr: { borderColor: theme('colors.gray.200'), marginTop: '3em', marginBottom: '3em' },
            a: {
              textDecoration: 'none',
              borderBottom: '1px solid ' + theme('colors.violet.200'),
              transition: 'border-color 0.2s, color 0.2s',
            },
            'a:hover': {
              borderBottomColor: theme('colors.violet.500'),
            },
            'ul > li::marker': { color: theme('colors.violet.400') },
            'ol > li::marker': { color: theme('colors.violet.500'), fontWeight: '600' },
            strong: { color: theme('colors.gray.900'), fontWeight: '700' },
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
const { title, description = 'SEO-блог — экспертные статьи', jsonLd } = Astro.props;
const currentPath = Astro.url.pathname;
const siteName = 'SEO-Factor';
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
  <title>{title} — {siteName}</title>
  <style>
    #reading-progress {
      position: fixed; top: 0; left: 0; height: 3px; z-index: 9999;
      background: linear-gradient(90deg, #8b5cf6, #a78bfa, #c084fc);
      transition: width 0.1s linear; width: 0%;
      box-shadow: 0 0 8px rgba(139,92,246,0.5);
    }
  </style>
</head>
<body class="font-sans bg-gray-50 text-gray-900 antialiased min-h-screen flex flex-col">
  <!-- Reading Progress -->
  <div id="reading-progress"></div>

  <!-- Glassmorphism Header -->
  <header class="sticky top-0 z-50 bg-white/70 backdrop-blur-xl border-b border-gray-200/50 shadow-sm">
    <nav class="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2.5 group">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-200/50 group-hover:shadow-violet-300/60 transition-all group-hover:scale-105">
          <svg class="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
        </div>
        <span class="text-lg font-extrabold bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 bg-clip-text text-transparent">
          {siteName}
        </span>
      </a>
      <div class="flex items-center gap-6">
        <a href="/"
          class:list={[
            "text-sm font-medium transition-colors hover:text-violet-600",
            currentPath === "/" ? "text-violet-600" : "text-gray-500"
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
  <footer class="border-t border-gray-200/60 bg-white">
    <div class="max-w-4xl mx-auto px-6 py-10">
      <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div class="flex items-center gap-2.5">
          <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <svg class="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          </div>
          <span class="text-sm font-bold text-gray-800">{siteName}</span>
        </div>
        <p class="text-xs text-gray-400">
          &copy; {new Date().getFullYear()} {siteName}. Создано с помощью
          <a href="https://seo-modul.pro" target="_blank" rel="noopener" class="text-violet-500 hover:text-violet-600 transition-colors ml-1">СЕО-Модуля</a>.
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
---
<Layout title="Блог" description="Экспертные статьи по SEO, маркетингу и продвижению сайтов">
  <div class="max-w-4xl mx-auto px-6 py-16">
    <!-- Hero -->
    <div class="mb-14">
      <h1 class="text-4xl sm:text-5xl font-black tracking-tight text-gray-900 mb-4">
        Экспертный блог
      </h1>
      <p class="text-lg text-gray-500 max-w-xl leading-relaxed">
        Авторские статьи по SEO, маркетингу и продвижению — написаны экспертами, проверены практикой.
      </p>
    </div>

    {posts.length === 0 && (
      <div class="text-center py-24">
        <div class="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center mx-auto mb-6">
          <svg class="w-10 h-10 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
        <p class="text-gray-400 text-lg">Статьи пока не опубликованы</p>
      </div>
    )}

    <div class="grid gap-6">
      {posts.map((post) => {
        const pubDate = post.data.pubDate || post.data.date;
        return (
          <a href={\`/blog/\${post.id}/\`}
            class="group block bg-white rounded-3xl p-6 sm:p-8 shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100 hover:border-violet-200/60">
            <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div class="min-w-0 flex-1">
                <h2 class="text-xl font-bold text-gray-900 group-hover:text-violet-600 transition-colors leading-snug">
                  {post.data.title}
                </h2>
                {post.data.description && (
                  <p class="text-sm text-gray-500 mt-2 line-clamp-2 leading-relaxed">{post.data.description}</p>
                )}
                <div class="flex flex-wrap items-center gap-2 mt-3">
                  {pubDate && (
                    <time class="text-xs text-gray-400 tabular-nums">
                      {new Date(pubDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </time>
                  )}
                  {post.data.author && (
                    <span class="text-xs text-gray-400">• {post.data.author}</span>
                  )}
                </div>
              </div>
              <div class="shrink-0 w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center group-hover:bg-violet-100 transition-colors">
                <svg class="w-5 h-5 text-violet-400 group-hover:text-violet-600 transition-colors transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
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

// Expert author block data
const experts = [
  { name: "Алексей Петров", bio: "SEO-эксперт с 12-летним стажем. Работал с крупнейшими e-commerce проектами Рунета.", initials: "АП", color: "from-violet-500 to-purple-600" },
  { name: "Мария Козлова", bio: "Специалист по контент-маркетингу и поисковой оптимизации. Автор курса «SEO для бизнеса».", initials: "МК", color: "from-fuchsia-500 to-pink-600" },
  { name: "Дмитрий Волков", bio: "Технический SEO-консультант. Помог 200+ компаниям увеличить органический трафик.", initials: "ДВ", color: "from-blue-500 to-cyan-600" },
  { name: "Елена Смирнова", bio: "Руководитель отдела контента в digital-агентстве. 8 лет в SEO и копирайтинге.", initials: "ЕС", color: "from-emerald-500 to-teal-600" },
  { name: "Иван Новиков", bio: "Аналитик поисковых систем, эксперт Google и Яндекс. Спикер профильных конференций.", initials: "ИН", color: "from-amber-500 to-orange-600" },
];

const authorName = post.data.author || experts[0].name;
const expert = experts.find(e => e.name === authorName) || experts[Math.floor(post.id.length % experts.length)];

// TOC from headings
const tocItems = headings.filter(h => h.depth === 2);
const hasToc = tocItems.length >= 3;

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
  <article class="max-w-4xl mx-auto px-6 py-12">
    <!-- Back -->
    <a href="/" class="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-violet-600 transition-colors mb-8 group">
      <svg class="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
      </svg>
      Все статьи
    </a>

    <!-- Article Card -->
    <div class="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
      <!-- Hero Image / Gradient Placeholder -->
      {post.data.heroImage ? (
        <img src={post.data.heroImage} alt={post.data.title} class="w-full h-64 sm:h-80 object-cover" />
      ) : (
        <div class="w-full h-48 sm:h-64 bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center p-8">
          <h2 class="text-2xl sm:text-3xl font-black text-white text-center leading-tight drop-shadow-lg max-w-2xl">
            {post.data.title}
          </h2>
        </div>
      )}

      <div class="p-6 sm:p-10 lg:p-12">
        <!-- Header -->
        <header class="mb-10">
          <h1 class="text-3xl sm:text-4xl font-black tracking-tight text-gray-900 leading-[1.15]">
            {post.data.title}
          </h1>

          <div class="flex flex-wrap items-center gap-3 mt-5">
            <div class="flex items-center gap-2">
              <div class={\`w-8 h-8 rounded-full bg-gradient-to-br \${expert.color} flex items-center justify-center\`}>
                <span class="text-xs font-bold text-white">{expert.initials}</span>
              </div>
              <span class="text-sm font-medium text-gray-700">{expert.name}</span>
            </div>
            {formattedDate && (
              <span class="text-sm text-gray-400">• {formattedDate}</span>
            )}
          </div>

          {post.data.keywords && post.data.keywords.length > 0 && (
            <div class="flex flex-wrap gap-2 mt-4">
              {post.data.keywords.map((kw: string) => (
                <span class="inline-block px-3 py-1 text-xs font-medium rounded-full bg-violet-50 text-violet-600 border border-violet-100">
                  {kw}
                </span>
              ))}
            </div>
          )}

          {post.data.description && (
            <p class="mt-5 text-lg text-gray-500 leading-relaxed">{post.data.description}</p>
          )}
        </header>

        <!-- Table of Contents -->
        {hasToc && (
          <nav class="mb-10 p-6 bg-gray-50 rounded-2xl border border-gray-100">
            <h3 class="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">Содержание</h3>
            <ol class="space-y-2">
              {tocItems.map((item, i) => (
                <li>
                  <a href={\`#\${item.slug}\`} class="text-sm text-gray-600 hover:text-violet-600 transition-colors flex items-start gap-2">
                    <span class="text-violet-400 font-semibold shrink-0">{i + 1}.</span>
                    <span>{item.text}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <!-- Content -->
        <div class="prose prose-lg prose-gray max-w-none
          prose-headings:scroll-mt-24
          prose-a:text-violet-600 prose-a:no-underline prose-a:border-b prose-a:border-violet-200 hover:prose-a:border-violet-500
          prose-img:rounded-2xl prose-img:shadow-lg
          prose-pre:bg-gray-950 prose-pre:rounded-2xl
          prose-code:text-violet-700 prose-code:bg-violet-50 prose-code:rounded-md prose-code:px-1.5 prose-code:py-0.5 prose-code:text-sm prose-code:font-medium prose-code:before:content-none prose-code:after:content-none
          prose-blockquote:border-l-violet-400 prose-blockquote:bg-violet-50/50 prose-blockquote:rounded-r-xl prose-blockquote:not-italic
          prose-table:overflow-hidden prose-table:rounded-2xl prose-table:shadow-sm
          prose-thead:bg-gradient-to-r prose-thead:from-violet-600 prose-thead:to-purple-600
          prose-th:text-xs prose-th:uppercase prose-th:tracking-wider prose-th:text-white prose-th:font-semibold prose-th:py-3.5 prose-th:px-5
          prose-td:py-3.5 prose-td:px-5 prose-td:border-t prose-td:border-gray-100
          prose-strong:text-gray-900
          prose-hr:border-gray-200
          prose-li:marker:text-violet-400
        ">
          <Content />
        </div>

        <!-- Author E-E-A-T Block -->
        <div class="mt-14 pt-8 border-t border-gray-100">
          <div class="bg-gradient-to-br from-gray-50 to-violet-50/30 rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-start gap-5">
            <div class={\`w-16 h-16 rounded-2xl bg-gradient-to-br \${expert.color} flex items-center justify-center shrink-0 shadow-lg\`}>
              <span class="text-xl font-bold text-white">{expert.initials}</span>
            </div>
            <div>
              <p class="text-xs font-semibold text-violet-600 uppercase tracking-wider mb-1">Об авторе</p>
              <h4 class="text-lg font-bold text-gray-900">{expert.name}</h4>
              <p class="text-sm text-gray-600 mt-1 leading-relaxed">{expert.bio}</p>
            </div>
          </div>
        </div>

        <!-- Bottom nav -->
        <div class="mt-10 pt-8 border-t border-gray-100">
          <a href="/" class="inline-flex items-center gap-2 text-sm font-semibold text-violet-600 hover:text-violet-700 transition-colors group">
            <svg class="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Назад к списку статей
          </a>
        </div>
      </div>
    </div>
  </article>
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

    const { project_id, action } = await req.json();
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

    // Action: initialize or update - push all template files
    const results: { file: string; status: string }[] = [];

    for (const [filePath, content] of Object.entries(FILES)) {
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
          message: `[SEO-Factor] ${sha ? 'Update' : 'Add'} ${filePath}`,
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
