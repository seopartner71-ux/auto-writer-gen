// Generate a single block of a commercial page (service / category / product / local).
// Auth -> plan gate -> deduct 1 credit -> OpenRouter -> return { content, word_count }.
// Refunds the credit on upstream failure.

import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdminOrStaff } from "../_shared/auth.ts";
import { chatComplete as aiChatComplete, chatJson, AiError } from "../_shared/aiClient.ts";
import { logPipelineEvent, startTimer } from "../_shared/pipelineLogger.ts";
import { applyStealthPostProcess, buildStealthSystemAddon } from "../_shared/stealth.ts";
import { resolveOpenRouterModel } from "../_shared/aiModel.ts";
import { logCost, tokensToUsd } from "../_shared/costLogger.ts";
import { webGroundedFactCheck, hasRiskyClaims } from "../_shared/webGroundedCheck.ts";
import {
  countWords as countWordsQ,
  keywordDensity as keywordDensityQ,
  stripFences as stripFencesQ,
  applyAntiFakeGuard as applyAntiFakeGuardQ,
} from "./quality.ts";

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
  /** Plain-text summaries of already generated blocks above the current one. */
  generated_content_above?: string;
  /** Narration person requested by UI: company/team voice or first-person expert voice. */
  narrative_person?: "we" | "i" | string;
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
  return countWordsQ(text);
}

/** Detect YMYL (Your Money / Your Life) niches that need stronger E-E-A-T signals. */
const YMYL_RULES: { kind: string; rx: RegExp }[] = [
  { kind: "medical", rx: /(медиц|здоров|клиник|стоматолог|врач|лекарств|психолог|диагност|терапи|хирург|лечени|болезн|симптом|фарма|аптек)/i },
  { kind: "financial", rx: /(финанс|кредит|займ|ипотек|инвест|банк|страхов|налог|бухгалт|трейд|крипт|форекс|пенси|депозит|вклад)/i },
  { kind: "legal", rx: /(юрист|адвокат|закон|право|суд|нотариус|регистрац|лиценз|договор|претензи|уголовн|гражданск)/i },
];
function detectYmyl(brief: Brief): string | null {
  const hay = `${brief.niche || ""} ${brief.keyword || ""} ${brief.services || ""}`.toLowerCase();
  for (const r of YMYL_RULES) if (r.rx.test(hay)) return r.kind;
  return null;
}

function buildEeatAddon(kind: string): string {
  const kindRu = kind === "medical" ? "медицинской" : kind === "financial" ? "финансовой" : "юридической";
  return `

E-E-A-T (тематика ${kindRu}, повышенные требования YMYL):
- В тексте дай понять, что материал подготовлен с участием профильного специалиста, БЕЗ выдуманных ФИО/должностей. Формулировки: "по практике профильных специалистов", "согласно методологии отрасли".
- Если блок содержит рекомендации - в конце или в отдельном <p> добавь дисклеймер: "Материал носит информационный характер и не заменяет консультацию ${kind === "medical" ? "врача" : kind === "financial" ? "финансового консультанта" : "юриста"}".
- Не давай конкретных дозировок/сумм/правовых выводов как окончательных; используй "уточняйте у специалиста".
- Если бриф позволяет (есть блок faq/seo_text) - упомяни, на основе чего сформированы рекомендации ("стандарты отрасли", "официальные источники"), без вымышленных названий.`;
}

