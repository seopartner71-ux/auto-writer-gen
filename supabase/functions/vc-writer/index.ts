// vc.ru Writer - generates an article tuned for vc.ru editorial format.
// Body: { format, topic, thesis?, audience?, tone?, length?, generate_cover? }
// Returns: { markdown, meta:{title,subtitle,tags[],ps_question}, checklist[{label,ok,hint}], cover_data_url? }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatJson, chatComplete } from "../_shared/aiClient.ts";

type Format = "guide" | "rating" | "review" | "case";

const FORMAT_BRIEF: Record<Format, string> = {
  guide: "Статья-разбор / пошаговый гайд. Структура: проблема -> почему это важно -> 4-7 шагов с цифрами и подводными камнями -> итог -> что делать дальше.",
  rating: "Рейтинг / подборка ТОП-N. Структура: критерии отбора (3-5 пунктов) -> карточки по каждому пункту (название, для кого, плюсы, минусы, цена/условия, личная оценка 1-10) -> сводная таблица -> вывод 'кому что брать'.",
  review: "Обзор продукта/сервиса. Структура: что это и для кого -> как тестировали (контекст, срок, задачи) -> что понравилось (3-5) -> что бесит (3-5) -> цена и альтернативы -> кому брать, кому пройти мимо.",
  case: "Кейс / антикейс / мнение. Структура: лид с конфликтом или цифрой потерь/прибыли -> предыстория (кто мы, что хотели) -> что сделали по шагам -> что пошло не так и почему -> цифры до/после -> выводы и спорный тезис в финале.",
};

const VC_PROTOCOL = `
EDITORIAL PROTOCOL vc.ru (ОБЯЗАТЕЛЬНО):
1. ЛИД (первые 3-4 строки): крючок - цифра, провал, спорный тезис или личная сцена. БЕЗ "В современном мире", "Сегодня многие".
2. ТОН: разговорный, как практик пишет коллегам. Короткие предложения. Канцелярит запрещен. Без "осуществляется", "является", "представляет собой".
3. ЦИФРЫ И КОНКРЕТИКА: минимум 4-6 цифр в тексте (суммы, проценты, сроки, число клиентов). Если точных нет - "по нашей практике X из Y".
4. ПОДЗАГОЛОВКИ-КРЮЧКИ: H2 формулируются как вопрос, провокация или результат ("Потеряли 1,2 млн на одной ошибке"). Не "Введение", "Заключение".
5. ЛИЧНЫЙ ОПЫТ: вставлять "мы попробовали", "у клиента было", "сам столкнулся" - даже если обобщенно. БЕЗ выдуманных имен экспертов и компаний.
6. ОШИБКИ/ПРОВАЛЫ: обязательно 1-2 момента "что пошло не так" - vc.ru любит честность.
7. ФИНАЛ: P.S. с прямым вопросом аудитории для комментариев ("А вы как делаете X? Расскажите в комментариях").
8. ДЛИНА: целевая 4500-6500 знаков (можно ±20%). Слишком короткое не попадает в топ, слишком длинное не дочитывают.
9. ФОРМАТИРОВАНИЕ: markdown с H2, списками, цитатами (>), таблицами где уместно. БЕЗ жирного (**). БЕЗ ё - заменяй на е.
10. ЗАГОЛОВОК (до 90 символов): цифра + конкретика + интрига. Примеры: "Как мы потеряли 400 000 на SEO и что спасло проект", "ТОП-7 CRM 2026: сравнили на реальных задачах за 3 месяца".
11. ТЕГИ: 4-6 коротких тегов через запятую (маркетинг, кейс, SEO, и т.п.).
`.trim();

function buildPrompt(p: {
  format: Format; topic: string; thesis: string; audience: string; tone: string; length: number;
}): { system: string; user: string } {
  const system = `Ты - редактор vc.ru с 5-летним опытом. Твоя задача - написать материал, который попадет в топ vc.ru и зайдет в Google/Yandex. Пиши на русском, без буквы ё (заменяй на е).\n\n${VC_PROTOCOL}\n\nФОРМАТ ЭТОГО МАТЕРИАЛА: ${FORMAT_BRIEF[p.format]}`;
  const user = `Тема: ${p.topic}\nГлавный тезис: ${p.thesis || "сформулируй сам исходя из темы"}\nАудитория vc.ru: ${p.audience || "предприниматели, маркетологи, продактменеджеры"}\nТон: ${p.tone || "экспертно-разговорный с легкой провокацией"}\nЦелевая длина: ${p.length || 5500} знаков (±20%).\n\nВерни строго JSON:\n{\n  "title": "заголовок до 90 символов",\n  "subtitle": "подзаголовок 1-2 предложения, продает клик",\n  "tags": ["тег1","тег2",...],\n  "ps_question": "вопрос аудитории для P.S.",\n  "markdown": "полный текст материала в markdown с H2, списками. Включи в конец строку 'P.S. <ps_question>'"\n}`;
  return { system, user };
}

function ruEReplace(s: string): string {
  return (s || "").replace(/ё/g, "е").replace(/Ё/g, "Е");
}

