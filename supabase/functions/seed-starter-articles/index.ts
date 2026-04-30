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
      `${topic}: что важно знать в 2026 году`,
      `${topic} - 7 практических рекомендаций`,
      `Как выбрать ${topic}: пошаговый разбор`,
    ];
    const title = titles[idx % titles.length];
    const leads = [
      `Сегмент «${topic}» формируется под влиянием спроса, регуляторики и сезонности - три фактора задают правила игры на рынке.`,
      `За последний год спрос в категории «${topic}» вырос: компании пересматривают подход к качеству, ценообразованию и сервису.`,
      `Выбор в категории «${topic}» определяется тремя параметрами: совокупная стоимость владения, репутация поставщика и сроки.`,
    ];
    const content = `<p>${leads[idx % leads.length]}</p>
<h2>Главное за минуту</h2><p>Коротко о сути темы и что важно учесть в первую очередь.</p>
<h2>Как действовать</h2><p>Пошаговый разбор с акцентом на детали, которые часто упускают новички.</p>
<h2>Частые ошибки</h2><p>Список типовых промахов и способы их избежать.</p>
<h2>Итог</h2><p>Если применить эти рекомендации, результат заметен уже в первый месяц работы.</p>`;
    return { title, content, meta_description: leads[idx % leads.length].slice(0, 200) };
  }
  const titles = [
    `${topic}: a beginner's guide`,
    `7 practical tips on ${topic}`,
    `How to choose ${topic} in 2026`,
  ];
  const title = titles[idx % titles.length];
  const leads = [
    `The ${topic} market is shaped by demand, regulation and seasonality - three forces that set the rules of the game.`,
    `Demand in the ${topic} category has grown over the past year as companies rethink quality, pricing and service.`,
    `Buying decisions for ${topic} hinge on three things: total cost of ownership, supplier reputation and lead time.`,
  ];
  const content = `<p>${leads[idx % leads.length]}</p>
<h2>Quick summary</h2><p>The essentials in one minute.</p>
<h2>How to act</h2><p>Step-by-step breakdown.</p>
<h2>Common mistakes</h2><p>Pitfalls and how to avoid them.</p>
<h2>Conclusion</h2><p>Apply these tips and you will see results within a month.</p>`;
  return { title, content, meta_description: leads[idx % leads.length].slice(0, 200) };
}

async function aiArticle(apiKey: string, topic: string, idx: number, lang: "ru" | "en", author?: SeedAuthor, brandName?: string) {
  // No persona injection: author name is shown only in byline metadata.
  // Articles MUST be written in third-person/impersonal expert journalism style.
  // CRITICAL: brandName (e.g. "Новости Тулы") is the SITE name, NOT the article topic.
  // The article must be about `topic` (the niche), never about the brand itself.
  const sys = lang === "ru"
    ? `Ты пишешь практичную информационную статью на русском в стиле экспертной журналистики на тему «${topic}».

ТЕМА статьи: «${topic}» - это ниша/предметная область. Пиши про эту нишу.
${brandName ? `Название сайта-портала: «${brandName}» - НЕ используй это название в заголовке и тексте, это просто бренд издания.` : ""}

СТРОГО ЗАПРЕЩЕНО:
- Начинать статью с приветствия ("Привет", "Привет, друзья", "Здравствуйте", "Добрый день", "Дорогие читатели")
- Писать от первого лица ("я", "меня зовут", "я расскажу", "мой опыт", "в этой статье я", "мы с вами")
- Представляться в начале текста или упоминать имя автора в тексте
- Использовать разговорный стиль личного блога
- Обращения на "ты"/"вы" в первом абзаце
- Использовать название сайта/бренда в заголовке статьи
- Шаблонные фразы "практический разбор темы", "в этой статье мы рассмотрим"

ОБЯЗАТЕЛЬНЫЙ СТИЛЬ:
- Экспертный журналистский тон, третье лицо или безличные конструкции
- Заголовок (title): конкретный, по сути темы «${topic}», 50-70 символов, без названия бренда
- meta_description (лид-абзац): 1-2 предложения, конкретно по теме статьи, без воды и шаблонов. Уникально для каждой статьи.
- Первый абзац контента = главная мысль статьи, сразу по сути темы
- Примеры правильных заголовков для темы «${topic}»: "Как выбрать ${topic}: чек-лист", "${topic} в 2026: тренды и цены", "Топ ошибок при покупке ${topic}"

Возвращай СТРОГО JSON {title, meta_description, content_html}. content_html: 600-900 слов, ТОЛЬКО теги h2/h3/p/ul/ol/li, без h1, без <script>, без <style>, без ссылок, без воды, без слов «эксперт», «эксклюзив». Включи раздел <h2>Частые вопросы</h2> с 3-5 парами <h3>Вопрос?</h3><p>Ответ.</p>.`
    : `Write a practical informational article in English in expert journalism style on the topic "${topic}".

ARTICLE TOPIC: "${topic}" - this is the niche/subject area. Write about this niche.
${brandName ? `Publication brand name: "${brandName}" - do NOT use this name in the title or body, it is just the publisher.` : ""}

STRICTLY FORBIDDEN:
- Starting with a greeting ("Hi", "Hello", "Hey friends", "Dear readers")
- First-person writing ("I", "my name is", "I will tell you", "in my experience", "in this article I")
- Introducing yourself or mentioning the author's name inside the body text
- Personal blog conversational tone
- Using the site/brand name in the article title
- Boilerplate phrases like "a practical guide to", "in this article we will look at"

REQUIRED STYLE:
- Expert journalistic tone, third person or impersonal constructions
- Title: specific, on the topic "${topic}", 50-70 characters, no brand name
- meta_description (lead): 1-2 sentences, concrete on the article topic, no fluff, unique for each article
- First paragraph of body = main point, straight to the topic
- Good title examples for "${topic}": "How to choose ${topic}: a checklist", "${topic} in 2026: trends and prices", "Top mistakes buying ${topic}"

Return STRICT JSON {title, meta_description, content_html}. content_html: 600-900 words, ONLY h2/h3/p/ul/ol/li tags, no h1, no <script>, no <style>, no links, no fluff. Include a section <h2>FAQ</h2> with 3-5 <h3>Question?</h3><p>Answer.</p> pairs.`;
  const seeds = lang === "ru"
    ? [`Расскажи про ${topic}: с чего начать, на что смотреть, частые ошибки.`,
       `Семь практических рекомендаций по теме ${topic} - конкретно, по делу.`,
       `Как выбрать ${topic} в 2026 году - критерии, цены, чек-лист.`]
    : [`Cover ${topic}: where to start, what to look for, common mistakes.`,
       `Seven practical recommendations on ${topic} - concrete and to the point.`,
       `How to choose ${topic} in 2026 - criteria, prices, checklist.`];
  const user = (lang === "ru" ? "Задание для статьи: " : "Article brief: ") + seeds[idx % seeds.length];
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
  // Defensive: strip brand name from title if AI ignored the rule.
  let titleOut = String(parsed.title || seeds[idx % seeds.length]).slice(0, 200);
  if (brandName) {
    const safe = brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    titleOut = titleOut.replace(new RegExp(`[«"]?\\s*${safe}\\s*[»"]?`, "gi"), topic).replace(/\s{2,}/g, " ").trim();
  }
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
    title: titleOut,
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