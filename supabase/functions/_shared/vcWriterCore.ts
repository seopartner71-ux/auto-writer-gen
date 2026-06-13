// Core vc.ru Writer logic: prompt, generation, checklist, cover.
// Shared by single-shot vc-writer and the batch worker.
import { chatJson } from "./aiClient.ts";

export type VcFormat = "guide" | "rating" | "review" | "case";

export const VC_FORMAT_BRIEF: Record<VcFormat, string> = {
  guide: "Статья-разбор / пошаговый гайд. Структура: проблема -> почему это важно -> 4-7 шагов с цифрами и подводными камнями -> итог -> что делать дальше.",
  rating: "Рейтинг / подборка ТОП-N. Структура: критерии отбора (3-5 пунктов) -> карточки по каждому пункту (название, для кого, плюсы, минусы, цена/условия, личная оценка 1-10) -> сводный список 'итог одной строкой по каждому' -> вывод 'кому что брать'. БЕЗ markdown-таблиц.",
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
8. ДЛИНА: целевая 4500-6500 знаков (можно +-20%). Слишком короткое не попадает в топ, слишком длинное не дочитывают.
9. ФОРМАТИРОВАНИЕ: markdown с H2, списками (-), цитатами (>). БЕЗ markdown-таблиц (|---|): vc.ru их не рендерит, превращается в кашу. Сравнения делай списками с подзаголовками или H3-карточками. БЕЗ жирного (**). БЕЗ ё - заменяй на е.
10. ЗАГОЛОВОК (до 90 символов): цифра + конкретика + интрига.
11. ТЕГИ: 4-6 коротких тегов через запятую.
12. ТИРЕ: СТРОГО ЗАПРЕЩЕНО длинное тире (—), среднее тире (–) и любые юникод-дефисы. Используй ТОЛЬКО обычный дефис-минус "-" (U+002D). Это касается заголовка, подзаголовка, тегов, P.S. и всего markdown.
13. БЕЗ ТАБЛИЦ: vc.ru-редактор не поддерживает markdown-таблицы. Никогда не используй символ | для построения таблиц и не пиши строки вида |---|---|. Любое сравнение оформляй как маркированный список или серию H3-блоков "Название -> 3 строки текста".
`.trim();

export function ruEReplace(s: string): string {
  return (s || "").replace(/ё/g, "е").replace(/Ё/g, "Е");
}

/** Заменяет любые длинные/средние тире и юникод-дефисы на обычный "-". */
export function normalizeDashes(s: string): string {
  // U+2010..U+2015, U+2212 (minus), U+2043, U+FE58/FE63/FF0D
  return (s || "").replace(/[\u2010-\u2015\u2212\u2043\uFE58\uFE63\uFF0D]/g, "-");
}

/**
 * Удаляет markdown-таблицы (vc.ru их не рендерит) и превращает в маркированный список.
 * Таблица: блок строк, начинающихся с | и содержащих разделитель |---|.
 */
export function stripMarkdownTables(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const isTableRow = /^\s*\|.*\|\s*$/.test(line);
    const nextIsSep = i + 1 < lines.length && /^\s*\|?\s*:?-{2,}.*\|/.test(lines[i + 1]);
    if (isTableRow && nextIsSep) {
      const header = line.split("|").map((c) => c.trim()).filter(Boolean);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i].split("|").map((c) => c.trim()).filter(Boolean));
        i++;
      }
      // Convert to list: "- col1: header1; col2: header2; ..."
      for (const row of rows) {
        const parts = row.map((cell, idx) => `${header[idx] || "—"}: ${cell}`).join("; ");
        out.push(`- ${parts}`);
      }
      out.push("");
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}

export function stripText(md: string): string {
  return md.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`\-\|]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Гарантирует, что каждая клиентская ссылка присутствует в markdown.
 * Сначала пытаемся найти анкор в тексте и обернуть его в [anchor](url).
 * Если анкор не найден, добавляем компактный блок "Полезное по теме" перед P.S.
 */
