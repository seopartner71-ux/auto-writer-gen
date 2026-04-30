// Generates AI-driven site content for a Site Factory project:
// - About / Contacts / Privacy / Terms page bodies (HTML)
// - Plausible company profile: company_name, address, phone, email, founding year
// - Team members (2-3) with roles
// Saves everything onto the projects row, then returns the data.
//
// Body: { project_id: string }
// Returns: { success, data: { ...site fields } }

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

const PH_INN = "7XXXXXXXXX (заполните после регистрации)";

// Deterministic 10-digit Russian INN with valid mod-11 checksum.
function fnv1a(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const INN_REGIONS = ["77","78","50","23","66","16","52","74","47","61","63","59","02","55","54","24","27","33","73","39"];
function deterministicInn(seed: string): string {
  const region = INN_REGIONS[fnv1a(seed + ":region") % INN_REGIONS.length];
  const body: number[] = [];
  let h = fnv1a(seed + ":body") || 1;
  for (let i = 0; i < 7; i++) {
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    body.push(h % 10);
  }
  const digits = [Number(region[0]), Number(region[1]), ...body];
  const w = [2,4,10,3,5,9,4,6,8];
  let s = 0;
  for (let i = 0; i < 9; i++) s += digits[i] * w[i];
  digits.push((s % 11) % 10);
  return digits.join("");
}
function domainFromSiteName(siteName: string, lang: string): string {
  const slug = String(siteName || "site").toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "")
    .replace(/[а-яё]/g, "") || "site";
  return `${slug}.${lang === "ru" ? "ru" : "com"}`;
}
const MAIL_LOCAL = ["info","hello","team","press","editor","office","mail","contact"];
function deterministicEmail(domain: string, seed: string): string {
  return `${MAIL_LOCAL[fnv1a(seed + ":mail") % MAIL_LOCAL.length]}@${domain}`;
}

