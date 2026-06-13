// Core vc.ru Writer logic: prompt, generation, checklist, cover.
// Shared by single-shot vc-writer and the batch worker.
import { chatJson } from "./aiClient.ts";
import { runDoubleHumanizePass, type DoubleHumanizeResult } from "./humanizePass.ts";

export type VcFormat = "guide" | "rating" | "review" | "case";

export const VC_FORMAT_BRIEF: Record<VcFormat, string> = {
  guide: "Статья-разбор / пошаговый гайд. Структура: проблема -> почему это важно -> 4-7 шагов с цифрами и подводными камнями -> итог -> что делать дальше.",
  rating: "Рейтинг / подборка ТОП-N. Структура: критерии отбора (3-5 пунктов) -> карточки по каждому пункту (название, для кого, плюсы, минусы, цена/условия, личная оценка 1-10) -> сводный список 'итог одной строкой по каждому' -> вывод 'кому что брать'. БЕЗ markdown-таблиц.",
  review: "Обзор продукта/сервиса. Структура: что это и для кого -> как тестировали (контекст, срок, задачи) -> что понравилось (3-5) -> что бесит (3-5) -> цена и альтернативы -> кому брать, кому пройти мимо.",
  case: "Кейс / антикейс / мнение. Структура: лид с конфликтом или цифрой потерь/прибыли -> предыстория (кто мы, что хотели) -> что сделали по шагам -> что пошло не так и почему -> цифры до/после -> выводы и спорный тезис в финале.",
};

const VC_RATING_PROTOCOL = `
ПРАВИЛА РЕЙТИНГА / СРАВНЕНИЯ (КРИТИЧНО, нарушение = бракованная статья):
1. РЕАЛЬНЫЕ КОНКУРЕНТЫ. Минимум 5 позиций - все РЕАЛЬНЫЕ бренды/товары/сервисы из той же категории, ценового сегмента и назначения. Запрещено сравнивать конкретный бренд с абстракциями ("Бренд X vs премиум-сегмент", "vs полусинтетика", "vs бюджетный сегмент"). Только "Бренд X vs Бренд Y vs Бренд Z vs Бренд N vs Бренд M".
2. КАРТОЧКА КАЖДОГО УЧАСТНИКА содержит: цена, основные характеристики, сильные стороны, слабые стороны, отзывы пользователей (обобщенно, без выдуманных цитат), особенности применения. У каждого участника ОБЯЗАТЕЛЬНО И плюсы, И минусы - нет участника "без минусов".
3. МЕТОДИКА ОЦЕНКИ обязательно описана в начале: какие критерии, какой вес у каждого, почему итоговое место именно такое.
4. МЕСТА НЕ ПОДГОНЯЮТСЯ под продвигаемый бренд. Заказчик/клиентский бренд НЕ ставится на 1 место автоматически - только если объективно выигрывает по методике. Часто корректно - 2-3 место с честными причинами.
5. ЗАПРЕЩЕННЫЕ ФОРМУЛИРОВКИ: "лучший на рынке", "лидер рынка", "без компромиссов", "идеальный выбор", "гарантированно лучший", "номер один", "вне конкуренции", "выбор профессионалов". Использовать: "по результатам анализа", "по совокупности критериев", "в рамках данной выборки", "по нашему опыту", "согласно найденным данным и отзывам".
6. САМОПРОВЕРКА (внутри головы, до отдачи результата):
   - Можно ли убрать бренд №1 и заменить другим без переписывания текста? Если нет - текст рекламный, переделать.
   - У каждого ли участника есть реальные недостатки? Если нет - переделать.
   - Все ли позиции - реальные бренды (не категории)? Если нет - переделать.
7. FALLBACK. Если для честного рейтинга недостаточно данных (нет 5+ реальных конкурентов с фактами), НЕ пиши рейтинг - перестрой материал в формат "личный опыт / кейс / разбор рынка / обзор одного продукта с упоминанием альтернатив". Лучше честный кейс, чем фейковый рейтинг.
8. ТОН: независимое исследование рынка, а не продвижение одного участника.
`.trim();

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

