import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WELCOME_ARTICLE = `---
title: "Добро пожаловать на блог"
description: "Первая статья вашего нового SEO-блога, созданного с помощью СЕО-Модуля"
date: "${new Date().toISOString().split("T")[0]}"
keywords: ["блог", "seo", "старт"]
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

Сайт обновится автоматически после каждой публикации.
`;

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "my-seo-factor",
    type: "module",
    version: "0.0.1",
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
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
        },
      },
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            '--tw-prose-headings': theme('colors.gray.900'),
            '--tw-prose-body': theme('colors.gray.700'),
            '--tw-prose-links': theme('colors.violet.600'),
            maxWidth: 'none',
            h1: { fontWeight: '800', letterSpacing: '-0.025em' },
            h2: { fontWeight: '700', letterSpacing: '-0.02em', marginTop: '2em' },
            h3: { fontWeight: '600' },
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
            code: {
              backgroundColor: theme('colors.gray.100'),
              padding: '0.2em 0.4em',
              borderRadius: '0.25rem',
              fontSize: '0.875em',
              fontWeight: '500',
            },
            blockquote: {
              borderLeftColor: theme('colors.violet.500'),
              backgroundColor: theme('colors.violet.50'),
              padding: '1rem 1.5rem',
              borderRadius: '0 0.5rem 0.5rem 0',
              fontStyle: 'normal',
            },
            table: {
              width: '100%',
              borderCollapse: 'separate',
              borderSpacing: '0',
              overflow: 'hidden',
              borderRadius: '0.75rem',
              border: '1px solid ' + theme('colors.gray.200'),
            },
            thead: {
              backgroundColor: theme('colors.gray.50'),
            },
            'thead th': {
              padding: '0.75rem 1rem',
              fontWeight: '600',
              fontSize: '0.875rem',
              color: theme('colors.gray.600'),
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderBottom: '2px solid ' + theme('colors.gray.200'),
            },
            'tbody td': {
              padding: '0.75rem 1rem',
              borderBottom: '1px solid ' + theme('colors.gray.100'),
            },
            'tbody tr:last-child td': {
              borderBottom: 'none',
            },
            'tbody tr:nth-child(even)': {
              backgroundColor: theme('colors.gray.50'),
            },
            img: {
              borderRadius: '0.75rem',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
            },
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
    date: z.string().optional(),
    keywords: z.array(z.string()).optional(),
  }),
});

export const collections = { blog };
`,

  "src/layouts/Layout.astro": `---
interface Props {
  title: string;
  description?: string;
}
const { title, description = 'SEO-блог' } = Astro.props;
const currentPath = Astro.url.pathname;
---
<!doctype html>
<html lang="ru" class="scroll-smooth">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content={description} />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <title>{title}</title>
</head>
<body class="font-sans bg-white text-gray-900 antialiased min-h-screen flex flex-col">
  <!-- Header -->
  <header class="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-gray-100">
    <nav class="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2 group">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md shadow-violet-200 group-hover:shadow-lg group-hover:shadow-violet-300 transition-shadow">
          <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        </div>
        <span class="text-lg font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
          SEO-Factor
        </span>
      </a>
      <div class="flex items-center gap-6">
        <a href="/"
          class:list={[
            "text-sm font-medium transition-colors hover:text-violet-600",
            currentPath === "/" ? "text-violet-600" : "text-gray-500"
          ]}>
          Блог
        </a>
      </div>
    </nav>
  </header>

  <!-- Main -->
  <main class="flex-1 w-full max-w-3xl mx-auto px-6 py-12">
    <slot />
  </main>

  <!-- Footer -->
  <footer class="border-t border-gray-100 bg-gray-50/50">
    <div class="max-w-3xl mx-auto px-6 py-8">
      <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </div>
          <span class="text-sm font-semibold text-gray-700">SEO-Factor</span>
        </div>
        <p class="text-xs text-gray-400">
          &copy; {new Date().getFullYear()} SEO-Factor. Создано с помощью
          <a href="https://seo-modul.pro" target="_blank" rel="noopener" class="text-violet-500 hover:text-violet-600 transition-colors">СЕО-Модуля</a>.
        </p>
      </div>
    </div>
  </footer>
</body>
</html>
`,

  "src/pages/index.astro": `---