function fallback(siteName: string, siteAbout: string, topic: string) {
  const year = new Date().getFullYear() - Math.floor(2 + Math.random() * 8);
  return {
    company_name: siteName,
    company_address: "г. Москва, БЦ «Деловой», офис 305",
    legal_address: "г. Москва, БЦ «Деловой», офис 305",
    company_phone: "+7 (495) 123-45-67",
    company_email: `info@${(siteName || "site").toLowerCase().replace(/[^a-z0-9]/g, "")}.ru`,
    work_hours: "Пн-Пт 9:00-18:00 по московскому времени",
    juridical_inn: PH_INN,
    whatsapp_url: "",
    telegram_url: "",
    vk_url: "",
    clients_count_text: "Более 500 клиентов",
    founding_year: year,
    team_members: [
      { name: "Алексей Смирнов", role: "Главный редактор", bio: "Более 10 лет в нише." },
      { name: "Мария Иванова", role: "Автор", bio: "Готовит обзоры и практические материалы." },
    ],
    authors: [
      { name: "Алексей Смирнов", role: "Главный редактор", bio: "Более 10 лет работает с темой.", avatar_seed: "Aleksey-Smirnov" },
      { name: "Мария Иванова", role: "Автор", bio: "Готовит обзоры и практические материалы.", avatar_seed: "Mariya-Ivanova" },
      { name: "Дмитрий Соколов", role: "Технический редактор", bio: "Отвечает за факт-чекинг.", avatar_seed: "Dmitriy-Sokolov" },
    ],
    site_about: `<p>${siteAbout}</p><p>Мы работаем с ${year} года и публикуем материалы по теме «${topic}» - без воды, на основе практики.</p>`,
    site_contacts: `<p>Если хотите связаться с редакцией, напишите нам или позвоните в рабочие часы.</p>`,
    site_privacy: `<p>Мы уважаем вашу конфиденциальность. Сайт собирает только cookies, необходимые для работы и аналитики, и только после вашего согласия.</p>`,
    site_terms: `<p>Все материалы сайта носят информационный характер. Использование контента возможно с указанием активной ссылки на источник.</p>`,
    business_pages: {},
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, service);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const projectId: string = body.project_id;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing project_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, name, site_name, site_about, language, region")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const siteName = project.site_name || project.name || "Сайт";
    const siteAbout = project.site_about || "";
    const topic = body.topic || siteAbout || siteName;
    const lang = (project.language || "ru").toLowerCase().startsWith("ru") ? "ru" : "en";

    const apiKey = await getOpenRouterKey(admin);
    let payload: ReturnType<typeof fallback> | null = null;

    if (apiKey) {
      const systemPrompt = lang === "ru"
        ? `Ты создаешь правдоподобный, но вымышленный профиль информационного сайта-блога. Возвращай ТОЛЬКО JSON. Не используй слова «эксперт», «эксклюзив», не выдумывай известных людей, адресов с реальной нумерацией известных зданий. Адрес - правдоподобный российский, телефон - российский мобильный/городской формат. Тексты страниц - короткие, в HTML с тегами p, без h1/h2.`
        : `You generate a plausible fictional profile for an informational blog site. Return ONLY JSON. Avoid words like "expert" or "exclusive". Use a plausible US address and US phone format. Page texts are short HTML with <p>, no h1/h2.`;

      const userPrompt = lang === "ru"
        ? `Сайт: «${siteName}». Тема: «${topic}». Краткое описание: «${siteAbout}».
Сгенерируй JSON со строго такими полями:
{
  "company_name": "название компании-владельца",
  "company_address": "правдоподобный адрес офиса",
  "legal_address": "правдоподобный юридический адрес (может совпадать с office)",
  "work_hours": "Пн-Пт 9:00-18:00 (правдоподобный режим)",
  "clients_count_text": "Более N клиентов / партнёров (N от 100 до 5000)",
  "whatsapp_url": "https://wa.me/7XXXXXXXXXX (или пустая строка)",
  "telegram_url": "https://t.me/имя_канала (или пустая строка)",
  "vk_url": "https://vk.com/имя (или пустая строка)",
  "company_phone": "+7 (XXX) XXX-XX-XX",
  "company_email": "info@домен.ru (домен из транслита названия)",
  "founding_year": 2014..2022,
  "team_members": [
    {"name":"Имя Фамилия","role":"должность","bio":"1-2 предложения"},
    {"name":"Имя Фамилия","role":"должность","bio":"1-2 предложения"}
  ],
  "authors": [
    {"name":"Имя Фамилия","role":"должность","bio":"1-2 предложения","avatar_seed":"Имя-Фамилия латиницей"},
    {"name":"Имя Фамилия","role":"должность","bio":"1-2 предложения","avatar_seed":"Имя-Фамилия латиницей"},
    {"name":"Имя Фамилия","role":"должность","bio":"1-2 предложения","avatar_seed":"Имя-Фамилия латиницей"}
  ],
  "site_about": "HTML 2-3 параграфа о редакции сайта <p>...</p>",
  "site_contacts": "HTML 1-2 параграфа: как связаться, часы работы <p>...</p>",
  "site_privacy": "HTML 3-4 параграфа: какие cookies, аналитика, права пользователя, контакт для запросов <p>...</p>",
  "site_terms": "HTML 3-4 параграфа: использование материалов, дисклеймер, ответственность <p>...</p>",
  "business_pages": {
    "vacancies": "HTML страницы Вакансии: 2-3 открытые позиции, формат <h2>Должность</h2><p>описание</p>",
    "portfolio": "HTML страницы Портфолио: 3-5 кейсов с заголовком и описанием",
    "reviews": "HTML страницы Отзывы: 5-7 отзывов в формате <blockquote><p>текст</p><footer>— Имя, должность</footer></blockquote>",
    "faq": "HTML страницы FAQ: 8-12 вопросов в формате <h3>Вопрос?</h3><p>Ответ.</p>",
    "pricing": "HTML страницы Прайс: таблица <table><tr><th>Услуга</th><th>Цена</th></tr>...</table>",
    "guarantees": "HTML страницы Гарантии: 3-4 параграфа о гарантиях работы",
    "delivery": "HTML страницы Доставка и оплата: способы оплаты текстом (Visa/Mastercard/МИР/СБП), сроки доставки",
    "promo": "HTML страницы Акции: 2-3 текущих акции с датами"
  }
}`
        : `Site: "${siteName}". Topic: "${topic}". Description: "${siteAbout}".
Generate JSON with EXACT fields:
{
  "company_name": "owner company name",
  "company_address": "plausible US address",
  "legal_address": "plausible legal address",
  "work_hours": "Mon-Fri 9:00-18:00",
  "clients_count_text": "100+ clients",
  "whatsapp_url": "https://wa.me/1XXXXXXXXXX or empty",
  "telegram_url": "https://t.me/handle or empty",
  "vk_url": "",
  "company_phone": "+1 (XXX) XXX-XXXX",
  "company_email": "info@domain.com",
  "founding_year": 2014..2022,
  "team_members": [
    {"name":"First Last","role":"title","bio":"1-2 sentences"},
    {"name":"First Last","role":"title","bio":"1-2 sentences"}
  ],
  "authors": [
    {"name":"First Last","role":"title","bio":"1-2 sentences","avatar_seed":"First-Last"},
    {"name":"First Last","role":"title","bio":"1-2 sentences","avatar_seed":"First-Last"},
    {"name":"First Last","role":"title","bio":"1-2 sentences","avatar_seed":"First-Last"}
  ],
  "site_about": "HTML 2-3 paragraphs about the editorial team <p>...</p>",
  "site_contacts": "HTML 1-2 paragraphs: how to contact, hours <p>...</p>",
  "site_privacy": "HTML 3-4 paragraphs: cookies, analytics, user rights, contact <p>...</p>",
  "site_terms": "HTML 3-4 paragraphs: usage, disclaimer, liability <p>...</p>",
  "business_pages": {
    "vacancies": "HTML page Careers: 2-3 open positions <h2>Title</h2><p>desc</p>",
    "portfolio": "HTML page Portfolio: 3-5 cases",
    "reviews": "HTML page Reviews: 5-7 testimonials <blockquote><p>text</p><footer>— Name, role</footer></blockquote>",
    "faq": "HTML page FAQ: 8-12 Q&A as <h3>Q?</h3><p>A.</p>",
    "pricing": "HTML page Pricing: <table>...</table>",
    "guarantees": "HTML page Guarantees: 3-4 paragraphs",
    "delivery": "HTML page Shipping & Payment: payment methods as plain text (Visa/Mastercard), delivery terms",
    "promo": "HTML page Promotions: 2-3 current offers with dates"
  }
}`;

      try {
        const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://seo-modul.pro",
            "X-Title": "SEO-Module Site Content",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            temperature: 0.9,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        });
        if (aiRes.ok) {
          const data = await aiRes.json();
          const raw = String(data?.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(raw);
          const sanAuthors = Array.isArray(parsed.authors) ? parsed.authors.slice(0, 5).map((a: any) => ({
            name: String(a?.name || "").slice(0, 80),
            role: String(a?.role || "").slice(0, 80),
            bio:  String(a?.bio  || "").slice(0, 320),
            avatar_seed: String(a?.avatar_seed || a?.name || "author").replace(/\s+/g, "-").slice(0, 60),
          })) : [];
          const bp = parsed.business_pages && typeof parsed.business_pages === "object" ? parsed.business_pages : {};
          const allowedKeys = ["vacancies","portfolio","reviews","faq","pricing","guarantees","delivery","promo"];
          const business_pages: Record<string, string> = {};
          for (const k of allowedKeys) {
            if (typeof bp[k] === "string") business_pages[k] = String(bp[k]).slice(0, 12000);
          }
          payload = {
            company_name: String(parsed.company_name || siteName).slice(0, 120),
            company_address: String(parsed.company_address || "").slice(0, 240),
            legal_address:   String(parsed.legal_address   || parsed.company_address || "").slice(0, 240),
            work_hours:      String(parsed.work_hours      || "Пн-Пт 9:00-18:00").slice(0, 120),
            juridical_inn:   PH_INN,
            whatsapp_url:    String(parsed.whatsapp_url || "").slice(0, 200),
            telegram_url:    String(parsed.telegram_url || "").slice(0, 200),
            vk_url:          String(parsed.vk_url || "").slice(0, 200),
            clients_count_text: String(parsed.clients_count_text || "Более 500 клиентов").slice(0, 80),
            company_phone: String(parsed.company_phone || "").slice(0, 40),
            company_email: String(parsed.company_email || "").slice(0, 120),
            founding_year: Number(parsed.founding_year) || (new Date().getFullYear() - 5),
            team_members: Array.isArray(parsed.team_members) ? parsed.team_members.slice(0, 4) : [],
            authors: sanAuthors,
            site_about: String(parsed.site_about || "").slice(0, 4000),
            site_contacts: String(parsed.site_contacts || "").slice(0, 2000),
            site_privacy: String(parsed.site_privacy || "").slice(0, 6000),
            site_terms: String(parsed.site_terms || "").slice(0, 6000),
            business_pages,
          };
        } else {
          console.error("[generate-site-content] AI HTTP", aiRes.status, (await aiRes.text()).slice(0, 200));
        }
      } catch (e: any) {
        console.error("[generate-site-content] AI error:", e?.message);
      }
    } else {
      console.warn("[generate-site-content] no OpenRouter key, using fallback");
    }

    if (!payload) payload = fallback(siteName, siteAbout, topic);

    const { error: updErr } = await supabase
      .from("projects")
      .update({
        company_name: payload.company_name,
        company_address: payload.company_address,
        legal_address: (payload as any).legal_address ?? payload.company_address,
        work_hours: (payload as any).work_hours ?? null,
        juridical_inn: (payload as any).juridical_inn ?? PH_INN,
        whatsapp_url: (payload as any).whatsapp_url ?? null,
        telegram_url: (payload as any).telegram_url ?? null,
        vk_url: (payload as any).vk_url ?? null,
        clients_count_text: (payload as any).clients_count_text ?? null,
        company_phone: payload.company_phone,
        company_email: payload.company_email,
        founding_year: payload.founding_year,
        team_members: payload.team_members,
        authors: (payload as any).authors ?? [],
        business_pages: (payload as any).business_pages ?? {},
        site_about: payload.site_about,
        site_contacts: payload.site_contacts,
        site_privacy: payload.site_privacy,
        site_terms: payload.site_terms,
      })
      .eq("id", projectId);
    if (updErr) {
      console.error("[generate-site-content] update err:", updErr.message);
      return new Response(JSON.stringify({ error: updErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, data: payload }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[generate-site-content] ERROR:", err?.message, err?.stack);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});