const VC_STORY_PROTOCOL = `
STORY-FIRST PROTOCOL (КРИТИЧНО, нарушение = текст не публикуется):
Запрещено строить материал только вокруг инструкции, чек-листа, гайда или SEO-полотна. Каждый материал ОБЯЗАН содержать минимум один драматургический элемент:
- потеря денег;
- ошибка;
- конфликт;
- эксперимент;
- неожиданное открытие;
- изменение мнения;
- провал проекта;
- спорное решение;
- реальный кейс.

В первых ~500 словах статьи ОБЯЗАТЕЛЬНО должны появиться:
- конкретная сумма денег (или диапазон/пропорция, если точной цифры нет);
- реальное последствие ошибки (что сломалось, что потеряли, что пошло не так);
- конкретный человек или бизнес-ситуация ("ко мне пришёл клиент", "у нас в агентстве", "знакомый предприниматель из ниши X").

Если по структуре материал выглядит как инструкция / руководство / "как правильно сделать X" / SEO-портянка - ПЕРЕСТРОЙ его в формат кейса с выводами: сначала ситуация и провал/конфликт/эксперимент, потом разбор причин, потом что сработало, и только потом - инструкция как побочный продукт.

Главный вопрос материала: "ЧТО ПРОИЗОШЛО И ЧЕМУ ЭТО НАУЧИЛО?", а НЕ "Как правильно делать?". Лид и первый H2 должны отвечать именно на первый вопрос.

Запрещено начинать статью с определений ("X - это..."), с пошагового плана ("Шаг 1. Шаг 2.") и с абстрактных рассуждений о пользе. Начинай со сцены, цифры потерь, конфликта или неожиданного результата.
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
 * Numeric Guard: режет в тексте конкретные числа с "рискованными" единицами
 * (рубли, %, км, литры, л.с., сСт, клиентов и т.п.), которых нет в списке
 * verifiedFacts. Заменяет на нейтральные обобщения. Числа, которые встречаются
 * в verifiedFacts как есть, пропускаются. Годы (1900-2099) тоже пропускаются.
 */
export function applyNumericGuard(md: string, verifiedFacts: string): { content: string; replaced: string[] } {
  const replaced: string[] = [];
  const facts = (verifiedFacts || "").toLowerCase();
  const allowed = new Set<string>();
  for (const m of facts.matchAll(/\d[\d.,]*\d|\d/g)) {
    allowed.add(m[0].replace(/[.,]+$/, ""));
  }
  const isAllowed = (raw: string) => {
    const n = raw.replace(/\s+/g, "").replace(/[.,]+$/, "");
    if (/^(19|20)\d{2}$/.test(n)) return true; // годы общеизвестны
    return allowed.has(n);
  };
  const log = (label: string, m: string) => { replaced.push(`${label}:${m.trim().slice(0, 50)}`); };

  const patterns: Array<{ re: RegExp; soft: () => string; label: string }> = [
    // Цены в рублях / тыс / млн руб
    { re: /\b(\d[\d\s.,]{0,8})\s?(?:руб(?:лей|\.|ля)?|₽|р\.|тыс\.?\s?руб|млн\s?руб)\b/gi,
      soft: () => "в среднем по рынку", label: "price" },
    // Проценты
    { re: /\b(\d+[.,]?\d*)\s?(?:%|процент(?:а|ов)?)/gi,
      soft: () => "заметно", label: "percent" },
    // Единицы измерения: км, литры, л.с., сСт, мощность, моменты, расход
    { re: /\b(\d+[.,]?\d*)\s?(?:км|л\/100\s?км|литр(?:а|ов)?\b|л\.?с\.?|с[Сс]т|нм|кВт|вт|об\/мин|мпа|бар)\b/gi,
      soft: () => "ощутимо", label: "measurement" },
    // Сроки в днях/месяцах/часах с числом
    { re: /\b(\d+)\s?(?:дн(?:я|ей)?|сут(?:ок|ки)?|мес(?:яц(?:а|ев)?)?|час(?:а|ов)?|мин(?:ут(?:а|ы)?)?)\b/gi,
      soft: () => "несколько", label: "duration" },
    // Бизнес-метрики автора: N клиентов / постов / машин / заказов
    { re: /\b(\d{2,})\s?(?:клиент(?:а|ов)?|машин|заказ(?:а|ов)?|пост(?:а|ов)?|пользоват(?:еля|елей)?|сотрудник(?:а|ов)?|подписчик(?:а|ов)?)\b/gi,
      soft: () => "десятки", label: "count" },
    // Деньги в виде "1,2 млн", "120 тыс" (без слова "руб")
    { re: /\b(\d+[.,]?\d*)\s?(?:млн|млрд|тыс\.?)\b(?!\s?руб)/gi,
      soft: () => "значительная сумма", label: "money" },
  ];

  let out = md;
  for (const { re, soft, label } of patterns) {
    out = out.replace(re, (m, num) => {
      if (typeof num === "string" && isAllowed(num)) return m;
      log(label, m);
      return soft();
    });
  }
  return { content: out, replaced };
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
    { label: "Длина 4500-7000 знаков", ok: chars >= 4500 && chars <= 7000, hint: `сейчас ${chars}` },
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

// ============================================================================
// Quality validators / post-processors (Story-First, Lead, SEO, openers, H1).
// ============================================================================

const LEAD_BANALITY_RE = /^[\s#>\-*_]*(в\s+современн\w*\s+(мир|реал|услов)|сегодня\s+(мног|кажд|пра|почт)|в\s+мире\s+(биз|сов|интер)|ни\s+для\s+кого\s+не\s+секрет|давайте\s+(разберемся|поговорим|обсудим)|итак,?\s|на\s+сегодняшний\s+день|в\s+наши\s+дни|с\s+развитием\s+технолог|многие\s+знают|общеизвестно|статистика\s+показывает|введение[:\.]|шаг\s*1[:.\s]|представь(те)?\s+себе|задумывались?\s+ли\s+вы|в\s+эпоху\s+(цифров|информ))/i;

export function detectLeadBanality(md: string): { banal: boolean; matched?: string; lead?: string } {
  const paras = md.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  for (const p of paras) {
    if (/^#{1,6}\s/.test(p)) continue;
    const m = p.match(LEAD_BANALITY_RE);
    return { banal: !!m, matched: m?.[0]?.trim().slice(0, 60), lead: p.slice(0, 600) };
  }
  return { banal: false };
}

export interface StoryFirstReport {
  ok: boolean;
  missing: string[];
  hasMoney: boolean;
  hasConsequence: boolean;
  hasPerson: boolean;
}

export function validateStoryFirst(md: string): StoryFirstReport {
  const text = stripText(md);
  const first500 = text.split(/\s+/).slice(0, 500).join(" ");
  const hasMoney = /(\d[\d\s.,]*\s?(?:руб|₽|млн|тыс|тысяч|миллион|млрд|долл|евро|\$|€))|(?:потер\w+|сэконом\w+|вложил\w+|оборот\w*|выручк\w+|прибыл\w+|убыт\w+|инвестиц\w+)\s+\w*\s*\d/i.test(first500);
  const hasConsequence = /(потер\w+|провал\w+|сорвал\w+|разорил\w+|пошл\w+\s+не\s+так|сломал\w+|не\s+сработал\w*|обжегся|облажал\w+|откатил\w+|закрыл\w+\s+проект|слил\w+\s+бюдж|ушел\w*\s+в\s+минус|ошибк\w+\s+стоил)/i.test(first500);
  const hasPerson = /(клиент\w*\s+(пришел|обратил|попросил|написал)|у\s+нас\s+в\s+(агентств|компани|команд|сервис|проект)|сам\s+столкнул|ко\s+мне\s+пришел|знаком\w+\s+(предпринимат|маркетол|сеошник|владел)|у\s+коллег|на\s+практике\s+у|один\s+из\s+(клиентов|проектов)|был\s+у\s+нас\s+(кейс|случ)|в\s+прошлом\s+(год|месяц|квартал))/i.test(first500);
  const missing: string[] = [];
  if (!hasMoney) missing.push("сумма_денег");
  if (!hasConsequence) missing.push("реальное_последствие");
  if (!hasPerson) missing.push("конкретный_человек_или_ситуация");
  return { ok: missing.length === 0, missing, hasMoney, hasConsequence, hasPerson };
}

export function detectRepeatedOpeners(md: string): { ok: boolean; offenders: Array<{ opener: string; count: number }> } {
  const paras = md.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && !/^#{1,6}\s/.test(p) && !/^[->|]/.test(p) && !/^P\.?\s*S\.?/i.test(p));
  const openers: Record<string, number> = {};
  for (const p of paras) {
    const first = p.split(/\s+/)[0]?.toLowerCase().replace(/[^a-zа-я-]/gi, "");
    if (!first || first.length < 2) continue;
    openers[first] = (openers[first] || 0) + 1;
  }
  const offenders = Object.entries(openers)
    .filter(([_, n]) => n >= 3)
    .map(([opener, count]) => ({ opener, count }))
    .sort((a, b) => b.count - a.count);
  return { ok: offenders.length === 0, offenders };
}

export function stripDuplicateH1(md: string, title: string): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const normTitle = norm(title);
  const out = md.split("\n").filter((line) => {
    if (!/^#\s+/.test(line)) return true;
    const h = norm(line.replace(/^#\s+/, ""));
    return h !== normTitle;
  }).join("\n");
  // Demote any remaining single # to ## (vc.ru already рендерит title отдельно)
  return out.replace(/^#\s+/gm, "## ");
}

const CLICHE_RE = /\s*(в\s+современных\s+реалиях|на\s+сегодняшний\s+день|не\s+секрет,?\s+что|давайте\s+разберемся|итак,?\s+подведем\s+итоги|стоит\s+отметить,?\s+что|следует\s+подчеркнуть,?\s+что|нельзя\s+не\s+упомянуть|в\s+заключение\s+хочется\s+(сказать|отметить)|подводя\s+итог|как\s+мы\s+уже\s+говорили|важно\s+понимать,?\s+что|в\s+современном\s+мире)\s*[,.]?\s*/gi;

export function stripCliches(md: string): { md: string; removed: number } {
  let count = 0;
  const out = md.replace(CLICHE_RE, (m) => { count++; return " "; })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([.,;:!?])/g, "$1");
  return { md: out, removed: count };
}

export interface SeoReport {
  ok: boolean;
  issues: string[];
  inTitle: boolean;
  inFirstH2: boolean;
  occurrences: number;
}

export function validateSeo(md: string, title: string, targetQuery: string): SeoReport {
  if (!targetQuery) return { ok: true, issues: [], inTitle: true, inFirstH2: true, occurrences: 0 };
  const q = targetQuery.toLowerCase().trim();
  const tokens = q.split(/\s+/).filter((t) => t.length > 3);
  const textLow = md.toLowerCase();
  const titleLow = title.toLowerCase();
  const inTitle = titleLow.includes(q) || (tokens.length > 0 && tokens.every((t) => titleLow.includes(t)));
  const h2s = (md.match(/^##\s+.+$/gm) || []).map((s) => s.toLowerCase());
  const inFirstH2 = !!h2s[0] && (h2s[0].includes(q) || tokens.some((t) => h2s[0].includes(t)));
  const head = tokens[0] || q;
  const occurrences = (textLow.match(new RegExp(head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  const issues: string[] = [];
  if (!inTitle) issues.push("title_no_keyword");
  if (!inFirstH2) issues.push("first_h2_no_keyword");
  if (occurrences < 4) issues.push(`low_density:${occurrences}`);
  return { ok: issues.length === 0, issues, inTitle, inFirstH2, occurrences };
}

async function rewriteLead(apiKey: string, lead: string, topic: string, thesis: string): Promise<string | null> {
  try {
    const r = await chatJson<{ lead: string }>({
      apiKey,
      model: "google/gemini-2.5-flash",
      system: "Ты редактор vc.ru. Перепиши лид (первый абзац) так, чтобы НЕ начинался с банальностей ('В современном мире', 'Сегодня', 'Итак', 'Шаг 1', 'X - это', 'Давайте разберемся', 'Представьте'). Начни со сцены, конкретной цифры потерь/прибыли, конфликта, провала или провокации. Без буквы ё, без длинных тире, без жирного, без markdown-заголовков. 3-5 коротких предложений.",
      user: `Тема: ${topic}\nТезис: ${thesis || "(не задан)"}\nТекущий банальный лид:\n${lead}\n\nВерни JSON: {"lead": "новый лид одним абзацем"}`,
      temperature: 0.9,
      maxTokens: 500,
      timeoutMs: 30_000,
      appTitle: "vc.ru Lead Rewrite",
      retries: 0,
    });
    const out = r.data?.lead;
    if (!out) return null;
    return normalizeDashes(ruEReplace(String(out))).replace(/\*\*([^*]+)\*\*/g, "$1").trim();
  } catch (e) {
    console.warn("[rewriteLead] failed", (e as Error)?.message);
    return null;
  }
}

async function fixTitleForSeo(apiKey: string, title: string, targetQuery: string): Promise<string | null> {
  try {
    const r = await chatJson<{ title: string }>({
      apiKey,
      model: "google/gemini-2.5-flash",
      system: "Ты SEO-редактор vc.ru. Перепиши заголовок так, чтобы он содержал ключевой запрос (почти дословно, можно поменять падеж/число), оставался цепким, до 90 символов, без буквы ё, без длинных тире, без жирного.",
      user: `Запрос: ${targetQuery}\nТекущий заголовок: ${title}\n\nВерни JSON: {"title": "новый заголовок"}`,
      temperature: 0.5,
      maxTokens: 200,
      timeoutMs: 20_000,
      appTitle: "vc.ru Title Fix",
      retries: 0,
    });
    const out = r.data?.title;
    if (!out) return null;
    return normalizeDashes(ruEReplace(String(out))).replace(/\*\*([^*]+)\*\*/g, "$1").slice(0, 90).trim();
  } catch (e) {
    console.warn("[fixTitleForSeo] failed", (e as Error)?.message);
    return null;
  }
}

/** Заменяет первый «лид-абзац» в markdown на новый текст, сохраняя H1/H2 сверху. */
export function replaceLead(md: string, newLead: string): string {
  const lines = md.split("\n");
  let i = 0;
  // пропускаем верхние пустые/заголовки
  while (i < lines.length && (!lines[i].trim() || /^#{1,6}\s/.test(lines[i].trim()))) i++;
  if (i >= lines.length) return md;
  // находим конец первого абзаца (до пустой строки)
  let j = i;
  while (j < lines.length && lines[j].trim() && !/^#{1,6}\s/.test(lines[j].trim())) j++;
  return [...lines.slice(0, i), newLead, ...lines.slice(j)].join("\n");
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
  /** Markdown-выжимка анализа топ-материалов по теме (из action=topic_research). */
  topicResearch?: string;
  /** Запустить humanize-пасс (Sonnet+Opus). Долго (~120с). По умолчанию false. */
  humanize?: boolean;
  /** Запретить авто-rewrite лида при банальном начале. По умолчанию false (фикс включен). */
  skipLeadFix?: boolean;
  /** Запретить SEO-фикс title. По умолчанию false (фикс включен). */
  skipSeoFix?: boolean;
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
  risk_report?: RiskReport;
  numeric_guard?: { replaced: string[]; count: number };
  story_report?: StoryFirstReport;
  lead_report?: { wasBanal: boolean; matched?: string; rewritten: boolean };
  seo_report?: SeoReport & { titleFixed?: boolean };
  openers_report?: { ok: boolean; offenders: Array<{ opener: string; count: number }> };
  cliches_removed?: number;
  humanize_report?: { applied: boolean; passes: number; models: string[]; rejections?: string[]; skipped?: string };
}

function buildPrompt(p: VcGenInput): { system: string; user: string } {
  const ratingBlock = p.format === "rating" ? `\n\n${VC_RATING_PROTOCOL}` : "";
  const system = `Ты - редактор vc.ru с 5-летним опытом. Твоя задача - написать материал, который попадет в топ vc.ru и зайдет в Google/Yandex. Пиши на русском, без буквы ё (заменяй на е).\n\n${VC_PROTOCOL}\n\n${VC_STORY_PROTOCOL}\n\nФОРМАТ ЭТОГО МАТЕРИАЛА: ${VC_FORMAT_BRIEF[p.format]}${ratingBlock}`;
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
    : `\n\nРЕЖИМ "БЕЗ КОНКРЕТНЫХ ЧИСЕЛ" (КРИТИЧНО, нарушение = текст идёт в мусорку):\nПользователь НЕ дал проверенных фактов. Это значит АБСОЛЮТНЫЙ ЗАПРЕТ на любые конкретные числа в следующих категориях:\n- Цены (в рублях, тысячах, миллионах) - ни своих, ни конкурентов. НЕ писать "Shell 4100 руб", "наш сервис 2400 руб", "сэкономили 1800 руб".\n- Проценты (5%, 18%, 0,4 л) - запрещены, кроме широко известных констант (например, НДС 20%).\n- Лабораторные/технические показатели: вязкость, плотность, моторесурс, расход топлива, мощность, крутящий момент, давление, температура.\n- Конкретные пробеги ("за 6000 км"), сроки ("за 8 месяцев"), даты с месяцем ("в январе 2023").\n- Бизнес-метрики автора: количество клиентов, машин, постов, штат, оборот.\n- Названия конкретных моделей техники с результатами ("Camry 2019", "Kia Rio").\n- Сертификации с кодами (API SN, ACEA A3/B4) - только если общеизвестны для категории.\nВместо конкретики ОБЯЗАТЕЛЬНО используй: "по нашей практике", "обычно", "в среднем по рынку", "у коллег видел", диапазоны ("на 15-30% дешевле"), пропорции ("у X из Y клиентов"). Лучше пресный честный текст, чем живой с галлюцинациями - постпроцессор всё равно вырежет конкретику и заменит на обобщения, ты только испортишь читаемость.`;
  const user = `Тема: ${p.topic}\nГлавный тезис: ${p.thesis || "сформулируй сам исходя из темы"}\nАудитория vc.ru: ${p.audience || "предприниматели, маркетологи, продактменеджеры"}\nТон: ${p.tone || "экспертно-разговорный с легкой провокацией"}\nЦелевая длина: ${p.length || 5500} знаков (+-20%).${persona}${facts}${seo}${links}${avoid}\n\nВерни строго JSON:\n{\n  "title": "заголовок до 90 символов",\n  "subtitle": "подзаголовок 1-2 предложения, продает клик",\n  "tags": ["тег1","тег2",...],\n  "ps_question": "вопрос аудитории для P.S.",\n  "markdown": "полный текст материала в markdown с H2, списками. Включи в конец строку 'P.S. <ps_question>'"\n}`;
  const research = p.topicResearch && p.topicResearch.trim()
    ? `\n\nАНАЛИЗ ТЕМЫ (топ-материалы по теме на vc.ru и в рунете - ИСПОЛЬЗОВАТЬ ПАТТЕРНЫ, НЕ КОПИРОВАТЬ):\nПрименяй выявленные паттерны (типы заголовков, структуру, что обсуждают, какие возражения). КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО копировать конкретные цифры, кейсы, имена, расчёты и формулировки из этих статей - только закономерности.\n--- начало анализа ---\n${p.topicResearch.trim().slice(0, 5000)}\n--- конец анализа ---`
    : "";
  return { system, user: user + research };
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
  // Cliché stripper: быстрая зачистка штампов до Numeric Guard.
  const clicheCleaned = stripCliches(markdown);
  markdown = clicheCleaned.md;
  // Numeric Guard: режем конкретные числа, которых нет в проверенных фактах.
  const guard = applyNumericGuard(markdown, input.verifiedFacts || "");
  markdown = guard.content;
  const numeric_guard = { replaced: guard.replaced.slice(0, 40), count: guard.replaced.length };
  let title = normalizeDashes(ruEReplace(String(data.title || ""))).slice(0, 90);
  const subtitle = normalizeDashes(ruEReplace(String(data.subtitle || ""))).slice(0, 240);
  const ps_question = normalizeDashes(ruEReplace(String(data.ps_question || "")));
  const tags = Array.isArray(data.tags)
    ? data.tags.slice(0, 6).map((t: any) => normalizeDashes(ruEReplace(String(t))).slice(0, 30))
    : [];

  if (ps_question && !/P\.?\s*S\.?/i.test(markdown)) {
    markdown += `\n\nP.S. ${ps_question}`;
  }

  // Удаляем дубль H1 заголовка и понижаем оставшиеся '#' до '##'.
  markdown = stripDuplicateH1(markdown, title);

  // Lead-banality fix: если лид начинается со штампа, перепишем только его дешёвой моделью.
  let lead_report: { wasBanal: boolean; matched?: string; rewritten: boolean } = { wasBanal: false, rewritten: false };
  if (!input.skipLeadFix) {
    const banal = detectLeadBanality(markdown);
    lead_report = { wasBanal: banal.banal, matched: banal.matched, rewritten: false };
    if (banal.banal && banal.lead) {
      const newLead = await rewriteLead(input.apiKey, banal.lead, input.topic, input.thesis || "");
      if (newLead && newLead.length > 60) {
        markdown = replaceLead(markdown, newLead);
        lead_report.rewritten = true;
      }
    }
  }

  // SEO post-check + title auto-fix.
  let seoReportFull: (SeoReport & { titleFixed?: boolean }) | undefined;
  if (input.targetQuery) {
    let seoR = validateSeo(markdown, title, input.targetQuery);
    let titleFixed = false;
    if (!input.skipSeoFix && !seoR.inTitle) {
      const newTitle = await fixTitleForSeo(input.apiKey, title, input.targetQuery);
      if (newTitle) {
        title = newTitle;
        titleFixed = true;
        markdown = stripDuplicateH1(markdown, title);
        seoR = validateSeo(markdown, title, input.targetQuery);
      }
    }
    seoReportFull = { ...seoR, titleFixed };
  }

  // Гарантия вставки клиентских ссылок.
  let linksReport: { injected: string[]; appended: string[] } = { injected: [], appended: [] };
  if (input.clientLinks && input.clientLinks.length) {
    const r = ensureClientLinks(markdown, input.clientLinks.map((l) => ({ url: l.url, anchor: l.anchor })));
    markdown = r.md;
    linksReport = { injected: r.injected, appended: r.appended };
  }

  // Humanize pass (опциональный, долгий — ~120с).
  let humanize_report: VcGenResult["humanize_report"] | undefined;
  if (input.humanize) {
    try {
      const h: DoubleHumanizeResult = await runDoubleHumanizePass(markdown, "ru", input.apiKey);
      if (h.content && h.content.length > 200 && h.passesApplied > 0) {
        markdown = stripMarkdownTables(normalizeDashes(ruEReplace(h.content))).replace(/\*\*([^*]+)\*\*/g, "$1");
        markdown = stripDuplicateH1(markdown, title);
      }
      humanize_report = {
        applied: h.passesApplied > 0,
        passes: h.passesApplied,
        models: h.modelsUsed,
        rejections: h.rejections,
        skipped: h.opusSkipReason,
      };
    } catch (e) {
      console.error("[generateVcArticle] humanize failed", e);
      humanize_report = { applied: false, passes: 0, models: [], skipped: "exception" };
    }
  }

  let cover_data_url: string | null = null;
  if (input.wantCover) {
    cover_data_url = await generateCover(`${title}. ${subtitle}`);
  }

  const checklist = buildChecklist(markdown, ps_question);
  const story_report = validateStoryFirst(markdown);
  const openers_report = detectRepeatedOpeners(markdown);

  checklist.push(
    { label: "Story-First (сумма+последствие+человек в первых 500 словах)",
      ok: story_report.ok,
      hint: story_report.ok ? "ок" : `не хватает: ${story_report.missing.join(", ")}` },
    { label: "Лид без банальных штампов",
      ok: !lead_report.wasBanal || lead_report.rewritten,
      hint: lead_report.wasBanal
        ? (lead_report.rewritten ? `переписан (был: "${lead_report.matched}")` : `штамп: "${lead_report.matched}"`)
        : "ок" },
    { label: "Без повторяющихся зачинов абзацев",
      ok: openers_report.ok,
      hint: openers_report.ok ? "ок" : openers_report.offenders.map((o) => `"${o.opener}" x${o.count}`).join(", ") },
  );
  if (input.targetQuery && seoReportFull) {
    checklist.push({
      label: `SEO: запрос "${input.targetQuery}" в title и H2`,
      ok: seoReportFull.ok,
      hint: seoReportFull.ok
        ? `${seoReportFull.occurrences} упоминаний${seoReportFull.titleFixed ? ", title пофиксили" : ""}`
        : seoReportFull.issues.join(", "),
    });
  }

  // Fact-Check Guard (по умолчанию ON).
  let risk_report: RiskReport | undefined;
  if (input.factCheck !== false) {
    try {
      risk_report = await factCheckMarkdown(input.apiKey, markdown, input.verifiedFacts);
    } catch (e) {
      console.error("[generateVcArticle] fact-check failed", e);
    }
  }

  return {
    markdown,
    meta: { title, subtitle, tags, ps_question },
    checklist,
    cover_data_url,
    stats: { chars: stripText(markdown).length, model: result.model },
    links_report: linksReport,
    risk_report,
    numeric_guard,
    story_report,
    lead_report,
    seo_report: seoReportFull,
    openers_report,
    cliches_removed: clicheCleaned.removed,
    humanize_report,
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