// Generate a single block of a commercial page (service / category / product / local).
// Auth -> plan gate -> deduct 1 credit -> OpenRouter -> return { content, word_count }.
// Refunds the credit on upstream failure.

import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdminOrStaff } from "../_shared/auth.ts";
import { withTimeout } from "../_shared/withTimeout.ts";
import { applyStealthPostProcess, buildStealthSystemAddon } from "../_shared/stealth.ts";
import { resolveOpenRouterModel } from "../_shared/aiModel.ts";

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
  stop_words?: string;
  /** URL parser fields (optional) — used to ground the AI in real client data. */
  source_url?: string;
  parsed_phone?: string;
  parsed_address?: string;
  parsed_work_hours?: string;
  parsed_prices?: string;
  parsed_guarantees?: string;
  parsed_services?: string[];
  existing_h2?: string[];
  existing_blocks?: string[];
  [k: string]: unknown;
}

interface ReqBody {
  block_type: string;
  page_type: PageType;
  brief: Brief;
  target_words: number;
  model?: string;
  /** Optional AI-recommended block: free-form instruction overrides the static one. */
  custom_instruction?: string;
  /** Optional title hint for the AI-recommended block (used inside the instruction). */
  custom_title?: string;
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

/** Roughly count keyword occurrences in plain text. Case-insensitive whole-word-ish. */
function keywordDensity(html: string, keyword: string): { count: number; density: number; total: number } {
  const plain = html.replace(/<[^>]+>/g, " ").toLowerCase();
  const total = plain.trim().split(/\s+/).filter(Boolean).length || 1;
  const kw = (keyword || "").trim().toLowerCase();
  if (!kw) return { count: 0, density: 0, total };
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "gi");
  const count = (plain.match(re) || []).length;
  return { count, density: count / total, total };
}