/** Compute share of LSI terms that actually appear in HTML (case-insensitive). */
function lsiCoverage(html: string, lsi: string): { terms: string[]; missing: string[]; ratio: number } {
  const terms = String(lsi || "")
    .split(/[,;|\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3)
    .slice(0, 30);
  if (terms.length === 0) return { terms: [], missing: [], ratio: 1 };
  const plain = html.replace(/<[^>]+>/g, " ").toLowerCase();
  const missing = terms.filter((t) => !plain.includes(t.toLowerCase()));
  return { terms, missing, ratio: 1 - missing.length / terms.length };
}

/** Roughly count keyword occurrences in plain text. Case-insensitive whole-word-ish. */
function keywordDensity(html: string, keyword: string): { count: number; density: number; total: number } {
  return keywordDensityQ(html, keyword);
}

/** Strip ```html fences if model wrapped the output. */
function stripFences(s: string): string {
  return stripFencesQ(s);
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
  if (brief.narrative_person) {
    briefLines.push(`Лицо повествования: ${brief.narrative_person === "i" ? "Я (эксперт/автор)" : "Мы (компания/команда)"}`);
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

  const generatedAbove = typeof brief.generated_content_above === "string" ? brief.generated_content_above.trim() : "";
  const antiDupAddon = generatedAbove ? `

УЖЕ СГЕНЕРИРОВАННЫЕ ТЕКСТЫ ВЫШЕ НА ЭТОЙ ЖЕ СТРАНИЦЕ (прочитай и НЕ повторяй):
${generatedAbove.slice(0, 7000)}

КРИТИЧЕСКИ ВАЖНО ПО АНТИДУБЛЯМ:
- Не повторяй информацию, которая уже есть в текстах выше, дополняй новым.
- Не перефразируй те же выгоды, этапы, гарантии, материалы, сроки и аргументы другими словами.
- Текущий блок должен закрывать только свою задачу: ${instruction}
- Если важный факт уже был сказан выше, можно сослаться на него одним коротким предложением, но не раскрывать заново.`.trim() : "";

  const narrativeAddon = brief.narrative_person === "i" ? `

КРИТИЧЕСКИ ВАЖНО: пиши от лица "я" (эксперт/автор), а не "мы". Используй: я делаю, мой опыт, я проверяю. Не превращай текст в обезличенную речь компании. Это абсолютный приоритет в вопросе лица повествования, при этом стиль и тон сохраняй.` : `

КРИТИЧЕСКИ ВАЖНО: пиши ИСКЛЮЧИТЕЛЬНО от лица "мы" (компания/команда), а не "я".
Используй: мы делаем, наша команда, у нас есть опыт. НИКОГДА не используй "я", "мой опыт", "я считаю". Это абсолютный приоритет выше характера автора.`;

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

${parsedAddon ? parsedAddon + "\n\n" : ""}${antiDupAddon ? antiDupAddon + "\n\n" : ""}${(() => { const k = detectYmyl(brief); return k ? buildEeatAddon(k) + "\n\n" : ""; })()}${buildStealthSystemAddon("ru")}`;

  const user = `Бриф:\n${briefLines.join("\n") || "(данных нет)"}\n\nСгенерируй блок.\n${narrativeAddon}`;
  return { system, user };
}

/**
 * Anti-fake post-processor. Detects and neutralizes the most common hallucinated
 * patterns in commercial copy. Runs only when the brief didn't authorize them.
 */
function applyAntiFakeGuard(html: string, brief: Brief): { content: string; flagged: string[] } {
  return applyAntiFakeGuardQ(html, brief);
}

async function getUserPlan(userId: string): Promise<string> {
  const sb = adminClient();
  const { data } = await sb.from("profiles").select("plan").eq("id", userId).maybeSingle();
  return (data?.plan as string) || "basic";
}

/** Тонкая обёртка над общим aiClient — сохраняем старую сигнатуру по месту вызова. */
async function chatComplete(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
  const res = await aiChatComplete({
    apiKey: opts.apiKey,
    model: opts.model,
    system: opts.system,
    user: opts.user,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    timeoutMs: opts.timeoutMs,
    appTitle: "SEO-Module Commercial",
  });
  return { content: res.content, tokensIn: res.tokensIn, tokensOut: res.tokensOut };
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
  generatorModel?: string;
}): Promise<{ html: string; flags: string[]; tokensIn: number; tokensOut: number; model: string }> {
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
  // Cross-family fact-check: pick a model from a different family than the
  // generator so the checker doesn't share the same blind spots.
  const gen = (opts.generatorModel || "").toLowerCase();
  const checkerModel = gen.includes("anthropic") || gen.includes("claude")
    ? "google/gemini-2.5-pro"
    : "anthropic/claude-sonnet-4";
  try {
    const j = await chatJson<{ html: string; flags?: string[] }>({
      apiKey: opts.apiKey,
      model: checkerModel,
      system,
      user,
      maxTokens: Math.min(4000, opts.html.length + 800),
      temperature: 0.2,
      timeoutMs: 60_000,
      schemaName: "FactCheck",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["html", "flags"],
        properties: {
          html: { type: "string" },
          flags: { type: "array", items: { type: "string" } },
        },
      },
      retries: 1,
      appTitle: "SEO-Module FactCheck",
    });
    if (j.data?.html && j.data.html.length > 30) {
      return {
        html: j.data.html,
        flags: Array.isArray(j.data.flags) ? j.data.flags.map(String) : [],
        tokensIn: j.tokensIn,
        tokensOut: j.tokensOut,
        model: j.model,
      };
    }
  } catch (e) {
    const kind = e instanceof AiError ? e.kind : "unknown";
    console.warn("[fact-check] skipped:", kind, (e as Error).message);
  }
  return { html: opts.html, flags: [], tokensIn: 0, tokensOut: 0, model: checkerModel };
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
  lsi?: string;
  buildPromptArgs: { system: string; user: string };
}): Promise<{ html: string; retried: boolean; reason: string | null; tokensIn: number; tokensOut: number; lsi_ratio: number; lsi_missing: string[] }> {
  const wc = countWords(opts.html);
  const dens = keywordDensity(opts.html, opts.keyword);
  const wcDeviation = Math.abs(wc - opts.target) / Math.max(1, opts.target);
  const tooLong = wc > opts.target * 1.3;
  const tooShort = wc < opts.target * 0.7;
  const spam = dens.density > 0.035;
  const lsi = lsiCoverage(opts.html, opts.lsi || "");
  // Only enforce LSI when at least 4 terms were provided (otherwise too noisy)
  const lsiLow = lsi.terms.length >= 4 && lsi.ratio < 0.5;
  if (!tooLong && !tooShort && !spam && !lsiLow) {
    return { html: opts.html, retried: false, reason: null, tokensIn: 0, tokensOut: 0, lsi_ratio: lsi.ratio, lsi_missing: lsi.missing };
  }

  const issues: string[] = [];
  if (tooLong) issues.push(`сократи до ~${opts.target} слов (сейчас ${wc})`);
  if (tooShort) issues.push(`расширь до ~${opts.target} слов (сейчас ${wc})`);
  if (spam) issues.push(`снизь плотность ключа "${opts.keyword}" - сейчас ${(dens.density * 100).toFixed(1)}%, нужно <2.5%`);
  if (lsiLow) issues.push(`органично вплети недостающие LSI-термины: ${lsi.missing.slice(0, 10).join(", ")}`);

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
    const cleaned = stripFences(out.content);
    if (cleaned.length > 40) {
      const lsi2 = lsiCoverage(cleaned, opts.lsi || "");
      return { html: cleaned, retried: true, reason: issues.join("; "), tokensIn: out.tokensIn, tokensOut: out.tokensOut, lsi_ratio: lsi2.ratio, lsi_missing: lsi2.missing };
    }
  } catch (e) {
    console.warn("[quality-retry] failed:", (e as Error).message);
  }
  return { html: opts.html, retried: false, reason: issues.join("; "), tokensIn: 0, tokensOut: 0, lsi_ratio: lsi.ratio, lsi_missing: lsi.missing };
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

    // Budget gate: enforce per-plan day/month cost caps before any LLM spend.
    // Admin/staff are bypassed inside the RPC.
    try {
      const tentativeModel = body.model
        || ((plan === "pro" || plan === "factory") ? resolveOpenRouterModel("claude-sonnet") : "google/gemini-2.5-flash");
      const { data: budget } = await sb.rpc("check_ai_budget", { _user_id: userId, _model: tentativeModel });
      const b = budget as { allowed?: boolean; reason?: string; day_cost?: number; day_cap?: number; monthly_cost?: number; cost_cap?: number } | null;
      if (b && b.allowed === false) {
        return errorResponse(
          b.reason === "day_cap" ? "Превышен дневной лимит AI-расходов" :
          b.reason === "cost_cap" ? "Превышен месячный лимит AI-расходов" :
          b.reason === "opus_cap" ? "Превышен лимит вызовов премиум-модели" :
          "AI-бюджет исчерпан",
          429,
          { budget: b },
        );
      }
    } catch (e) {
      console.warn("[commercial] budget check failed:", (e as Error).message);
    }

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
    let totalIn = 0;
    let totalOut = 0;
    let primaryUsd = 0;
    const tGen = startTimer();
    try {
      const main = await chatComplete({
        apiKey,
        model,
        system,
        user,
        maxTokens: Math.min(3000, target * 3),
        temperature: 0.75,
      });
      content = main.content;
      totalIn += main.tokensIn;
      totalOut += main.tokensOut;
      primaryUsd = tokensToUsd(model, main.tokensIn, main.tokensOut);
      logPipelineEvent({
        stage: "commercial_block",
        user_id: userId,
        verdict: "pass",
        model,
        tokens_in: main.tokensIn,
        tokens_out: main.tokensOut,
        cost_usd: primaryUsd,
        duration_ms: tGen(),
        meta: { block_type: body.block_type, page_type: body.page_type, target_words: target, plan },
      });
    } catch (e) {
      logPipelineEvent({
        stage: "commercial_block",
        user_id: userId,
        verdict: "fail",
        model,
        duration_ms: tGen(),
        error_kind: e instanceof AiError ? e.kind : "unknown",
        error_message: e instanceof Error ? e.message : String(e),
        meta: { block_type: body.block_type, page_type: body.page_type, plan },
      });
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
      lsi: String(body.brief?.lsi || ""),
      buildPromptArgs: { system, user },
    });
    content = stripFences(retry.html);
    totalIn += retry.tokensIn;
    totalOut += retry.tokensOut;

    // Stealth post-process: char sanitize + burstiness pass.
    content = applyStealthPostProcess(content, "ru");

    // Anti-fake guard: neutralize hallucinated phones/emails/stats/experts.
    const guard = applyAntiFakeGuard(content, body.brief);
    content = guard.content;

    // LLM Fact-Check second pass: catches subtler hallucinations regex misses.
    // Skip for very short blocks (h1_lead, cta) to save budget/latency.
    let factFlags: string[] = [];
    let fcUsd = 0;
    if (countWords(content) >= 80) {
      const tFc = startTimer();
      const fc = await llmFactCheck({ apiKey, html: content, brief: body.brief, generatorModel: model });
      content = stripFences(fc.html);
      factFlags = fc.flags;
      fcUsd = tokensToUsd(fc.model, fc.tokensIn, fc.tokensOut);
      totalIn += fc.tokensIn;
      totalOut += fc.tokensOut;
      logPipelineEvent({
        stage: "fact_check_llm",
        user_id: userId,
        verdict: factFlags.length === 0 ? "pass" : factFlags.length <= 2 ? "warning" : "fail",
        model: fc.model,
        tokens_in: fc.tokensIn,
        tokens_out: fc.tokensOut,
        cost_usd: fcUsd,
        duration_ms: tFc(),
        meta: { flags_count: factFlags.length, generator_model: model },
      });
    }

    // Step 3 — Web-grounded fact-check via Perplexity Sonar (PRO/FACTORY only).
    // Triggers when content has risky factual claims (percents, years, sums,
    // "according to X"). Either cross-model already flagged something, or the
    // content still contains numbers that the LLM-checker did not touch.
    let webVerified: string[] = [];
    let webUnverified: string[] = [];
    let webCitations: string[] = [];
    let webModel: string | null = null;
    let webSkipped = true;
    let webReason: string | undefined;
    let webUsd = 0;
    const planAllowsWeb = plan === "pro" || plan === "factory";
    const shouldWebVerify = planAllowsWeb
      && countWords(content) >= 80
      && (hasRiskyClaims(content) || factFlags.length > 0);
    if (shouldWebVerify) {
      const briefSummary = `Ниша: ${body.brief?.niche || ""}. Компания: ${body.brief?.company || body.brief?.shop_name || ""}. Город: ${body.brief?.city || ""}. Ключ: ${body.brief?.keyword || ""}.`;
      const tWeb = startTimer();
      const web = await webGroundedFactCheck({
        apiKey,
        html: content,
        briefSummary,
        language: "ru",
        timeoutMs: 75_000,
      });
      webModel = web.model;
      webSkipped = web.skipped;
      webReason = web.reason;
      if (!web.skipped) {
        content = stripFences(web.html);
        webVerified = web.verified;
        webUnverified = web.unverified;
        webCitations = web.citations;
        totalIn += web.tokensIn;
        totalOut += web.tokensOut;
        webUsd = tokensToUsd(web.model, web.tokensIn, web.tokensOut);
      }
      logPipelineEvent({
        stage: "fact_check_web",
        user_id: userId,
        verdict: web.skipped ? "fail" : webUnverified.length === 0 ? "pass" : "warning",
        model: web.model,
        tokens_in: web.tokensIn,
        tokens_out: web.tokensOut,
        cost_usd: webUsd,
        duration_ms: tWeb(),
        error_kind: web.skipped ? "skipped" : null,
        error_message: web.skipped ? web.reason : null,
        meta: { plan, verified: webVerified.length, unverified: webUnverified.length, citations: webCitations.length },
      });
    }

    // Cost log (best-effort) for admin quality dashboard.
    const finalWc = countWords(content);
    const finalDens = keywordDensity(content, String(body.brief?.keyword || ""));
    void logCost(sb, {
      user_id: userId,
      operation_type: "article_generation",
      model,
      tokens_input: totalIn,
      tokens_output: totalOut,
      cost_usd: primaryUsd + fcUsd + webUsd,
      metadata: {
        kind: "commercial_block",
        block_type: body.block_type,
        page_type: body.page_type,
        target_words: target,
        word_count: finalWc,
        word_deviation: Math.abs(finalWc - target) / Math.max(1, target),
        keyword_density: Number(finalDens.density.toFixed(4)),
        retried: retry.retried,
        retry_reason: retry.reason,
        anti_fake_count: guard.flagged.length,
        fact_check_count: factFlags.length,
        web_verified_count: webVerified.length,
        web_unverified_count: webUnverified.length,
        web_citations_count: webCitations.length,
        web_skipped: webSkipped,
        web_skip_reason: webReason,
        lsi_ratio: Number((retry.lsi_ratio ?? 1).toFixed(3)),
        lsi_missing: retry.lsi_missing?.slice(0, 8) || [],
        ymyl: detectYmyl(body.brief),
        plan,
      },
    });

    // Технические алерты качества убраны — уведомления теперь только по списку.

    return jsonResponse({
      content,
      word_count: countWords(content),
      block_type: body.block_type,
      anti_fake_flags: guard.flagged,
      fact_check_flags: factFlags,
      web_verified: webVerified,
      web_unverified: webUnverified,
      web_citations: webCitations,
      web_grounded_skipped: webSkipped,
      web_grounded_reason: webReason,
      web_grounded_model: webModel,
      retried: retry.retried,
      retry_reason: retry.reason,
      lsi_ratio: retry.lsi_ratio,
      lsi_missing: retry.lsi_missing,
      ymyl: detectYmyl(body.brief),
      model_used: model,
    });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});