import Layout from '../layouts/Layout.astro';
import { getCollection } from 'astro:content';

const posts = (await getCollection('blog')).sort(
  (a, b) => new Date(b.data.date || 0).getTime() - new Date(a.data.date || 0).getTime()
);
---
<Layout title="SEO-Factor - Блог">
  <!-- Hero -->
  <div class="mb-12">
    <h1 class="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 mb-4">
      Блог
    </h1>
    <p class="text-lg text-gray-500 max-w-xl">
      Экспертные статьи по SEO, маркетингу и продвижению сайтов.
    </p>
  </div>

  {posts.length === 0 && (
    <div class="text-center py-20">
      <div class="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
        <svg class="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
      <p class="text-gray-500">Статьи пока не опубликованы.</p>
    </div>
  )}

  <div class="space-y-1">
    {posts.map((post, i) => (
      <a href={\`/blog/\${post.id}/\`}
        class="group block rounded-xl p-5 -mx-5 transition-all hover:bg-gray-50">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <h2 class="text-lg font-semibold text-gray-900 group-hover:text-violet-600 transition-colors truncate">
              {post.data.title}
            </h2>
            {post.data.description && (
              <p class="text-sm text-gray-500 mt-1 line-clamp-2">{post.data.description}</p>
            )}
          </div>
          {post.data.date && (
            <time class="text-xs text-gray-400 whitespace-nowrap mt-1 tabular-nums">
              {new Date(post.data.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
            </time>
          )}
        </div>
      </a>
    ))}
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
const { Content } = await render(post);

const formattedDate = post.data.date
  ? new Date(post.data.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  : null;
---
<Layout title={post.data.title} description={post.data.description}>
  <article>
    <!-- Article header -->
    <header class="mb-10">
      <a href="/" class="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-violet-600 transition-colors mb-6 group">
        <svg class="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Все статьи
      </a>

      <h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900 leading-tight">
        {post.data.title}
      </h1>

      <div class="flex flex-wrap items-center gap-3 mt-4">
        {formattedDate && (
          <time class="text-sm text-gray-400 tabular-nums">{formattedDate}</time>
        )}
        {post.data.keywords && post.data.keywords.length > 0 && (
          <div class="flex flex-wrap gap-1.5">
            {post.data.keywords.map((kw: string) => (
              <span class="inline-block px-2.5 py-0.5 text-xs font-medium rounded-full bg-violet-50 text-violet-600 border border-violet-100">
                {kw}
              </span>
            ))}
          </div>
        )}
      </div>

      {post.data.description && (
        <p class="mt-4 text-lg text-gray-500 leading-relaxed">{post.data.description}</p>
      )}

      <div class="h-px bg-gradient-to-r from-violet-200 via-gray-200 to-transparent mt-8"></div>
    </header>

    <!-- Article content -->
    <div class="prose prose-lg prose-gray max-w-none
      prose-headings:scroll-mt-20
      prose-a:text-violet-600 prose-a:no-underline hover:prose-a:underline
      prose-img:rounded-xl prose-img:shadow-md
      prose-pre:bg-gray-950 prose-pre:rounded-xl
      prose-code:text-violet-600 prose-code:bg-violet-50 prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:text-sm prose-code:font-medium prose-code:before:content-none prose-code:after:content-none
      prose-blockquote:border-l-violet-500 prose-blockquote:bg-violet-50/50 prose-blockquote:rounded-r-lg prose-blockquote:not-italic
      prose-table:overflow-hidden prose-table:rounded-xl prose-table:border prose-table:border-gray-200
      prose-thead:bg-gray-50
      prose-th:text-xs prose-th:uppercase prose-th:tracking-wider prose-th:text-gray-500 prose-th:font-semibold prose-th:py-3 prose-th:px-4
      prose-td:py-3 prose-td:px-4 prose-td:border-t prose-td:border-gray-100
      prose-strong:text-gray-900
      prose-hr:border-gray-200
    ">
      <Content />
    </div>

    <!-- Bottom nav -->
    <div class="mt-16 pt-8 border-t border-gray-100">
      <a href="/" class="inline-flex items-center gap-2 text-sm font-medium text-violet-600 hover:text-violet-700 transition-colors group">
        <svg class="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Назад к списку статей
      </a>
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