/** Strip ```html fences if model wrapped the output. */
function stripFences(s: string): string {
  return s.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function buildPrompt(body: ReqBody): { system: string; user: string } {
  const { page_type, block_type, brief, target_words } = body;
  const key = `${page_type}:${block_type}`;
  let instruction = BLOCK_INSTRUCTIONS[key] ?? "Сгенерируй блок коммерческой страницы. Чистый HTML.";
  if (body.custom_instruction && body.custom_instruction.trim()) {
    const title = body.custom_title?.trim();
    instruction = `${title ? `Заголовок блока: "${title}". Используй его как H2.\n` : ""}${body.custom_instruction.trim()}\nФормат: чистый HTML с тегами h2/h3/p/ul/ol/li/strong/table.`;
  }

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
  if (brief.stop_words && String(brief.stop_words).trim()) {
    briefLines.push(`СТОП-СЛОВА И ЗАПРЕТЫ (не упоминать ни в каком виде): ${brief.stop_words}`);
  }

  // ── URL Parser grounding block (only if source_url present) ──
  const hasParsed = !!brief.source_url || !!brief.parsed_phone || !!brief.parsed_address
    || !!brief.parsed_work_hours || (brief.existing_h2?.length ?? 0) > 0
    || (brief.existing_blocks?.length ?? 0) > 0;
  let parsedAddon = "";
  if (hasParsed) {
    parsedAddon = `

ДАННЫЕ С САЙТА КЛИЕНТА (используй как основу, не выдумывай):
${brief.company ? `Компания: ${brief.company}` : ""}
${brief.parsed_phone ? `Телефон: ${brief.parsed_phone}` : "Телефон: не указывать"}
${brief.parsed_address ? `Адрес: ${brief.parsed_address}` : "Адрес: не указывать"}
${brief.parsed_work_hours ? `Режим работы: ${brief.parsed_work_hours}` : "Режим работы: не указывать"}
${brief.parsed_services?.length ? `Существующие услуги: ${brief.parsed_services.join(", ")}` : ""}
${brief.parsed_prices ? `Цены: ${brief.parsed_prices}` : "Цены: не указывать конкретных сумм"}
${brief.parsed_guarantees ? `Гарантии: ${brief.parsed_guarantees}` : "Гарантии: не упоминать"}

БЛОКИ УЖЕ СУЩЕСТВУЮЩИЕ НА СТРАНИЦЕ (НЕ ПОВТОРЯТЬ ИХ СОДЕРЖАНИЕ):
${brief.existing_blocks?.length ? brief.existing_blocks.map((b) => `- ${b}`).join("\n") : "нет данных"}

СУЩЕСТВУЮЩИЕ H2 НА СТРАНИЦЕ (НЕ ДУБЛИРОВАТЬ ЗАГОЛОВКИ):
${brief.existing_h2?.length ? brief.existing_h2.map((h) => `- ${h}`).join("\n") : "нет данных"}

КРИТИЧЕСКИ ВАЖНО:
- Используй только реальные данные компании из списка выше.
- Не придумывай телефоны, адреса, цены, имена сотрудников.
- Не повторяй блоки и заголовки, которые уже есть на странице.
- Если данных нет - не упоминай эту информацию вообще.`.trim();
  }

  const system = `Ты профессиональный SEO-копирайтер и маркетолог. Пишешь коммерческий текст для сайта на русском языке.
Тип страницы: ${page_type}. Тип блока: ${block_type}.

Правила:
- Живой язык, без воды и канцелярита.
- Запрещены клише: "динамично развивающаяся компания", "команда профессионалов", "индивидуальный подход", "широкий ассортимент", "высокое качество по доступным ценам".
- Конкретные факты, цифры и выгоды вместо общих слов.
- Ключ органично, не переспамливай.
- НЕ используй букву "е с двумя точками" - только обычную "е".
- НЕ используй markdown жирный (**). Используй <strong> только если предусмотрено инструкцией блока.

ANTI-FAKE GUARD (zero tolerance):
- ЗАПРЕЩЕНО выдумывать: имена экспертов/сотрудников ("Иван Петров, директор"), названия компаний-партнеров, конкретные адреса, телефоны, e-mail, проценты ("по данным 87%"), годы исследований, цитаты, кейсы клиентов, отзывы.
- Если факта нет в брифе - используй обезличенные формулировки: "практика показывает", "по нашему опыту", "в большинстве случаев".
- Не ссылайся на несуществующие исследования, рейтинги, награды.

- Целевой объём: примерно ${target_words} слов (допуск ±20%).
- Формат вывода: ЧИСТЫЙ HTML без обёрток в тройных бэктиках. Только теги h1/h2/h3/p/ul/ol/li/strong/em/table/thead/tbody/tr/th/td.
- Никаких пояснений ДО или ПОСЛЕ HTML. Только разметка.

Инструкция для этого блока:
${instruction}

${parsedAddon ? parsedAddon + "\n\n" : ""}${buildStealthSystemAddon("ru")}`;

  const user = `Бриф:\n${briefLines.join("\n") || "(данных нет)"}\n\nСгенерируй блок.`;
  return { system, user };
}

/**
 * Anti-fake post-processor. Detects and neutralizes the most common hallucinated
 * patterns in commercial copy. Runs only when the brief didn't authorize them.
 */
function applyAntiFakeGuard(html: string, brief: Brief): { content: string; flagged: string[] } {
  const flagged: string[] = [];
  let out = html;

  // Fake phone numbers (any 7+ digit cluster not present in brief)
  const briefBlob = JSON.stringify(brief).toLowerCase();
  out = out.replace(/(\+?7|8)[\s\-(]*\d{3}[\s\-)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/g, (m) => {
    if (briefBlob.includes(m.replace(/\D/g, "").slice(-10))) return m;
    flagged.push(`phone:${m}`);
    return "по телефону на сайте";
  });

  // Fake emails
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => {
    if (briefBlob.includes(m.toLowerCase())) return m;
    flagged.push(`email:${m}`);
    return "по e-mail на сайте";
  });

  // Fabricated stats: "по данным NN%", "согласно исследованию ... NN%"
  out = out.replace(/(по данным|согласно (?:исследованию|опросу|статистике)[^.]{0,40})\s*[^.<]{0,80}?\d{1,3}\s?%/gi, (m) => {
    flagged.push(`fake_stat:${m.slice(0, 60)}`);
    return "практика показывает";
  });

  // Fabricated expert citation: "Имя Фамилия, эксперт/директор/руководитель/CEO"
  out = out.replace(/[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+,\s*(эксперт|директор|руководитель|основатель|CEO|CTO|маркетолог|консультант)[^.<]{0,80}/g, (m) => {
    flagged.push(`fake_expert:${m.slice(0, 60)}`);
    return "эксперты отрасли отмечают";
  });

  // Fake years of research: "в 2019 году исследование", "опрос 2021 года"
  out = out.replace(/(исследование|опрос|отчет|рейтинг)\s+(?:от\s+)?\d{4}\s*(?:года|г\.)/gi, (m) => {
    flagged.push(`fake_year:${m}`);
    return "по наблюдениям из практики";
  });

  return { content: out, flagged };
}

async function getUserPlan(userId: string): Promise<string> {
  const sb = adminClient();
  const { data } = await sb.from("profiles").select("plan").eq("id", userId).maybeSingle();
  return (data?.plan as string) || "basic";
}

/** Single OpenRouter completion (non-stream). */
async function chatComplete(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<string> {
  const r = await withTimeout(
    fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Module Commercial",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature ?? 0.7,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    }),
    opts.timeoutMs ?? 60_000,
    "openrouter timeout",
  );
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`OpenRouter ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return String(j?.choices?.[0]?.message?.content || "").trim();
}

/**
 * LLM Fact-Check Guard: a cheap second-pass that asks a small model to
 * neutralize any hallucinated facts (numbers, names, claims) not supported by
 * the brief. Returns rewritten HTML; falls back to input on failure.
 */
async function llmFactCheck(opts: {
  apiKey: string;
  html: string;
  brief: Brief;
}): Promise<{ html: string; flags: string[] }> {
  const briefJson = JSON.stringify(opts.brief).slice(0, 3000);
  const system = `Ты редактор-фактчекер коммерческого SEO-текста.
Тебе дают HTML-блок и БРИФ. Найди в HTML любые конкретные факты, которых НЕТ в брифе:
- имена сотрудников/экспертов с должностями
- цифры процентов и статистики ("по данным 87%")
- ссылки на исследования и годы
- конкретные адреса, телефоны, e-mail
- названия компаний-партнеров, наград, сертификатов
- конкретные цены в рублях/долларах если их нет в брифе

Перепиши такие места в нейтральные обтекаемые формулировки ("практика показывает", "по нашему опыту", "уточняйте на сайте").
Сохрани структуру HTML и общий смысл, не сокращай текст.
Если фактов нет - верни HTML БЕЗ изменений.

Формат ответа: СТРОГИЙ JSON без markdown:
{"html":"<исправленный HTML>","flags":["краткое описание каждой правки"]}`;
  const user = `БРИФ:\n${briefJson}\n\nHTML:\n${opts.html}`;
  try {
    const raw = await chatComplete({
      apiKey: opts.apiKey,
      model: "google/gemini-2.5-flash-lite",
      system,
      user,
      maxTokens: Math.min(3000, opts.html.length + 600),
      temperature: 0.2,
      timeoutMs: 40_000,
    });
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.html === "string" && parsed.html.length > 30) {
      return { html: parsed.html, flags: Array.isArray(parsed.flags) ? parsed.flags.map(String) : [] };
    }
  } catch (e) {
    console.warn("[fact-check] skipped:", (e as Error).message);
  }
  return { html: opts.html, flags: [] };
}

/**
 * Quality retry: if word count is off target by >30% or keyword density >3.5%,
 * ask the model to rewrite the SAME block once, with explicit constraints.
 */
async function qualityRetry(opts: {
  apiKey: string;
  model: string;
  html: string;
  target: number;
  keyword: string;
  buildPromptArgs: { system: string; user: string };
}): Promise<{ html: string; retried: boolean; reason: string | null }> {
  const wc = countWords(opts.html);
  const dens = keywordDensity(opts.html, opts.keyword);
  const wcDeviation = Math.abs(wc - opts.target) / Math.max(1, opts.target);
  const tooLong = wc > opts.target * 1.3;
  const tooShort = wc < opts.target * 0.7;
  const spam = dens.density > 0.035;
  if (!tooLong && !tooShort && !spam) return { html: opts.html, retried: false, reason: null };

  const issues: string[] = [];
  if (tooLong) issues.push(`сократи до ~${opts.target} слов (сейчас ${wc})`);
  if (tooShort) issues.push(`расширь до ~${opts.target} слов (сейчас ${wc})`);
  if (spam) issues.push(`снизь плотность ключа "${opts.keyword}" - сейчас ${(dens.density * 100).toFixed(1)}%, нужно <2.5%`);

  const sys = `${opts.buildPromptArgs.system}\n\nЭто РЕРАЙТ. Текущий вариант нарушает требования:\n- ${issues.join("\n- ")}\nИсправь только эти проблемы, сохрани структуру и смысл. Верни чистый HTML.`;
  const usr = `${opts.buildPromptArgs.user}\n\nТЕКУЩИЙ ВАРИАНТ (исправь):\n${opts.html}`;
  try {
    const out = await chatComplete({
      apiKey: opts.apiKey,
      model: opts.model,
      system: sys,
      user: usr,
      maxTokens: Math.min(3500, opts.target * 4),
      temperature: 0.6,
      timeoutMs: 60_000,
    });
    const cleaned = stripFences(out);
    if (cleaned.length > 40) {
      return { html: cleaned, retried: true, reason: issues.join("; ") };
    }
  } catch (e) {
    console.warn("[quality-retry] failed:", (e as Error).message);
  }
  return { html: opts.html, retried: false, reason: issues.join("; ") };
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const forbidden = await requireAdminOrStaff(auth);
    if (forbidden) return forbidden;
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

    // Model routing: PRO+ users get Claude Sonnet by default, basic stays on Gemini Flash.
    // Explicit body.model still wins (admin/staff override).
    let model = body.model || "google/gemini-2.5-flash";
    if (!body.model && (plan === "pro" || plan === "factory")) {
      model = resolveOpenRouterModel("claude-sonnet");
    }
    const { system, user } = buildPrompt(body);

    let content = "";
    try {
      content = await chatComplete({
        apiKey,
        model,
        system,
        user,
        maxTokens: Math.min(3000, target * 3),
        temperature: 0.75,
      });
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

    content = stripFences(content);

    // Quality retry: rewrite once if word-count off or keyword over-spammed.
    const retry = await qualityRetry({
      apiKey,
      model,
      html: content,
      target,
      keyword: String(body.brief?.keyword || ""),
      buildPromptArgs: { system, user },
    });
    content = stripFences(retry.html);

    // Stealth post-process: char sanitize + burstiness pass.
    content = applyStealthPostProcess(content, "ru");

    // Anti-fake guard: neutralize hallucinated phones/emails/stats/experts.
    const guard = applyAntiFakeGuard(content, body.brief);
    content = guard.content;

    // LLM Fact-Check second pass: catches subtler hallucinations regex misses.
    // Skip for very short blocks (h1_lead, cta) to save budget/latency.
    let factFlags: string[] = [];
    if (countWords(content) >= 80) {
      const fc = await llmFactCheck({ apiKey, html: content, brief: body.brief });
      content = stripFences(fc.html);
      factFlags = fc.flags;
    }

    return jsonResponse({
      content,
      word_count: countWords(content),
      block_type: body.block_type,
      anti_fake_flags: guard.flagged,
      fact_check_flags: factFlags,
      retried: retry.retried,
      retry_reason: retry.reason,
      model_used: model,
    });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});
