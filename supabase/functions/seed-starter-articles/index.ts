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

// FAL.ai hero generator (flux/schnell) — fast, ~2s per image. Returns the
// public CDN URL or null on any failure (caller falls back to picsum).
async function generateHeroImage(falKey: string, topic: string, title: string): Promise<string | null> {
  try {
    // IMPORTANT: never pass non-English strings (especially Cyrillic) into the
    // image prompt — Flux will try to render them as garbled letters baked
    // into the picture. We use only the topic as a generic English hint and
    // explicitly forbid any text/letters/captions in the output.
    const safeTopic = String(topic || "business").replace(/[^\x20-\x7E]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "business";
    const prompt = `Professional editorial photograph related to ${safeTopic}. Realistic business style, natural lighting, shallow depth of field, magazine quality, 16:9 composition. ABSOLUTELY NO TEXT, no letters, no words, no captions, no signs, no logos, no watermarks, no typography, no writing of any kind anywhere in the image.`;
    const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
      method: "POST",
      headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        negative_prompt: "text, letters, words, captions, signs, logos, watermarks, typography, writing, characters, font, alphabet, cyrillic, latin text, numbers, labels, subtitles",
        image_size: "landscape_16_9",
        num_images: 1,
        num_inference_steps: 4,
        enable_safety_checker: true,
      }),
    });
    if (!res.ok) {
      console.warn("[seed-starter-articles] FAL HTTP", res.status);
      return null;
    }
    const data = await res.json();
    const url = data?.images?.[0]?.url || null;
    return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
  } catch (e: any) {
    console.warn("[seed-starter-articles] FAL error:", e?.message);
    return null;
  }
}

interface SeedAuthor { name?: string; role?: string; bio?: string }

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

async function aiArticle(apiKey: string, topic: string, idx: number, lang: "ru" | "en", author?: SeedAuthor) {
  // No persona injection: author name is shown only in byline metadata.
  // Articles MUST be written in third-person/impersonal expert journalism style.
  const sys = lang === "ru"
    ? `Ты пишешь практичную информационную статью на русском в стиле экспертной журналистики.

СТРОГО ЗАПРЕЩЕНО:
- Начинать статью с приветствия ("Привет", "Привет, друзья", "Здравствуйте", "Добрый день", "Дорогие читатели")
- Писать от первого лица ("я", "меня зовут", "я расскажу", "мой опыт", "в этой статье я", "мы с вами")
- Представляться в начале текста или упоминать имя автора в тексте
- Использовать разговорный стиль личного блога
- Обращения на "ты"/"вы" в первом абзаце

ОБЯЗАТЕЛЬНЫЙ СТИЛЬ:
- Экспертный журналистский тон, третье лицо или безличные конструкции
- Первый абзац = главная мысль статьи, сразу по сути темы
- Примеры правильного начала: "Выбор X - ключевой фактор...", "Рынок X требует...", "Качественный X увеличивает..."

Возвращай СТРОГО JSON {title, meta_description, content_html}. content_html: 600-900 слов, ТОЛЬКО теги h2/h3/p/ul/ol/li, без h1, без <script>, без <style>, без ссылок, без воды, без слов «эксперт», «эксклюзив». Включи раздел <h2>Частые вопросы</h2> с 3-5 парами <h3>Вопрос?</h3><p>Ответ.</p>.`
    : `Write a practical informational article in English in expert journalism style.

STRICTLY FORBIDDEN:
- Starting with a greeting ("Hi", "Hello", "Hey friends", "Dear readers")
- First-person writing ("I", "my name is", "I will tell you", "in my experience", "in this article I")
- Introducing yourself or mentioning the author's name inside the body text
- Personal blog conversational tone

REQUIRED STYLE:
- Expert journalistic tone, third person or impersonal constructions
- First paragraph = main point of the article, straight to the topic
- Good openings: "Choosing X is a key factor...", "The X market requires...", "Quality X increases..."

Return STRICT JSON {title, meta_description, content_html}. content_html: 600-900 words, ONLY h2/h3/p/ul/ol/li tags, no h1, no <script>, no <style>, no links, no fluff. Include a section <h2>FAQ</h2> with 3-5 <h3>Question?</h3><p>Answer.</p> pairs.`;
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
  // Defensive cleanup: strip <script>/<style>, drop H1s, drop &lt;script&gt; etc.
  let html = String(parsed.content_html || parsed.content || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?h1[^>]*>/gi, "")
    .replace(/&lt;script[\s\S]*?&lt;\/script&gt;/gi, "")
    .slice(0, 30000);
  // Defensive cleanup: strip first-person greetings / self-introductions that slipped through.
  html = sanitizeFirstPersonOpenings(html, author?.name);
  return {
    title: String(parsed.title || seeds[idx % seeds.length]).slice(0, 200),
    content: html,
    meta_description: String(parsed.meta_description || "").slice(0, 280),
  };
}

