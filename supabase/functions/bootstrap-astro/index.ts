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
      astro: "^5.9.3",
      "@astrojs/tailwind": "^6.0.2",
      tailwindcss: "^3.4.17"
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
  theme: { extend: {} },
  plugins: [],
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
---
<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content={description} />
  <title>{title}</title>
</head>
<body class="bg-gray-50 text-gray-900 min-h-screen">
  <header class="bg-white border-b border-gray-200">
    <nav class="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/" class="text-xl font-bold text-purple-600">SEO-Factor</a>
      <a href="/" class="text-sm text-gray-600 hover:text-purple-600">Блог</a>
    </nav>
  </header>
  <main class="max-w-4xl mx-auto px-4 py-8">
    <slot />
  </main>
  <footer class="border-t border-gray-200 mt-16">
    <div class="max-w-4xl mx-auto px-4 py-6 text-center text-sm text-gray-500">
      &copy; {new Date().getFullYear()} SEO-Factor
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
  <h1 class="text-3xl font-bold mb-8">Блог</h1>
  {posts.length === 0 && <p class="text-gray-500">Статьи пока не опубликованы.</p>}
  <ul class="space-y-6">
    {posts.map((post) => (
      <li>
        <a href={\`/blog/\${post.id}/\`} class="block group">
          <h2 class="text-xl font-semibold text-purple-600 group-hover:underline">{post.data.title}</h2>
          {post.data.description && <p class="text-gray-600 mt-1">{post.data.description}</p>}
          {post.data.date && <time class="text-sm text-gray-400">{post.data.date}</time>}
        </a>
      </li>
    ))}
  </ul>
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
---
<Layout title={post.data.title} description={post.data.description}>
  <article class="prose prose-lg max-w-none">
    <h1>{post.data.title}</h1>
    {post.data.date && <time class="text-sm text-gray-400 block mb-6">{post.data.date}</time>}
    <Content />
  </article>
  <div class="mt-12">
    <a href="/" class="text-purple-600 hover:underline">&larr; Назад к списку</a>
  </div>
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

    // Action: check - just check if repo has package.json
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

    // Action: initialize - push all template files
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
          message: `[SEO-Module] Add ${filePath}`,
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
