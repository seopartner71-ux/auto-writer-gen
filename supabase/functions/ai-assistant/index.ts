import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

const SYSTEM_PROMPT_BASE = `Ты AI-помощник сервиса СЕО-Модуль (seo-modul.pro).
Помогаешь пользователям с SEO вопросами и вопросами по функционалу сервиса.

Функционал СЕО-Модуля:
- Генерация SEO статей с AI (Boutique и Factory режимы)
- Карта тем с кластеризацией ключевых слов
- Realtime SEO Score (круговой индикатор)
- Тургенев проверка (риск Баден-Бадена)
- AI-аудит статьи по URL (/article-audit)
- Bulk генерация (Factory Mode, до 500+ запросов из CSV)
- WordPress автопубликация (REST API + Rank Math)
- Smart Research через Serper.dev (анализ ТОП-10, LSI, PAA)
- Структура статьи из ТОП-10 конкурентов
- 15+ авторских профилей (Persona Engine)
- Быстрый старт и Эксперт режим
- Stealth Engine (антидетект для Originality.ai/GPTZero)
- AI Radar (отслеживание упоминаний бренда в ChatGPT/Perplexity/Gemini)
- Site Factory (авто-деплой PBN на Vercel/Cloudflare)
- Мгновенная индексация (Google Indexing API + IndexNow)

Тарифы: NANO, PRO, FACTORY (4 990 ₽ / 59$).

Правила ответа:
- На русском языке
- Конкретно и по делу
- Со ссылками на функционал (например /articles, /article-audit, /radar, /pricing)
- Не длиннее 200 слов
- Используй эмодзи для читаемости
- НИКОГДА не используй жирный (**) и букву "ё" (всегда "е")
- Используй обычные дефисы (-)`;

const PLAN_LIMITS: Record<string, number> = {
  free: 20, basic: 100, pro: 100, factory: -1,
};

function detectCategories(q: string): string[] {
  const t = q.toLowerCase();
  const cats = new Set<string>();
  if (/контент|статья|текст|заголов|меta|description|writing/.test(t)) cats.add("content");
  if (/lsi|семант|ключев|keyword|тема|кластер/.test(t)) cats.add("semantic");
  if (/техн|robots|sitemap|редирект|https|core web|скорост/.test(t)) cats.add("technical");
  if (/eeat|экспертн|trust|автор/.test(t)) cats.add("eeat");
  if (/ссылк|link|backlink|перелинк/.test(t)) cats.add("links");
  if (/индекс|google index|indexnow/.test(t)) cats.add("indexing");
  if (/geo|sge|ai overview|generative/.test(t)) cats.add("geo");
  if (/ux|удобство|поведен/.test(t)) cats.add("ux");
  if (/title|заголовок страниц/.test(t)) cats.add("title");
  if (/structure|структур|h1|h2/.test(t)) cats.add("structure");
  return Array.from(cats);
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;

    const body = await req.json().catch(() => ({}));
    const messages: Array<{ role: string; content: string }> = Array.isArray(body?.messages) ? body.messages : [];
    if (messages.length === 0) return jsonResponse({ error: "messages required" }, 400);
    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";
    const lang = body?.language === "en" ? "en" : "ru";

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Rate limit by plan
    const { data: profile } = await admin.from("profiles").select("plan").eq("id", userId).maybeSingle();
    const plan = (profile?.plan || "free") as string;
    const isAdmin = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    const limit = isAdmin.data ? -1 : (PLAN_LIMITS[plan] ?? 20);

    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await admin.from("ai_assistant_usage")
      .select("count").eq("user_id", userId).eq("date", today).maybeSingle();
    const used = usage?.count || 0;
    if (limit !== -1 && used >= limit) {
      return jsonResponse({ error: "limit_reached", limit, used }, 429);
    }

    // Pull relevant tips
    let cats = detectCategories(lastUser);
    if (cats.length === 0) cats = ["content", "semantic", "technical", "geo"];
    const { data: tips } = await admin.from("seo_tips")
      .select("tip, category")
      .eq("language", lang)
      .eq("is_active", true)
      .in("category", cats)
      .limit(20);
    const tipsText = (tips || []).map(t => `[${t.category}] ${t.tip}`).join("\n");

    const system = `${SYSTEM_PROMPT_BASE}\n\nБаза знаний (используй при ответе):\n${tipsText || "(нет релевантных советов)"}`;

    const trimmed = messages.slice(-10).map(m => ({
      role: m.role === "ai" ? "assistant" : m.role,
      content: String(m.content || "").slice(0, 4000),
    }));

    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")?.trim().replace(/[^\x20-\x7E]/g, "");
    if (!OPENROUTER_API_KEY) return jsonResponse({ error: "OPENROUTER_API_KEY not configured" }, 500);

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Module AI Assistant",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: system }, ...trimmed],
        temperature: 0.6,
        max_tokens: 600,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return jsonResponse({ error: `AI gateway error ${resp.status}`, detail: errText.slice(0, 300) }, resp.status);
    }
    const data = await resp.json();
    let content: string = data?.choices?.[0]?.message?.content || "Не удалось получить ответ.";
    // Enforce formatting rules
    content = content.replace(/\*\*/g, "").replace(/ё/g, "е").replace(/Ё/g, "Е").replace(/—/g, "-").replace(/–/g, "-");

    // Increment usage
    await admin.from("ai_assistant_usage").upsert(
      { user_id: userId, date: today, count: used + 1, updated_at: new Date().toISOString() },
      { onConflict: "user_id,date" }
    );

    return jsonResponse({ content, used: used + 1, limit });
  } catch (e) {
    console.error("ai-assistant error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});