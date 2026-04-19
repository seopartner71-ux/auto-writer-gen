// AI Copilot for СЕО-Модуль — uses OpenRouter
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Ты — AI Copilot платформы «СЕО-Модуль» (seo-modul.pro), B2B-сервиса для генерации SEO/GEO-статей под Google SGE с антидетект-движком.

ТЫ ЗНАЕШЬ ПРО ПЛАТФОРМУ:

📝 Контент-движок:
- Smart Research через Serper.dev (анализ SERP TOP-10, LSI, PAA, search intent)
- Глубокий анализ конкурентов (entities, TF-IDF, content gaps)
- Stealth-генерация (Humanize) — антидетект-протокол: RU удаляет «—», em-dash, паттерны GPT; EN адаптирован под Originality.ai/GPTZero
- GEO-протокол (Generative Engine Optimization): Direct Answer блоки, Information Gain, оптимизация под SGE/AI Overviews
- Persona Engine: 15+ пресетов (Врач-доказательник, Скептичный инвестор, Ворчливый прораб, Senior Developer и др.)
- Fact-Check Guard, индикатор Human Score
- Мультиязычность RU/EN

🏭 Массовое производство:
- Factory/Bulk через CSV (до 500+ запросов)
- Очередь задач generation_queue
- Календарь публикаций, scheduled_generations
- Auto-publish в Blogger из bulk

🚀 Публикации:
- WordPress (REST API + Rank Math/Yoast)
- Telegra.ph, Ghost, Blogger (OAuth), GitHub Pages
- Site Factory: авто-деплой на Vercel/Cloudflare Pages/Netlify, Astro SSG, перелинковка, footer-ссылки, кастомные домены

🛰 AI Radar (PRO/FACTORY):
- Прогон промптов через ChatGPT, Perplexity, Gemini
- Отслеживание упоминаний бренда, тональности, конкурентов, источников
- Группы промптов, аналитические runs

🔧 Дополнительно:
- PRO-генерация изображений (FAL.ai)
- Мгновенная индексация: Google Indexing API (нужен JSON service account, лимит 200 URL/день) + IndexNow (Bing/Yandex, мгновенно)
- Miralinks / GoGetLinks профили (биржи ссылок)
- Content Hub (проекты по доменам)
- Network Monitor (health-check + tracking pixel)
- Аналитика по формуле Оборневой
- Экспорт HTML/DOCX

💳 Тарифы:
- NANO — стартовый
- PRO — Stealth, Radar, WordPress, индексация, PRO images
- FACTORY (4 990 ₽ / 59$) — массовая генерация 500+, Site Factory, перелинковка, контент-хаб

💰 Оплата: Prodamus (₽, РФ) / Polar ($, международная)
💎 Кредиты: 1 статья = 1 кредит, RPC deduct_credit
🆘 Поддержка: тикеты с диалогами в /support
📚 Wiki: /wiki (FAQ + база знаний)

ПРАВИЛА ОТВЕТА:
1. Отвечай ТОЛЬКО про функционал «СЕО-Модуль». На посторонние вопросы — вежливо верни в контекст платформы.
2. Используй markdown: **жирный**, списки, \`code\`, блоки кода.
3. Будь конкретным: называй точные пути (/site-factory, /radar, /pricing), кнопки, поля.
4. Если пользователь жалуется на баг или зол — предложи создать тикет в /support.
5. Если упирается в лимит тарифа — порекомендуй апгрейд с обоснованием.
6. Краткость > вода. Максимум 4-6 абзацев.
7. Язык ответа = язык вопроса (RU по умолчанию).`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Trim history to last 10 turns
    const trimmed = messages.slice(-10).map((m: { role: string; content: string }) => ({
      role: m.role === "ai" ? "assistant" : m.role,
      content: String(m.content || "").slice(0, 4000),
    }));

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "СЕО-Модуль AI Copilot",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...trimmed],
        temperature: 0.6,
        max_tokens: 800,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("OpenRouter error:", resp.status, errText);
      return new Response(
        JSON.stringify({ error: `AI gateway error ${resp.status}`, detail: errText.slice(0, 500) }),
        { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "Не удалось получить ответ.";

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-copilot error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