export function ensureClientLinks(md: string, links: Array<{ url: string; anchor: string }>): { md: string; injected: string[]; appended: string[] } {
  const injected: string[] = [];
  const appended: string[] = [];
  if (!links || !links.length) return { md, injected, appended };

  let out = md;
  for (const l of links) {
    const anchor = (l.anchor || "").trim();
    const url = (l.url || "").trim();
    if (!anchor || !url) continue;
    // Уже есть как markdown-ссылка?
    const already = new RegExp(`\\]\\(\\s*${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\)`).test(out);
    if (already) { injected.push(anchor); continue; }
    // Попробуем найти анкор в тексте (вне заголовков и P.S.).
    const re = new RegExp(`(^|[^[\\w])(${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\w\\]])`, "i");
    const psIdx = out.search(/\n+P\.?\s*S\.?/i);
    const head = psIdx > 0 ? out.slice(0, psIdx) : out;
    const tail = psIdx > 0 ? out.slice(psIdx) : "";
    const m = head.match(re);
    if (m && m.index !== undefined) {
      const before = head.slice(0, m.index + (m[1] ? m[1].length : 0));
      const after = head.slice(m.index + (m[1] ? m[1].length : 0) + m[2].length);
      out = `${before}[${m[2]}](${url})${after}${tail}`;
      injected.push(anchor);
    } else {
      appended.push(anchor);
    }
  }

  if (appended.length) {
    const block = `\n\n## Полезное по теме\n\n${links
      .filter((l) => appended.includes(l.anchor.trim()))
      .map((l) => `- [${l.anchor.trim()}](${l.url.trim()})`)
      .join("\n")}`;
    const psIdx = out.search(/\n+P\.?\s*S\.?/i);
    out = psIdx > 0 ? `${out.slice(0, psIdx)}${block}${out.slice(psIdx)}` : `${out}${block}`;
  }
  return { md: out, injected, appended };
}

