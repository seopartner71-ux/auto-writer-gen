// Classifies competitor phrases into actions for the article generator.
// Pure module (no Deno APIs) so it is unit-tested from vitest.
//   add   - topical phrase, may be used
//   check - commercial promise (price, term, warranty, delivery...) - needs client confirmation
//   skip  - template / legal / navigation noise unrelated to the query
// Frequency alone never makes a phrase noise: it must contain a template marker
// AND share no word with the query.

export type TermAction = "add" | "check" | "skip";

export interface TermActionRow {
  phrase: string;
  action: TermAction;
  reason: string;
  source: string;
  docs?: number;
  commonality?: number;
}

const NOISE_MARKERS: Array<[RegExp, string]> = [
  [/политик|конфиденц|персональн|cookie|куки|соглас|обработк[а-я]* данн|privacy|policy|consent|gdpr/i, "юридический шаблон"],
  [/все права|защищен|copyright|rights reserved|оферт/i, "юридический шаблон"],
  [/корзин|войти|вход|регистрац|кабинет|избранн|сравнени[еяю] товар|карта сайта|наверх|главная страниц|меню|подписат|подписк|рассылк|cart|login|sign in|sign up|subscribe|newsletter|sitemap/i, "навигация сайта"],
  [/обратн[а-я]* звон|заказать звонок|оставить заявк|перезвоним|whatsapp|telegram|вконтакте|соцсет/i, "служебный блок связи"],
];

const COMMERCIAL_MARKERS: Array<[RegExp, string]> = [
  [/цен|стоимост|руб|₽|\$|скидк|акци|дешев|прайс|price|cost|discount/i, "цена"],
  [/гарант|warranty|guarantee/i, "гарантия"],
  [/срок|дн[еяй]|час[аов]*\b|минут|за сутки|быстр|days?\b|hours?\b/i, "сроки"],
  [/доставк|самовывоз|delivery|shipping/i, "доставка"],
  [/оплат|рассрочк|кредит|payment|installment/i, "оплата"],
  [/бесплатн|free\b/i, "бесплатные условия"],
  [/лет на рынке|опыт работы|лицензи|сертифик|years? of experience/i, "заявление о компании"],
];

/** Marker must start a word (avoids "фракция" matching "акци"). */
function hit(re: RegExp, p: string): boolean {
  const lower = ` ${p.toLowerCase().replace(/ё/g, "е")}`;
  return new RegExp(`(?:^|[^a-zа-я0-9])(?:${re.source})`, "i").test(lower);
}

function stems(s: string): Set<string> {
  return new Set(
    (s || "").toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/i)
      .filter((w) => w.length >= 4).map((w) => w.slice(0, 5)),
  );
}

// Price-unit remnants after tokenizing "руб/т", "руб/м³", "р.", "₽".
const UNIT_RE = /^(?:руб[а-я]*|р|рт|рм|рм3|м3|м³|т|шт|кг|₽|rub)$/i;
const FILLER_RE = /^(?:подробнее|далее|еще|смотреть|узнать|читать|больше|купить|заказать|цена|цены|от|до|за)$/i;

/** Strips price-unit remnants; returns cleaned phrase and whether it was a price fragment. */
export function cleanPhrase(phrase: string): { text: string; hadUnit: boolean; onlyFiller: boolean } {
  const words = (phrase || "").trim().split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !UNIT_RE.test(w.replace(/[.,/]/g, "")));
  const hadUnit = kept.length !== words.length;
  const onlyFiller = kept.every((w) => FILLER_RE.test(w) || !/[a-zа-яё]/i.test(w));
  return { text: kept.join(" "), hadUnit, onlyFiller };
}

export function classifyPhrase(phrase: string, query: string): { action: TermAction; reason: string } {
  const c = cleanPhrase(phrase);
  if (c.hadUnit && c.onlyFiller) return { action: "skip", reason: "обрывок цены (руб/т, руб/м3) без темы" };
  const p = c.text;
  if (!/[a-zа-яё]/i.test(p)) return { action: "skip", reason: "нет слов, только цифры или символы" };
  const q = stems(query);
  const related = [...stems(p)].some((w) => q.has(w));

  for (const [re, label] of NOISE_MARKERS) {
    if (hit(re, p) && !related) return { action: "skip", reason: `${label}, не связано с запросом` };
  }
  const commercialQuery = hit(/купит|заказ|цен|стоим|услуг|достав|недорог|под ключ|прайс|buy|order|price/, query);
  for (const [re, label] of COMMERCIAL_MARKERS) {
    // Time words are a topic in informational queries ("сколько сохнут"), a promise only in commercial ones.
    if (label === "сроки" && !commercialQuery && !/\d/.test(p)) continue;
    if (!hit(re, p)) continue;
    // Marker word is part of the query itself ("щебень с доставкой") and no concrete number -> topic, not a promise.
    const markerWords = p.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9₽$]+/i).filter((w) => w && hit(re, w));
    if (!/\d/.test(p) && markerWords.length && markerWords.every((w) => q.has(w.slice(0, 5)))) continue;
    return { action: "check", reason: `${label}: у конкурента, в статью только если подтверждено данными клиента` };
  }
  for (const [re, label] of NOISE_MARKERS) {
    if (!hit(re, p)) continue;
    // Marker word is part of the query itself ("щебень с доставкой") and no concrete number -> topic, not a promise.
    const markerWords = p.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9₽$]+/i).filter((w) => w && hit(re, w));
    if (!/\d/.test(p) && markerWords.length && markerWords.every((w) => q.has(w.slice(0, 5)))) continue;
    return { action: "check", reason: `похоже на ${label}, но связано с запросом` };
  }
  return { action: "add", reason: related ? "связано с запросом" : "тема из текстов конкурентов" };
}

export function classifyTerms(
  query: string,
  input: {
    tfidf?: Array<{ phrase: string; docs?: number; commonality?: number }>;
    lsi?: string[];
    mustUse?: Array<{ phrase: string }>;
  },
): TermActionRow[] {
  const out = new Map<string, TermActionRow>();
  const push = (raw: string, source: string, extra: Partial<TermActionRow> = {}) => {
    const c = cleanPhrase(raw);
    const phrase = c.hadUnit && !c.onlyFiller ? c.text : (raw || "");
    const key = phrase.trim().toLowerCase();
    if (!key || out.has(key)) return;
    out.set(key, { phrase: phrase.trim(), source, ...classifyPhrase(phrase, query), ...extra });
  };
  (input.mustUse || []).forEach((m) => push(m.phrase, "ИИ-анализ ТОП-3"));
  (input.lsi || []).forEach((p) => push(p, "есть только в ТОП-3"));
  (input.tfidf || []).forEach((t) => push(t.phrase, `встречается на ${t.docs ?? "?"} стр. ТОПа`, { docs: t.docs, commonality: t.commonality }));
  return [...out.values()];
}