// Removes opening greetings and first-person self-introduction sentences from generated HTML.
function sanitizeFirstPersonOpenings(html: string, authorName?: string): string {
  if (!html) return html;
  const greetingPatterns: RegExp[] = [
    /^(\s*<p>)\s*(привет[^<.!?]*[.!?]\s*)+/i,
    /^(\s*<p>)\s*(здравствуйте[^<.!?]*[.!?]\s*)+/i,
    /^(\s*<p>)\s*(добрый\s+(?:день|вечер|утро)[^<.!?]*[.!?]\s*)+/i,
    /^(\s*<p>)\s*(дорогие\s+читатели[^<.!?]*[.!?]\s*)+/i,
    /^(\s*<p>)\s*(hi|hello|hey)[^<.!?]*[.!?]\s*/i,
  ];
  // Self-introduction sentences: "Я <Name>", "Меня зовут ...", "Я расскажу", "В этой статье я ..."
  const selfIntro: RegExp[] = [
    /\bя\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?\s*[—\-,.][^<.!?]*[.!?]/g,
    /меня\s+зовут[^<.!?]*[.!?]/gi,
    /в\s+этой\s+статье\s+я[^<.!?]*[.!?]/gi,
    /я\s+расскажу[^<.!?]*[.!?]/gi,
    /\bI(?:'m| am)\s+[A-Z][a-z]+[^<.!?]*[.!?]/g,
    /my\s+name\s+is[^<.!?]*[.!?]/gi,
    /in\s+this\s+article\s+I[^<.!?]*[.!?]/gi,
  ];
  let out = html;
  for (const re of greetingPatterns) out = out.replace(re, "$1");
  for (const re of selfIntro) out = out.replace(re, "");
  if (authorName) {
    const safe = authorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\bя\\s+${safe}[^<.!?]*[.!?]`, "gi"), "");
    out = out.replace(new RegExp(`\\bI\\s+am\\s+${safe}[^<.!?]*[.!?]`, "gi"), "");
  }
  // Collapse empty <p></p> left after stripping
  out = out.replace(/<p>\s*<\/p>/gi, "");
  // Collapse double spaces
  out = out.replace(/[ \t]{2,}/g, " ");
  return out;
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
      .select("id, name, site_name, site_about, language, user_id, authors")
      .eq("id", projectId).maybeSingle();
    if (!project || project.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lang: "ru" | "en" = String(project.language || "ru").toLowerCase().startsWith("ru") ? "ru" : "en";
    const topic = body.topic || project.site_about || project.site_name || project.name || (lang === "ru" ? "блог" : "blog");
    const apiKey = await getOpenRouterKey(admin);
    const falKey = Deno.env.get("FAL_AI_API_KEY") || "";
    const projectAuthors: SeedAuthor[] = Array.isArray((project as any).authors) ? (project as any).authors : [];

    const created: string[] = [];
    for (let i = 0; i < count; i++) {
      // Rotate through project authors so different posts get different bylines.
      const author = projectAuthors.length > 0 ? projectAuthors[i % projectAuthors.length] : undefined;
      let art;
      try {
        art = apiKey ? await aiArticle(apiKey, topic, i, lang, author) : fallbackArticle(topic, i, lang);
      } catch (e: any) {
        console.error("[seed-starter-articles] AI fail, using fallback:", e?.message);
        art = fallbackArticle(topic, i, lang);
      }
      // Generate hero image via FAL.ai (best-effort — null on failure).
      let heroUrl: string | null = null;
      if (falKey) {
        heroUrl = await generateHeroImage(falKey, topic, art.title);
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
        featured_image_url: heroUrl,
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