// Seeds N starter articles for a Site Factory project.
// Generates N (default 3) articles via OpenRouter (gemini-2.5-flash) and
// inserts them with status='completed' so deploy-cloudflare-direct can render them.
//
// Body: { project_id: string, topic?: string, count?: number, language?: 'ru'|'en' }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getOpenRouterKey(admin: any): Promise<string | null> {
  try {
    const { data } = await admin.from("api_keys").select("api_key")
      .eq("provider", "openrouter").eq("is_valid", true).limit(1).maybeSingle();
    if (data?.api_key) return data.api_key;
  } catch (_) { /* ignore */ }
  return Deno.env.get("OPENROUTER_API_KEY") || null;
}

function fallbackArticle(topic: string, idx: number, lang: "ru" | "en") {
  if (lang === "ru") {
    const titles = [
      `Гид по теме «${topic}»: с чего начать`,
      `${topic}: 7 практических советов`,
      `Как выбрать ${topic} в 2026 году`,
    ];
    const title = titles[idx % titles.length];
    const content = `<p>Практика показывает: разобраться с темой «${topic}» проще, чем кажется. В этом материале - конкретные шаги, без воды.</p>
<h2>Главное за минуту</h2><p>Коротко о сути темы и что важно учесть в первую очередь.</p>
<h2>Как действовать</h2><p>Пошаговый разбор с акцентом на детали, которые часто упускают новички.</p>
<h2>Частые ошибки</h2><p>Список типовых промахов и способы их избежать.</p>
<h2>Итог</h2><p>Если применить эти рекомендации, результат заметен уже в первый месяц работы.</p>`;
    return { title, content, meta_description: `Практический разбор темы «${topic}» - советы, ошибки, итог.` };
  }
  const titles = [
    `${topic}: a beginner's guide`,
    `7 practical tips on ${topic}`,
    `How to choose ${topic} in 2026`,
  ];
  const title = titles[idx % titles.length];
  const content = `<p>Practice shows: getting started with ${topic} is easier than it seems. Here are the steps that actually work.</p>
<h2>Quick summary</h2><p>The essentials in one minute.</p>
<h2>How to act</h2><p>Step-by-step breakdown.</p>
<h2>Common mistakes</h2><p>Pitfalls and how to avoid them.</p>
<h2>Conclusion</h2><p>Apply these tips and you will see results within a month.</p>`;
  return { title, content, meta_description: `A practical guide to ${topic} - tips, mistakes, conclusions.` };
}

async function aiArticle(apiKey: string, topic: string, idx: number, lang: "ru" | "en") {
  const sys = lang === "ru"
    ? "Ты пишешь практичную информационную статью на русском. Возвращай ТОЛЬКО JSON {title, meta_description, content_html}. content_html: 600-900 слов, h2/p/ul, без h1, без ссылок, без воды, без слов «эксперт», «эксклюзив»."
    : "Write a practical informational article in English. Return ONLY JSON {title, meta_description, content_html}. content_html: 600-900 words, h2/p/ul, no h1, no links, no fluff.";
  const seeds = lang === "ru"
    ? [`Гид по теме «${topic}» для начинающих`, `7 практических советов про ${topic}`, `Как выбрать ${topic} в 2026 году - чек-лист`]
    : [`A beginner's guide to ${topic}`, `7 practical tips about ${topic}`, `How to choose ${topic} in 2026 - a checklist`];
  const user = (lang === "ru" ? "Тема статьи: " : "Article topic: ") + seeds[idx % seeds.length];
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "SEO-Module Starter" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      temperature: 0.85,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
  const data = await res.json();
  const raw = String(data?.choices?.[0]?.message?.content || "{}");
  const parsed = JSON.parse(raw);
  return {
    title: String(parsed.title || seeds[idx % seeds.length]).slice(0, 200),
    content: String(parsed.content_html || parsed.content || "").slice(0, 30000),
    meta_description: String(parsed.meta_description || "").slice(0, 280),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(supabaseUrl, service);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const projectId: string = body.project_id;
    const count = Math.max(1, Math.min(5, Number(body.count) || 3));
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing project_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: project } = await admin.from("projects")
      .select("id, name, site_name, site_about, language, user_id")
      .eq("id", projectId).maybeSingle();
    if (!project || project.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lang: "ru" | "en" = String(project.language || "ru").toLowerCase().startsWith("ru") ? "ru" : "en";
    const topic = body.topic || project.site_about || project.site_name || project.name || (lang === "ru" ? "блог" : "blog");
    const apiKey = await getOpenRouterKey(admin);

    const created: string[] = [];
    for (let i = 0; i < count; i++) {
      let art;
      try {
        art = apiKey ? await aiArticle(apiKey, topic, i, lang) : fallbackArticle(topic, i, lang);
      } catch (e: any) {
        console.error("[seed-starter-articles] AI fail, using fallback:", e?.message);
        art = fallbackArticle(topic, i, lang);
      }
      const { data: inserted, error: insErr } = await admin.from("articles").insert({
        user_id: user.id,
        project_id: projectId,
        title: art.title,
        content: art.content,
        meta_description: art.meta_description,
        status: "completed",
        language: lang,
        geo: lang === "ru" ? "RU" : "US",
      }).select("id").maybeSingle();
      if (insErr) {
        console.error("[seed-starter-articles] insert err:", insErr.message);
        continue;
      }
      if (inserted?.id) created.push(inserted.id);
    }

    return new Response(JSON.stringify({ success: true, created_count: created.length, ids: created }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[seed-starter-articles] ERROR:", err?.message);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});