export function buildChecklist(md: string, ps: string): Array<{ label: string; ok: boolean; hint: string }> {
  const text = stripText(md);
  const chars = text.length;
  const digitsCount = (text.match(/\b\d+[\d\s.,%]*/g) || []).length;
  const h2 = (md.match(/^##\s+/gm) || []).length;
  const hasPS = /P\.?\s*S\.?/i.test(md) || (ps && md.includes(ps));
  const hasPersonal = /(мы\s|у\s+клиента|на\s+практик|сам\s+столк|попробовал)/i.test(text);
  const hasMistake = /(ошибк|провал|пошло\s+не\s+так|потеряли|не\s+сработал)/i.test(text);
  const hasBold = /\*\*[^*]+\*\*/.test(md);
  const hasYo = /ё|Ё/.test(md);
  const hasLongDash = /[\u2010-\u2015\u2212\u2043\uFE58\uFE63\uFF0D]/.test(md);
  const hasTable = /^\s*\|.*\|\s*$/m.test(md) && /^\s*\|?\s*:?-{2,}.*\|/m.test(md);
  return [
    { label: "Длина 3500-8000 знаков", ok: chars >= 3500 && chars <= 8000, hint: `сейчас ${chars}` },
    { label: "Минимум 4 цифры/факта", ok: digitsCount >= 4, hint: `нашли ${digitsCount}` },
    { label: "Минимум 3 подзаголовка H2", ok: h2 >= 3, hint: `${h2} H2` },
    { label: "Личный опыт", ok: hasPersonal, hint: hasPersonal ? "ок" : "добавь сцену" },
    { label: "Упомянут провал/ошибка", ok: hasMistake, hint: hasMistake ? "ок" : "vc.ru любит честность" },
    { label: "Есть P.S. с вопросом", ok: !!hasPS, hint: hasPS ? "ок" : "добавь P.S." },
    { label: "Нет жирного (**)", ok: !hasBold, hint: hasBold ? "убери **" : "ок" },
    { label: "Нет буквы ё", ok: !hasYo, hint: hasYo ? "замени на е" : "ок" },
    { label: "Только дефис '-' (без — и –)", ok: !hasLongDash, hint: hasLongDash ? "замени тире на -" : "ок" },
    { label: "Без markdown-таблиц (vc.ru их не рендерит)", ok: !hasTable, hint: hasTable ? "переделай в список" : "ок" },
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

export interface VcGenInput {
  apiKey: string;
  model: string;
  format: VcFormat;
  topic: string;
  thesis?: string;
  audience?: string;
  tone?: string;
  length?: number;
  wantCover?: boolean;
  /** Заголовки уже использованных в пачке статей — чтобы не повторяться. */
  avoidTitles?: string[];
  /** SEO-цель: точный поисковый запрос, под который оптимизируется статья. */
  targetQuery?: string;
  /** Клиентские ссылки для естественной вставки в текст. */
  clientLinks?: Array<{ url: string; anchor: string; hint?: string }>;
  /** От лица кого пишется статья. Влияет на запреты выдуманных сервисов/команд. */
  authorPersona?: AuthorPersona;
  /** Проверенные пользователем факты (цены, измерения, кейсы). Только их можно использовать как точные числа. */
  verifiedFacts?: string;
  /** Запустить факт-чек после генерации (по умолчанию true, если есть числовые утверждения). */
  factCheck?: boolean;
}

export type AuthorPersona = "agency" | "inhouse" | "brand_owner" | "expert" | "freeform";

export const AUTHOR_PERSONA_BRIEF: Record<AuthorPersona, string> = {
  agency: "Агентство или подрядчик. Можно говорить 'мы в агентстве', 'клиент пришел с задачей'. НЕЛЬЗЯ выдумывать конкретное название клиента - используй 'один из клиентов', 'компания из ниши X'.",
  inhouse: "Сотрудник компании-заказчика (in-house маркетолог/продакт). Можно говорить 'мы внутри компании', 'у нас в команде'. НЕЛЬЗЯ выдумывать численность команды, обороты, конкретные внутренние процессы, если они не даны в проверенных фактах.",
  brand_owner: "Владелец/представитель бренда продукта или услуги. ЗАПРЕЩЕНО выдумывать собственный сервис, количество клиентов, обороты, парк техники, количество сотрудников, кейсы. Можно говорить только о самом продукте на основе общедоступных фактов и проверенных данных. Все 'мы обслуживаем X машин в месяц' и 'у нас сервис на N постов' категорически запрещены.",
  expert: "Независимый эксперт или практик без своего сервиса/компании. Говори от первого лица как наблюдатель: 'по моему опыту', 'когда я разбирался', 'видел кейсы, где'. ЗАПРЕЩЕНО выдумывать собственный бизнес, штат, обороты, количество клиентов.",
  freeform: "Свободный формат - можно использовать обобщенные сцены вида 'практика показывает', 'у коллег по рынку видел'. Без конкретных названий компаний-клиентов и без выдуманных бизнес-метрик от автора.",
};

export interface VcGenResult {
  markdown: string;
  meta: { title: string; subtitle: string; tags: string[]; ps_question: string };
  checklist: Array<{ label: string; ok: boolean; hint: string }>;
  cover_data_url: string | null;
  stats: { chars: number; model: string };
  links_report?: { injected: string[]; appended: string[] };
}

function buildPrompt(p: VcGenInput): { system: string; user: string } {
  const system = `Ты - редактор vc.ru с 5-летним опытом. Твоя задача - написать материал, который попадет в топ vc.ru и зайдет в Google/Yandex. Пиши на русском, без буквы ё (заменяй на е).\n\n${VC_PROTOCOL}\n\nФОРМАТ ЭТОГО МАТЕРИАЛА: ${VC_FORMAT_BRIEF[p.format]}`;
  const avoid = (p.avoidTitles && p.avoidTitles.length)
    ? `\n\nВ этой пачке уже были заголовки (НЕ повторяй формулировки, найди другой угол):\n- ${p.avoidTitles.slice(0, 20).join("\n- ")}`
    : "";
  const seo = p.targetQuery
    ? `\n\nSEO-ЦЕЛЬ (КРИТИЧНО): статья должна ранжироваться в Google/Yandex по запросу "${p.targetQuery}". Требования:\n- target_query почти дословно входит в title (можно слегка перефразировать падежом).\n- target_query или его близкая форма встречается в первом H2 и в лиде.\n- В тексте 4-8 упоминаний target_query и его словоформ (естественно, без переспама).\n- Добавь 2-3 LSI/синонима этого запроса в H2.\n- Подзаголовок (subtitle) тоже содержит ключевую фразу.`
    : "";
  const links = (p.clientLinks && p.clientLinks.length)
    ? `\n\nКЛИЕНТСКИЕ ССЫЛКИ (КРИТИЧНО, ОБЯЗАТЕЛЬНО ВПИСАТЬ):\nВ тексте нужно естественно вписать markdown-ссылки на эти ресурсы. Каждая ссылка вставляется 1 раз, в подходящем по смыслу месте (не подряд, не в первом абзаце, не в P.S., не в заголовке). Анкор использовать ровно такой, как указан. Формат: [анкор](url). Без рекламной приписки, без "перейти", "узнать больше" - просто органично в предложении.\n${p.clientLinks.slice(0, 5).map((l, i) => `${i + 1}. Анкор: "${l.anchor}" -> ${l.url}${l.hint ? ` (контекст: ${l.hint})` : ""}`).join("\n")}`
    : "";
  const persona = p.authorPersona && AUTHOR_PERSONA_BRIEF[p.authorPersona]
    ? `\n\nОТ ЛИЦА КОГО ПИШЕМ (КРИТИЧНО): ${AUTHOR_PERSONA_BRIEF[p.authorPersona]}`
    : "";
  const facts = p.verifiedFacts && p.verifiedFacts.trim()
    ? `\n\nПРОВЕРЕННЫЕ ФАКТЫ (ИСПОЛЬЗОВАТЬ ТОЛЬКО ИХ):\nНиже список реальных цифр, цен, кейсов и характеристик. Все конкретные цифры, цены, проценты, сроки, лабораторные показатели, технические параметры, количество клиентов и обороты в тексте ДОЛЖНЫ браться отсюда. Если факта нет в списке - НЕ выдумывай число, используй формулировки 'по нашей практике', 'обычно', 'в среднем по рынку' БЕЗ конкретной цифры. Запрещено добавлять цифры, которых нет в списке.\n--- начало списка ---\n${p.verifiedFacts.trim().slice(0, 4000)}\n--- конец списка ---`
    : `\n\nАНТИ-ГАЛЛЮЦИНАЦИИ (КРИТИЧНО): пользователь НЕ дал проверенных цифр. Это значит:\n- НЕ выдумывай конкретные цены брендов-конкурентов (Shell, Mobil, Castrol и т.п.).\n- НЕ выдумывай лабораторные показатели (вязкость, плотность, моторесурс и т.п.).\n- НЕ выдумывай конкретные пробеги клиентов и их марки авто.\n- НЕ выдумывай численность команды/штата/количество клиентов автора.\n- Используй обобщения: 'по нашей практике', 'обычно', 'у коллег по рынку', 'часто встречаем'. Цифры из протокола (4-6 шт) бери из общеизвестных фактов рынка или формулируй как диапазоны/пропорции ('у X из Y клиентов', 'на 15-25% дороже').`;
  const user = `Тема: ${p.topic}\nГлавный тезис: ${p.thesis || "сформулируй сам исходя из темы"}\nАудитория vc.ru: ${p.audience || "предприниматели, маркетологи, продактменеджеры"}\nТон: ${p.tone || "экспертно-разговорный с легкой провокацией"}\nЦелевая длина: ${p.length || 5500} знаков (+-20%).${persona}${facts}${seo}${links}${avoid}\n\nВерни строго JSON:\n{\n  "title": "заголовок до 90 символов",\n  "subtitle": "подзаголовок 1-2 предложения, продает клик",\n  "tags": ["тег1","тег2",...],\n  "ps_question": "вопрос аудитории для P.S.",\n  "markdown": "полный текст материала в markdown с H2, списками. Включи в конец строку 'P.S. <ps_question>'"\n}`;
  return { system, user };
}

export interface FactClaim {
  text: string;
  kind: "price" | "measurement" | "stat" | "date" | "count" | "brand_price" | "other";
  verified: boolean;
  note: string;
}

export interface RiskReport {
  total: number;
  unverified: number;
  level: "low" | "medium" | "high";
  claims: FactClaim[];
  summary: string;
}

/**
 * Fact-Check Guard: достаёт численные/конкретные утверждения из markdown и
 * сверяет с проверенными фактами пользователя. Возвращает risk_report.
 * Использует дешёвую модель (gemini-2.5-flash).
 */
export async function factCheckMarkdown(
  apiKey: string,
  markdown: string,
  verifiedFacts: string | undefined,
): Promise<RiskReport> {
  const empty: RiskReport = { total: 0, unverified: 0, level: "low", claims: [], summary: "Нет рисков" };
  if (!markdown || markdown.length < 200) return empty;

  const facts = (verifiedFacts || "").trim();
  const system = `Ты - редактор-факт-чекер vc.ru. Найди в тексте все КОНКРЕТНЫЕ числовые утверждения, которые читатель воспримет как факты:\n- цены конкурентов и собственные цены ("Shell 4200 руб", "наш сервис 1800 руб")\n- лабораторные/технические показатели (вязкость 14.2 сСт, мощность 250 л.с., расход 10.8 л/100км)\n- конкретные пробеги, сроки эксплуатации, "за 6000 км"\n- численность бизнеса автора (клиентов в месяц, постов в сервисе, штат)\n- статистика рынка ("доля 18%", "выросло в 2 раза")\n- сертификации с конкретными кодами (API SN/CF, ACEA A3/B4)\n- марки/модели техники с конкретными результатами\n\nДля КАЖДОГО утверждения определи:\n- verified=true если оно прямо подтверждается списком проверенных фактов пользователя ИЛИ если это общеизвестный факт (например, "Mercedes - немецкий бренд")\n- verified=false если это конкретное число/факт, не подтверждённый списком (риск галлюцинации)\n\nВерни строго JSON.`;
  const user = `ПРОВЕРЕННЫЕ ФАКТЫ ПОЛЬЗОВАТЕЛЯ:\n${facts ? facts.slice(0, 3000) : "(пользователь не дал проверенных фактов - значит ЛЮБОЕ конкретное число в тексте, кроме общеизвестных, считай unverified=true)"}\n\nТЕКСТ ДЛЯ ПРОВЕРКИ:\n${markdown.slice(0, 8000)}\n\nВерни JSON:\n{\n  "claims": [\n    {"text": "цитата из текста (до 120 символов)", "kind": "price|measurement|stat|date|count|brand_price|other", "verified": true|false, "note": "почему verified или какой риск (до 100 символов)"}\n  ]\n}\nМаксимум 20 утверждений, в первую очередь те, у которых verified=false.`;

  try {
    const r = await chatJson<{ claims: FactClaim[] }>({
      apiKey,
      model: "google/gemini-2.5-flash",
      system,
      user,
      temperature: 0.1,
      maxTokens: 2500,
      timeoutMs: 60_000,
      appTitle: "vc.ru Fact-Check",
      retries: 0,
    });
    const claims = Array.isArray(r.data?.claims) ? r.data!.claims.slice(0, 30) : [];
    const unverified = claims.filter((c) => c && c.verified === false).length;
    const total = claims.length;
    let level: "low" | "medium" | "high" = "low";
    if (unverified >= 6) level = "high";
    else if (unverified >= 3) level = "medium";
    const summary = total === 0
      ? "Конкретных проверяемых утверждений не нашли"
      : unverified === 0
        ? `Все ${total} утверждений подтверждены`
        : `${unverified} из ${total} утверждений не подтверждены - проверь перед публикацией`;
    return { total, unverified, level, claims, summary };
  } catch (e) {
    console.error("[factCheckMarkdown] failed", e);
    return empty;
  }
}

export async function generateVcArticle(input: VcGenInput): Promise<VcGenResult> {
  const { system, user } = buildPrompt(input);

  const result = await chatJson<{
    title: string; subtitle: string; tags: string[]; ps_question: string; markdown: string;
  }>({
    apiKey: input.apiKey,
    model: input.model,
    system,
    user,
    temperature: 0.85,
    maxTokens: 6000,
    timeoutMs: 180_000,
    appTitle: "vc.ru Writer",
    retries: 1,
  });

  const data = result.data || ({} as any);
  let markdown = stripMarkdownTables(
    normalizeDashes(ruEReplace(String(data.markdown || "")))
  ).replace(/\*\*([^*]+)\*\*/g, "$1");
  const title = normalizeDashes(ruEReplace(String(data.title || ""))).slice(0, 90);
  const subtitle = normalizeDashes(ruEReplace(String(data.subtitle || ""))).slice(0, 240);
  const ps_question = normalizeDashes(ruEReplace(String(data.ps_question || "")));
  const tags = Array.isArray(data.tags)
    ? data.tags.slice(0, 6).map((t: any) => normalizeDashes(ruEReplace(String(t))).slice(0, 30))
    : [];

  if (ps_question && !/P\.?\s*S\.?/i.test(markdown)) {
    markdown += `\n\nP.S. ${ps_question}`;
  }

  // Гарантия вставки клиентских ссылок.
  let linksReport: { injected: string[]; appended: string[] } = { injected: [], appended: [] };
  if (input.clientLinks && input.clientLinks.length) {
    const r = ensureClientLinks(markdown, input.clientLinks.map((l) => ({ url: l.url, anchor: l.anchor })));
    markdown = r.md;
    linksReport = { injected: r.injected, appended: r.appended };
  }

  let cover_data_url: string | null = null;
  if (input.wantCover) {
    cover_data_url = await generateCover(`${title}. ${subtitle}`);
  }

  const checklist = buildChecklist(markdown, ps_question);

  return {
    markdown,
    meta: { title, subtitle, tags, ps_question },
    checklist,
    cover_data_url,
    stats: { chars: stripText(markdown).length, model: result.model },
    links_report: linksReport,
  };
}

export const ALLOWED_VC_MODELS = new Set([
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-opus-4.1",
  "google/gemini-2.5-pro",
  "openai/gpt-5",
  "google/gemini-2.5-flash",
]);

export const DEFAULT_VC_MODEL = "anthropic/claude-sonnet-4.5";

export function pickVcModel(raw: unknown): string {
  return ALLOWED_VC_MODELS.has(String(raw)) ? String(raw) : DEFAULT_VC_MODEL;
}

export function isVcFormat(v: unknown): v is VcFormat {
  return v === "guide" || v === "rating" || v === "review" || v === "case";
}