// Generate a single block of a commercial page (service / category / product / local).
// Auth -> plan gate -> deduct 1 credit -> OpenRouter -> return { content, word_count }.
// Refunds the credit on upstream failure.

import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { withTimeout } from "../_shared/withTimeout.ts";

type PageType = "service" | "category" | "product" | "local";

interface Brief {
  niche?: string;
  keyword?: string;
  tone?: string;
  company?: string;
  city?: string;
  district?: string;
  utp?: string;
  benefits?: string[];
  has_prices?: boolean;
  has_guarantees?: boolean;
  shop_name?: string;
  lsi?: string;
  items_count?: number;
  product_name?: string;
  sku?: string;
  features?: string;
  audience?: string;
  services?: string;
  hours?: string;
  [k: string]: unknown;
}

interface ReqBody {
  block_type: string;
  page_type: PageType;
  brief: Brief;
  target_words: number;
  model?: string;
}

// Per-block instruction snippets keyed by `${page_type}:${block_type}`.
const BLOCK_INSTRUCTIONS: Record<string, string> = {
  // Service
  "service:h1_lead":
    "Сформируй H1 (тег <h1>) и лид-абзац (<p>). H1 включает ключ органично. Лид - сразу о выгоде, без 'добро пожаловать'.",
  "service:benefits":
    "Список выгод услуги. <h2>Выгоды</h2><ul> с 5-7 пунктами. Каждый пункт: <li><strong>заголовок</strong> - короткое объяснение</li>.",
  "service:how_we_work":
    "Блок 'Как мы работаем'. <h2>, потом <ol> с 4-6 этапами. Каждый этап: что делаем, сроки, что получает клиент.",
  "service:utp":
    "Блок 'Почему мы'. <h2>, далее 3-5 пунктов <ul><li> с конкретными аргументами (без штампов).",
  "service:prices":
    "Блок 'Цены' или 'Пакеты услуг'. <h2>. Если в брифе нет конкретных цифр - укажи диапазоны или принципы формирования цены. Без выдуманных сумм.",
  "service:faq":
    "Блок FAQ. <h2>Частые вопросы</h2>. 5 пар: <h3>вопрос</h3><p>ответ</p>. Прямой ответ в первом предложении.",
  "service:cta":
    "Короткий CTA-блок. <h2> с призывом и <p> с одним конкретным шагом. Без 'оставьте заявку и наш менеджер свяжется'.",
  "service:seo_text":
    "Развернутый SEO-текст внизу страницы. <h2>. Раскрой тему услуги, включи LSI и ключ органично. Без воды.",
  "service:geo":
    "Гео-абзац под город. <h2>Услуга в городе</h2><p>...</p>. Конкретика про работу в этом городе.",

  // Category
  "category:intro":
    "Вводный текст категории. <h1>, затем <p> с краткой характеристикой ассортимента и аудитории. Ключ органично.",
  "category:benefits":
    "<h2>Преимущества магазина</h2><ul><li>... 5-6 пунктов конкретно.",
  "category:category_desc":
    "Описание категории: для кого, как выбрать, на что смотреть. <h2>. Используй LSI из брифа.",
  "category:seo_text":
    "Развернутый SEO-текст внизу. <h2>. Раскрой подкатегории, типы товаров, сценарии использования. Ключ органично.",
  "category:faq":
    "<h2>Частые вопросы</h2>. 5 пар <h3>/<p>. Вопросы про выбор, доставку, гарантии.",

  // Product
  "product:short_desc":
    "Краткое описание товара. <p> на 100-150 слов. Главная выгода в первом предложении.",
  "product:features_benefits":
    "<h2>Характеристики и выгоды</h2><table><thead><tr><th>Характеристика</th><th>Что это даёт</th></tr></thead><tbody>... Используй список из брифа.",
  "product:full_desc":
    "Полное описание товара. <h2>. Сценарии, отличия, для кого. Без воды и общих фраз.",
  "product:for_whom":
    "<h2>Кому подойдёт</h2>. <ul><li>конкретные сегменты аудитории с пояснением.",
  "product:faq":
    "<h2>Вопросы о товаре</h2>. 5 пар <h3>/<p>. Вопросы про комплектацию, гарантию, совместимость, доставку.",

  // Local
  "local:h1_lead":
    "H1 с услугой и городом. <p> лид с конкретикой про локальное присутствие.",
  "local:services_list":
    "<h2>Услуги</h2><ul><li> на основе списка из брифа. Каждый пункт - что входит и для кого.",
  "local:utp":
    "<h2>Почему выбирают нас</h2>. 4-6 пунктов <ul><li> с конкретными аргументами под локальный бизнес.",
  "local:coverage":
    "<h2>Зона обслуживания</h2>. Перечисли районы/округа. Если есть адрес - укажи ориентиры. Без вымысла.",
  "local:faq":
    "<h2>Частые вопросы</h2>. 5 пар <h3>/<p>. Вопросы про график, выезд, оплату, гарантии.",
  "local:cta":
    "CTA с локальным акцентом. <h2> + <p> с конкретным шагом (записаться, позвонить, узнать стоимость).",
  "local:geo_seo":
    "Развернутый SEO-блок 'Услуга + город'. <h2>. Раскрой специфику услуги в этом городе/регионе. Ключ органично.",
};