function stripText(md: string): string {
  return md.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`\-\|]/g, " ").replace(/\s+/g, " ").trim();
}

function buildChecklist(md: string, ps: string): Array<{ label: string; ok: boolean; hint: string }> {
  const text = stripText(md);
  const chars = text.length;
  const digitsCount = (text.match(/\b\d+[\d\s.,%]*/g) || []).length;
  const h2 = (md.match(/^##\s+/gm) || []).length;
  const hasPS = /P\.?\s*S\.?/i.test(md) || (ps && md.includes(ps));
  const hasPersonal = /(мы\s|у\s+клиента|на\s+практик|сам\s+столк|попробовал)/i.test(text);
  const hasMistake = /(ошибк|провал|пошло\s+не\s+так|потеряли|не\s+сработал)/i.test(text);
  const hasBold = /\*\*[^*]+\*\*/.test(md);
  const hasYo = /ё|Ё/.test(md);
  return [
    { label: "Длина 3500-8000 знаков", ok: chars >= 3500 && chars <= 8000, hint: `сейчас ${chars}` },
    { label: "Минимум 4 цифры/факта", ok: digitsCount >= 4, hint: `нашли ${digitsCount}` },
    { label: "Минимум 3 подзаголовка H2", ok: h2 >= 3, hint: `${h2} H2` },
    { label: "Личный опыт ('мы', 'на практике')", ok: hasPersonal, hint: hasPersonal ? "ок" : "добавь сцену" },
    { label: "Упомянут провал/ошибка", ok: hasMistake, hint: hasMistake ? "ок" : "vc.ru любит честность" },
    { label: "Есть P.S. с вопросом", ok: !!hasPS, hint: hasPS ? "ок" : "добавь P.S." },
    { label: "Нет жирного (**)", ok: !hasBold, hint: hasBold ? "убери **" : "ок" },
    { label: "Нет буквы ё", ok: !hasYo, hint: hasYo ? "замени на е" : "ок" },
  ];
}

async function generateCover(prompt: string): Promise<string | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-image-2",
        prompt: `Editorial cover image for a vc.ru article. ${prompt}. Style: modern minimal, soft gradient, business-tech aesthetic, no text on image, 16:9 composition.`,
        size: "1536x1024",
        quality: "low",
        n: 1,
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const b64 = j?.data?.[0]?.b64_json;
    return b64 ? `data:image/png;base64,${b64}` : null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const format = (body.format as Format) || "guide";
    if (!["guide", "rating", "review", "case"].includes(format)) {
      return errorResponse("invalid format", 400);
    }
    const topic = String(body.topic || "").trim();
    if (topic.length < 5) return errorResponse("topic is required (min 5 chars)", 400);
    const thesis = String(body.thesis || "").slice(0, 600);
    const audience = String(body.audience || "").slice(0, 200);
    const tone = String(body.tone || "").slice(0, 100);
    const length = Math.min(8000, Math.max(2500, Number(body.length) || 5500));
    const generateCover = !!body.generate_cover;

    const admin = adminClient();
    const { data: orRow } = await admin
      .from("api_keys")
      .select("api_key")
      .eq("provider", "openrouter")
      .eq("is_valid", true)
      .maybeSingle();
    const apiKey = orRow?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OpenRouter key not configured", 500);

    const { system, user } = buildPrompt({ format, topic, thesis, audience, tone, length });

    const result = await chatJson<{
      title: string; subtitle: string; tags: string[]; ps_question: string; markdown: string;
    }>({
      apiKey,
      model: "google/gemini-2.5-pro",
      system,
      user,
      temperature: 0.85,
      maxTokens: 6000,
      timeoutMs: 120_000,
      appTitle: "vc.ru Writer",
      retries: 1,
    });

    const data = result.data || ({} as any);
    let markdown = ruEReplace(String(data.markdown || "")).replace(/\*\*([^*]+)\*\*/g, "$1");
    const title = ruEReplace(String(data.title || "")).slice(0, 90);
    const subtitle = ruEReplace(String(data.subtitle || "")).slice(0, 240);
    const ps_question = ruEReplace(String(data.ps_question || ""));
    const tags = Array.isArray(data.tags) ? data.tags.slice(0, 6).map((t: any) => ruEReplace(String(t)).slice(0, 30)) : [];

    // Ensure P.S. exists
    if (ps_question && !/P\.?\s*S\.?/i.test(markdown)) {
      markdown += `\n\nP.S. ${ps_question}`;
    }

    let cover_data_url: string | null = null;
    if (generateCover) {
      cover_data_url = await generateCover(`${title}. ${subtitle}`);
    }

    const checklist = buildChecklist(markdown, ps_question);

    return jsonResponse({
      ok: true,
      markdown,
      meta: { title, subtitle, tags, ps_question },
      checklist,
      cover_data_url,
      stats: { chars: stripText(markdown).length, model: result.model },
    });
  } catch (e: any) {
    console.error("[vc-writer] error", e?.message || e);
    const msg = e?.message || "Unknown error";
    const status = e?.status || (e?.kind === "budget" ? 402 : e?.kind === "rate_limit" ? 429 : 500);
    return errorResponse(msg, status);
  }
});