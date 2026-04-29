// Generate randomized site config (name, about, copyright, contacts, privacy, author) via OpenRouter
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getOpenRouterKey(): Promise<string> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);
    const { data } = await admin.from("api_keys").select("api_key").eq("provider", "openrouter").eq("is_valid", true).single();
    if (data?.api_key) return data.api_key;
  } catch (_) { /* ignore */ }
  const envKey = Deno.env.get("OPENROUTER_API_KEY");
  if (envKey) return envKey;
  throw new Error("OpenRouter API key not configured");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { domain, project_name, language, topic } = await req.json();
    const lang = (language || "ru").toLowerCase().startsWith("en") ? "en" : "ru";
    const niche = topic || project_name || domain || (lang === "ru" ? "общая тематика" : "general topic");

    const OPENROUTER_API_KEY = await getOpenRouterKey();

    const sys = lang === "ru"
      ? `Ты - генератор настроек SEO-блога. Возвращай ТОЛЬКО JSON. Все тексты на русском, без буквы 'е' в виде ё (используй 'е'). Без markdown, без эмодзи, без длинных тире (используй обычный дефис -). Каждый запуск - новые уникальные значения (рандомизация).`
      : `You generate SEO blog settings. Return ONLY JSON. All texts in English. No markdown, no emoji. Each run must produce unique randomized values.`;

    const user = lang === "ru"
      ? `Тематика сайта: ${niche}\nДомен: ${domain || "не указан"}\n\nСгенерируй уникальные настройки сайта:\n- site_name: короткое название блога (3-6 слов), отражает тематику\n- site_about: текст для страницы "О нас" (2-3 предложения, 200-300 символов), без клише про "команду экспертов"\n- site_copyright: короткое название бренда для футера (1-3 слова)\n- site_contacts: контакты (email вида info@домен или похожий, телефон РФ +7 случайный, адрес города РФ), 1-2 строки\n- site_privacy: краткий текст политики конфиденциальности (3-4 предложения, 300-400 символов)\n- author_name: реалистичное русское ФИО (Имя Фамилия)\n- author_bio: био автора (1 предложение, 80-150 символов), связано с тематикой`
      : `Site topic: ${niche}\nDomain: ${domain || "not set"}\n\nGenerate unique site settings:\n- site_name: short blog name (3-6 words) reflecting the topic\n- site_about: about page text (2-3 sentences, 200-300 chars), avoid cliches\n- site_copyright: short brand name for footer (1-3 words)\n- site_contacts: contacts (email like info@domain, US phone, city), 1-2 lines\n- site_privacy: brief privacy policy text (3-4 sentences, 300-400 chars)\n- author_name: realistic full name\n- author_bio: author bio (1 sentence, 80-150 chars), related to the topic`;

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Module Site Config",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 1.1,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        tools: [{
          type: "function",
          function: {
            name: "site_config",
            description: "Site config fields",
            parameters: {
              type: "object",
              properties: {
                site_name: { type: "string" },
                site_about: { type: "string" },
                site_copyright: { type: "string" },
                site_contacts: { type: "string" },
                site_privacy: { type: "string" },
                author_name: { type: "string" },
                author_bio: { type: "string" },
              },
              required: ["site_name", "site_about", "site_copyright", "site_contacts", "site_privacy", "author_name", "author_bio"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "site_config" } },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(JSON.stringify({ error: `AI error ${resp.status}`, detail: text.slice(0, 400) }), {
        status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("Empty AI response");
    const parsed = JSON.parse(args);

    // Sanitize per project rules
    const clean = (s: string) => String(s || "")
      .replace(/ё/g, "е").replace(/Ё/g, "Е")
      .replace(/[—–]/g, "-")
      .replace(/\*\*/g, "")
      .trim();

    const out = {
      site_name: clean(parsed.site_name),
      site_about: clean(parsed.site_about),
      site_copyright: clean(parsed.site_copyright),
      site_contacts: clean(parsed.site_contacts),
      site_privacy: clean(parsed.site_privacy),
      author_name: clean(parsed.author_name),
      author_bio: clean(parsed.author_bio),
    };

    // Random avatar
    const gender = Math.random() > 0.5 ? "men" : "women";
    const idx = Math.floor(Math.random() * 70) + 1;
    const author_avatar = `https://randomuser.me/api/portraits/${gender}/${idx}.jpg`;

    return new Response(JSON.stringify({ config: { ...out, author_avatar } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-site-config error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});