const NANO_FORBIDDEN_BLOCKS = new Set(["seo_text", "geo_seo", "prices"]);
const NANO_ALLOWED_TYPES = new Set<PageType>(["service", "local"]);

function countWords(text: string): number {
  return text.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

function buildPrompt(body: ReqBody): { system: string; user: string } {
  const { page_type, block_type, brief, target_words } = body;
  const key = `${page_type}:${block_type}`;
  const instruction = BLOCK_INSTRUCTIONS[key] ?? "Сгенерируй блок коммерческой страницы. Чистый HTML.";

  const briefLines: string[] = [];
  if (brief.niche) briefLines.push(`Ниша: ${brief.niche}`);
  if (brief.keyword) briefLines.push(`Ключевой запрос: ${brief.keyword}`);
  if (brief.tone) briefLines.push(`Тон: ${brief.tone}`);
  if (brief.company) briefLines.push(`Компания: ${brief.company}`);
  if (brief.shop_name) briefLines.push(`Магазин: ${brief.shop_name}`);
  if (brief.product_name) briefLines.push(`Товар: ${brief.product_name}`);
  if (brief.sku) briefLines.push(`Артикул: ${brief.sku}`);
  if (brief.city) briefLines.push(`Город: ${brief.city}`);
  if (brief.district) briefLines.push(`Район: ${brief.district}`);
  if (brief.utp) briefLines.push(`УТП: ${brief.utp}`);
  if (brief.benefits?.length) briefLines.push(`Преимущества: ${brief.benefits.join(", ")}`);
  if (brief.features) briefLines.push(`Характеристики:\n${brief.features}`);
  if (brief.audience) briefLines.push(`Аудитория: ${brief.audience}`);
  if (brief.services) briefLines.push(`Список услуг:\n${brief.services}`);
  if (brief.hours) briefLines.push(`Режим работы: ${brief.hours}`);
  if (brief.lsi) briefLines.push(`LSI: ${brief.lsi}`);
  if (typeof brief.items_count === "number") briefLines.push(`Товаров в категории: ${brief.items_count}`);
  if (typeof brief.has_prices === "boolean") briefLines.push(`Цены на сайте: ${brief.has_prices ? "да" : "нет"}`);
  if (typeof brief.has_guarantees === "boolean") briefLines.push(`Гарантии: ${brief.has_guarantees ? "да" : "нет"}`);

  const system = `Ты профессиональный SEO-копирайтер и маркетолог. Пишешь коммерческий текст для сайта на русском языке.
Тип страницы: ${page_type}. Тип блока: ${block_type}.

Правила:
- Живой язык, без воды и канцелярита.
- Запрещены клише: "динамично развивающаяся компания", "команда профессионалов", "индивидуальный подход", "широкий ассортимент", "высокое качество по доступным ценам".
- Конкретные факты, цифры и выгоды вместо общих слов.
- Ключ органично, не переспамливай.
- НЕ используй букву "е с двумя точками" - только обычную "е".
- НЕ используй markdown жирный (**). Используй <strong> только если предусмотрено инструкцией блока.
- Не добавляй выдуманные контакты, адреса, цены, отзывы, имена сотрудников.
- Если в брифе нет данных - пиши общими формулировками или опусти пункт.
- Целевой объём: примерно ${target_words} слов (допуск ±20%).
- Формат вывода: ЧИСТЫЙ HTML без обёрток в тройных бэктиках. Только теги h1/h2/h3/p/ul/ol/li/strong/em/table/thead/tbody/tr/th/td.
- Никаких пояснений ДО или ПОСЛЕ HTML. Только разметка.

Инструкция для этого блока:
${instruction}`;

  const user = `Бриф:\n${briefLines.join("\n") || "(данных нет)"}\n\nСгенерируй блок.`;
  return { system, user };
}

async function getUserPlan(userId: string): Promise<string> {
  const sb = adminClient();
  const { data } = await sb.from("profiles").select("plan").eq("id", userId).maybeSingle();
  return (data?.plan as string) || "basic";
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;

    let body: ReqBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON", 400);
    }

    if (!body?.block_type || !body?.page_type || !body?.brief) {
      return errorResponse("Missing required fields: block_type, page_type, brief", 400);
    }
    const target = Math.max(40, Math.min(1500, Number(body.target_words) || 200));
    body.target_words = target;

    const plan = await getUserPlan(userId);
    if (plan === "basic") {
      if (!NANO_ALLOWED_TYPES.has(body.page_type)) {
        return errorResponse("Этот тип страницы доступен на тарифе PRO", 403, { upgrade_required: "pro" });
      }
      if (NANO_FORBIDDEN_BLOCKS.has(body.block_type)) {
        return errorResponse("Этот блок доступен на тарифе PRO", 403, { upgrade_required: "pro" });
      }
    }

    const sb = adminClient();

    const { data: deduct, error: dedErr } = await sb.rpc("deduct_credits_v2", {
      p_user_id: userId,
      p_amount: 1,
      p_reason: "commercial_block",
      p_model_key: null,
      p_article_id: null,
      p_metadata: { block_type: body.block_type, page_type: body.page_type },
    });
    if (dedErr) return errorResponse(`Credit deduction failed: ${dedErr.message}`, 500);
    const dedResult = deduct as { ok: boolean; reason?: string; balance?: number; bypassed?: boolean };
    if (!dedResult?.ok) {
      return errorResponse(dedResult?.reason === "insufficient_credits" ? "Недостаточно кредитов" : `Credit error: ${dedResult?.reason}`, 402);
    }

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) {
      await sb.rpc("refund_credits", { p_user_id: userId, p_amount: 1, p_reason: "commercial_block_refund:no_key" });
      return errorResponse("OPENROUTER_API_KEY not configured", 500);
    }

    const model = body.model || "google/gemini-2.5-flash";
    const { system, user } = buildPrompt(body);

    let content = "";
    try {
      const upstream = await withTimeout(
        fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://seo-modul.pro",
            "X-Title": "СЕО-Модуль Commercial",
          },
          body: JSON.stringify({
            model,
            max_tokens: Math.min(3000, target * 3),
            temperature: 0.75,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        }),
        60_000,
        "openrouter timeout",
      );

      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        throw new Error(`OpenRouter ${upstream.status}: ${text.slice(0, 200)}`);
      }
      const json = await upstream.json();
      content = (json?.choices?.[0]?.message?.content || "").trim();
    } catch (e) {
      await sb.rpc("refund_credits", {
        p_user_id: userId,
        p_amount: 1,
        p_reason: "commercial_block_refund:upstream",
        p_article_id: null,
        p_metadata: { error: e instanceof Error ? e.message : String(e), block_type: body.block_type },
      });
      return errorResponse(`Generation failed: ${e instanceof Error ? e.message : "unknown"}`, 502);
    }

    if (!content) {
      await sb.rpc("refund_credits", {
        p_user_id: userId, p_amount: 1, p_reason: "commercial_block_refund:empty",
      });
      return errorResponse("Empty response from model", 502);
    }

    content = content.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
    content = content.replace(/ё/g, "е").replace(/Ё/g, "Е");

    return jsonResponse({
      content,
      word_count: countWords(content),
      block_type: body.block_type,
    });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});
