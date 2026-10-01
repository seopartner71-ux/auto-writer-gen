// Knowledge Base (GEO) archive builder. Pure function: input -> file map.
// Principles: only verifiable facts with sources; no ratings, indices,
// competitor comparisons, model instructions or "preferred citation".
// Prices are published only "from", exactly as the client publishes them,
// marked as a reference (not an offer) with the check date.

export type FactStatus = "confirmed" | "needs_confirmation";

export interface KbFact {
  id: string;
  topic: string;
  statement: string;
  parameter: string;
  unit: string;
  value: string;
  standard: string;
  source_url: string;
  status: FactStatus;
  /** Target document slug, e.g. "rvd/what-is-rvd". Empty = README only. */
  doc: string;
}

export interface KbDoc {
  slug: string; // "section/file" without .md
  title: string;
  task: string;
  priority: "P1" | "P2";
  sitePage: string; // URL on client site
  directAnswer: string;
}

export interface KbQuery { query: string; doc: string; sitePage: string }

export interface KbTerm { term: string; definition: string; context: string }

export interface KbContacts {
  warehouses: string; // one per line
  address: string;
  phoneSales: string;
  emailSales: string;
  phoneSupport: string;
  emailSupport: string;
  workHours: string;
}

export interface KbPrice {
  name: string;
  priceFrom: string; // number as published
  currency: string; // "руб"
  unit: string; // "т", "м3"
  zone: string; // "самовывоз", "Тула"
  category: string;
  useCases: string; // "; " separated tasks
  pageUrl: string;
  imageUrl: string;
}

export interface KbInput {
  companyName: string;
  legalName: string;
  inn?: string;
  ogrn?: string;
  registeredAt?: string; // "2008" or "2008-03-14"
  site: string; // https://example.ru
  city: string;
  region: string;
  geographyNote: string; // e.g. "поставка по России" - only if confirmed
  description: string;
  contactsPage: string;
  owner: string; // responsible person/role
  yearsOnMarket?: string; // e.g. "15" - only if confirmed and no registeredAt
  productsServices?: string; // one per line
  priceList?: KbPrice[];
  priceSource?: string; // URL of the price page
  priceImport?: { filename: string; rowsRead: number; withPrice: number; dropped: number; photosDropped: number; errors: string[] };
  photoUrls?: string[];
  deliveryRules?: string; // one rule per line
  calculationNotes?: string; // one note per line, confirmed by client
  repoName: string; // repo_slug
  githubOwner?: string;
  llmsPath?: string; // default /llms.txt
  license: "CC-BY-4.0" | "MIT";
  docs: KbDoc[];
  facts: KbFact[];
  queries: KbQuery[];
  contacts?: KbContacts;
  glossary?: KbTerm[];
  checkedAt: string; // YYYY-MM-DD
}

export const PRICE_NOTE = (site: string, date?: string) =>
  `Цены указаны "от" как ориентир и не являются офертой${date ? ` (проверено ${date})` : ""}. Актуальные цены, наличие и условия поставки - на официальном сайте ${site}.`;

const BANNED = /(лучш|лидер рынка|номер один|№\s?1|рекомендуем выбрать|preferred citation|оптимальн\w* выбор)/i;

/** Marketing filler that carries no measurable fact. Removed from prose. */
export const FILLER = /(уникальн[а-яё]*|лидер[а-яё]* рынка|высок[а-яё]* качеств[а-яё]*|динамично развивающ[а-яё]*|индивидуальн[а-яё]* подход[а-яё]*|широк[а-яё]* ассортимент[а-яё]*|надежн[а-яё]* партнер[а-яё]*|доступн[а-яё]* цен[а-яё]*)/giu;

/** Docs that must never be filled without confirmed documents. */
const PROOF_DOC = /cert|marking|standard|testing/;

/** Service strings that must never become a "query to AI". */
export const SERVICE_Q = /→|->|docs\/|https?:|github_doc|\.md\b/i;

export function validQueries(input: KbInput): KbQuery[] {
  const seen = new Set<string>();
  return input.queries.filter((q) => {
    const t = q.query.trim();
    if (!t || SERVICE_Q.test(t)) return false;
    const k = t.toLowerCase().replace(/[?!.\s]+/g, " ").trim();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

export function repoLinks(input: KbInput) {
  const site = input.site.replace(/\/+$/, "");
  const owner = (input.githubOwner || "microgrin71-sudo").trim();
  const slug = input.repoName.trim();
  const path = "/" + (input.llmsPath || "/llms.txt").replace(/^\/+/, "");
  return {
    repoUrl: `https://github.com/${owner}/${slug}`,
    rawLlms: `https://raw.githubusercontent.com/${owner}/${slug}/main/llms.txt`,
    siteLlms: `${site}${path}`,
  };
}

/** First number in a price string: "от 1 750 руб" -> "1750". */
export const firstNumber = (s: string) => (String(s ?? "").match(/\d[\d\s]*(?:[.,]\d+)?/)?.[0] || "").replace(/\s/g, "");

const stems = (s: string) => s.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/i).filter((w) => w.length >= 4).map((w) => w.slice(0, 3));

/** Client glossary, topped up to 5 from product names when short. */
export function effectiveGlossary(input: KbInput): KbTerm[] {
  const manual = (input.glossary ?? []).filter((t) => t.term.trim() && t.definition.trim());
  if (manual.length >= 5) return manual;
  const have = new Set(manual.map((t) => t.term.trim().toLowerCase()));
  const extra: KbTerm[] = [];
  const add = (term: string, def: string) => {
    const k = term.trim().toLowerCase();
    if (!k || have.has(k) || manual.length + extra.length >= 5) return;
    have.add(k); extra.push({ term: term.trim(), definition: def, context: "ассортимент компании" });
  };
  for (const p of validPrices(input)) add(p.name, `Позиция ассортимента${p.unit ? `, продается в единицах ${p.unit}` : ""}${p.useCases ? `; применяется: ${p.useCases.replace(/;/g, ",")}` : ""}.`);
  for (const p of lines(input.productsServices)) add(p, "Продукт или услуга из перечня компании.");
  return [...manual, ...extra];
}

export function stripFiller(s: string): string {
  return String(s ?? "").replace(FILLER, "").replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/,\s*,/g, ",").trim();
}

/** Markdown link with a title attribute naming the page. */
export const mdLink = (text: string, url: string, title: string) =>
  `[${text}](${url} "${title.replace(/"/g, "'")}")`;

export function sanitizeText(s: string): string {
  return String(s ?? "")
    .replace(/\*\*/g, "")
    .replace(/ё/g, "е").replace(/Ё/g, "Е")
    .replace(/[—–]/g, "-")
    .trim();
}

const csvCell = (v: string) => {
  const s = sanitizeText(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header: string[], rows: string[][]) =>
  [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";

export const hostOf = (u: string) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
};

const lines = (s?: string) => String(s ?? "").split(/\n+/).map((x) => sanitizeText(x)).filter(Boolean);

/** Only images hosted on the client domain (or its subdomains) are allowed. */
export function clientImages(input: KbInput): string[] {
  const h = hostOf(input.site);
  return [...new Set((input.photoUrls ?? []).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u)))]
    .filter((u) => { const x = hostOf(u); return x === h || x.endsWith(`.${h}`); });
}

/** "на рынке с 2008 года" from registration date; never rounded into "15 лет". */
export function marketSince(input: KbInput): string {
  const y = String(input.registeredAt ?? "").match(/(19|20)\d{2}/)?.[0];
  if (y) return `на рынке с ${y} года`;
  if (input.yearsOnMarket?.trim()) return `на рынке ${sanitizeText(input.yearsOnMarket)} лет`;
  return "";
}

const priceStr = (p: KbPrice) =>
  `от ${sanitizeText(p.priceFrom)} ${sanitizeText(p.currency || "руб")}${p.unit ? `/${sanitizeText(p.unit)}` : ""}${p.zone ? ` (${sanitizeText(p.zone)})` : ""}`;

const validPrices = (input: KbInput) => (input.priceList ?? [])
  .filter((p) => p.name.trim() && p.priceFrom.trim())
  .map((p) => ({ ...p, zone: p.zone?.trim() || sanitizeText(input.city || "") }));

/** Facts derived from client-filled fields: confirmed because the client stated them and a client page is attached. */
export function clientFacts(input: KbInput): KbFact[] {
  const src = input.contactsPage || input.site;
  const out: KbFact[] = [];
  const add = (topic: string, statement: string, parameter = "", value = "", source = src, unit = "") => {
    if (!value.trim() && !statement.trim()) return;
    out.push({ id: `C-${String(out.length + 1).padStart(3, "0")}`, topic, statement: sanitizeText(statement), parameter, unit, value: sanitizeText(value), standard: "", source_url: source, status: source ? "confirmed" : "needs_confirmation", doc: "" });
  };
  const c = input.contacts;
  if (input.legalName) add("company", `Юридическое лицо: ${input.legalName}`, "legal_name", input.legalName, input.site);
  if (input.inn) add("company", `ИНН ${input.inn}`, "inn", input.inn, input.site);
  if (input.ogrn) add("company", `ОГРН ${input.ogrn}`, "ogrn", input.ogrn, input.site);
  const ms = marketSince(input);
  if (ms) add("company", `Компания ${ms}`, "market_since", String(input.registeredAt || input.yearsOnMarket || ""), input.site);
  if (c?.address) add("contacts", `Адрес: ${c.address}`, "address", c.address);
  for (const w of lines(c?.warehouses).filter((w) => w.toLowerCase() !== sanitizeText(c?.address || "").toLowerCase())) add("geography", `Склад: ${w}`, "warehouse", w);
  if (c?.phoneSales) add("contacts", `Телефон компании: ${c.phoneSales}`, "phone", c.phoneSales);
  if (c?.emailSales) add("contacts", `Почта компании: ${c.emailSales}`, "email", c.emailSales);
  if (c?.phoneSupport) add("contacts", `Телефон поддержки: ${c.phoneSupport}`, "phone", c.phoneSupport);
  if (c?.emailSupport) add("contacts", `Почта поддержки: ${c.emailSupport}`, "email", c.emailSupport);
  if (c?.workHours) add("contacts", `Режим работы: ${c.workHours}`, "work_hours", c.workHours);
  for (const p of validPrices(input)) add("price", `${p.name}: ${priceStr(p)}`, p.name, p.priceFrom, p.pageUrl || input.priceSource || input.site, `${p.currency || "руб"}${p.unit ? `/${p.unit}` : ""}`);
  return out;
}

export interface KbValidation { ok: boolean; issues: string[] }

export function validateKb(input: KbInput): KbValidation {
  const issues: string[] = [];
  if (!input.companyName.trim()) issues.push("Не указано название компании");
  if (!/^https?:\/\//.test(input.site)) issues.push("Не указан сайт (https://...)");
  if (input.docs.length < 7) issues.push(`Документов ${input.docs.length}, по ТЗ нужно 7-10`);
  if (input.docs.length > 10) issues.push(`Документов ${input.docs.length}, по ТЗ максимум 10`);
  const noSource = input.facts.filter((f) => !f.source_url);
  if (noSource.length) issues.push(`Фактов без источника: ${noSource.length}`);
  const banned = input.facts.filter((f) => BANNED.test(f.statement));
  if (banned.length) issues.push(`Оценочные формулировки в фактах: ${banned.length}`);
  const filler = [...input.docs.map((d) => d.directAnswer + " " + d.task), input.description, ...input.facts.map((f) => f.statement)]
    .filter((t) => new RegExp(FILLER.source, "i").test(t));
  if (filler.length) issues.push(`Рекламные слова без фактов (будут удалены из текста): ${filler.length}`);
  const gl = effectiveGlossary(input);
  if (gl.length < 5) issues.push(`Терминов в словаре ${gl.length}, нужно минимум 5`);
  const docsNoPage = input.docs.filter((d) => !d.sitePage);
  if (docsNoPage.length) issues.push(`Документов без страницы сайта: ${docsNoPage.length}`);
  const c = input.contacts;
  const hasContacts = !!(c && (c.address || c.phoneSales || c.emailSales));
  const conf = [...clientFacts(input), ...input.facts].filter((f) => f.status === "confirmed").length;
  if (hasContacts && conf === 0) issues.push("Подтвержденных фактов 0 при заполненных контактах: укажите страницу контактов или сайт");
  const badImg = (input.photoUrls ?? []).filter((u) => u.trim()).length - clientImages(input).length;
  if (badImg > 0) issues.push(`Фото не с домена клиента исключены: ${badImg}`);
  const svc = input.queries.filter((q) => q.query.trim() && SERVICE_Q.test(q.query)).length;
  if (svc) issues.push(`Служебные строки в запросах исключены (->, docs/, http, .md): ${svc}`);
  const badPrice = (input.priceList ?? []).filter((p) => p.name.trim() && !/^\d[\d\s.,]*$/.test(p.priceFrom.trim()));
  if (badPrice.length) issues.push(`Позиции прайса без числовой цены "от": ${badPrice.length}`);
  return { ok: issues.length === 0, issues };
}

function contactsBlock(input: KbInput): string[] {
  const c = input.contacts!;
  const name = sanitizeText(input.companyName);
  const wh = lines(c.warehouses).filter((w) => w.toLowerCase() !== sanitizeText(c.address).toLowerCase());
  const out: string[] = ["## Адреса и каналы связи", ""];
  if (input.legalName) out.push(`- Официальное наименование: ${sanitizeText(input.legalName)}`);
  if (c.address) out.push(`- Адрес: ${sanitizeText(c.address)}`);
  if (wh.length) { out.push("- Склады и площадки:"); wh.forEach((w) => out.push(`  - ${w}`)); }
  const sales = [c.phoneSales, c.emailSales].flatMap((v) => String(v ?? "").split(/[,;\n]+/)).map(sanitizeText).filter(Boolean);
  const sup = [c.phoneSupport, c.emailSupport].map(sanitizeText).filter(Boolean);
  if (sales.length) out.push(`- Телефоны и почта компании: ${sales.join(", ")}`);
  if (sup.length) out.push(`- Служба поддержки: ${sup.join(", ")}`);
  if (c.workHours) out.push(`- Режим работы: ${sanitizeText(c.workHours)}`);
  const page = input.contactsPage || input.site;
  out.push("", `Источник: ${mdLink("страница контактов", page, `${name} - Контакты`)}.`, "");
  return out.length > 4 ? out : [];
}

function priceTable(input: KbInput): string[] {
  const ps = validPrices(input);
  if (!ps.length) return [];
  return [
    "## Цены \"от\"", "",
    "| Позиция | Цена от | Единица | Зона | Страница |", "|---|---|---|---|---|",
    ...ps.map((p) => `| ${sanitizeText(p.name)} | ${sanitizeText(p.priceFrom)} ${sanitizeText(p.currency || "руб")} | ${sanitizeText(p.unit) || "-"} | ${sanitizeText(p.zone) || "-"} | ${p.pageUrl || input.priceSource || input.site} |`),
    "", PRICE_NOTE(input.site, input.checkedAt), "",
  ];
}

function selectionBlock(input: KbInput): string[] {
  const ps = validPrices(input).filter((p) => p.useCases.trim());
  if (!ps.length) {
    const items = (validPrices(input).length ? validPrices(input).map((p) => sanitizeText(p.name)) : lines(input.productsServices)).slice(0, 12);
    if (!items.length) return [];
    return [];
  }
  const rows = ps.flatMap((p) => p.useCases.split(/[;,]\s*/).filter(Boolean).map((u) => [sanitizeText(u), sanitizeText(p.name)]));
  const tasks = [...new Set(rows.map((r) => r[0]))];
  return [
    "## Задача -> что брать", "",
    "| Задача | Позиция |", "|---|---|",
    ...tasks.map((t) => `| ${t} | ${rows.filter((r) => r[0] === t).map((r) => r[1]).join(", ")} |`), "",
    "```mermaid", "flowchart LR",
    ...rows.map(([t, n], i) => `  T${tasks.indexOf(t)}["${t.replace(/"/g, "'")}"] --> P${i}["${n.replace(/"/g, "'")}"]`),
    "```", "",
    `Текстом: ${tasks.map((t) => `для задачи "${t}" подходит ${rows.filter((r) => r[0] === t).map((r) => r[1]).join(" или ")}`).join("; ")}.`, "",
  ];
}

function orderFlow(input: KbInput): string[] {
  const steps = ["Заявка", "Подбор", validPrices(input).length ? "Расчет объема и стоимости" : "Расчет", lines(input.deliveryRules).length ? "Доставка" : "Отгрузка"];
  return [
    "## Порядок заказа", "",
    "```mermaid", "flowchart LR", `  ${steps.map((s, i) => `S${i}["${s}"]`).join(" --> ")}`, "```", "",
    `Текстом: ${steps.join(" -> ").toLowerCase()}. Способ связи - раздел "География и контакты".`, "",
  ];
}

function galleryBlock(input: KbInput): string[] {
  const imgs = clientImages(input).slice(0, 12);
  if (!imgs.length) return [];
  const names = validPrices(input);
  return ["## Фото с сайта компании", "",
    ...imgs.map((u) => { const p = names.find((x) => x.imageUrl === u); return `![${sanitizeText(p?.name || input.companyName)}](${u})`; }), ""];
}

function docFile(input: KbInput, d: KbDoc, allFacts: KbFact[]): string {
  const facts = allFacts.filter((f) => f.doc === d.slug);
  const name = sanitizeText(input.companyName);
  const out: string[] = [`# ${sanitizeText(d.title)}`, ""];
  const isProof = PROOF_DOC.test(d.slug);
  const hasConfirmedProof = facts.some((f) => f.status === "confirmed");
  if (isProof && !hasConfirmedProof) {
    out.push(`На сайте ${hostOf(input.site)} не опубликованы номера документов, сертификатов или протоколов по этой теме. Сведения уточняются у компании.`, "");
    out.push("---", "", `Дата обновления: ${input.checkedAt}`, `Страница сайта: ${mdLink(sanitizeText(d.title), d.sitePage || input.site, `${name} - ${sanitizeText(d.title)}`)}`);
    return out.join("\n") + "\n";
  }
  const noTasks = /selection/.test(d.slug) && !validPrices(input).some((p) => p.useCases.trim());
  if (noTasks && validPrices(input).length)
    out.push(`${validPrices(input).map((p) => priceLine(input, p)).join("; ")}. Назначение уточняется у компании или на странице товара.`, "");
  else out.push(stripFiller(sanitizeText(d.directAnswer)) || "Прямой ответ требует уточнения у компании.", "");
  out.push(`Задача документа: ${stripFiller(sanitizeText(d.task))}.`, "");
  if (/geography/.test(d.slug) && input.contacts) out.push(...contactsBlock(input));
  if (/geography|delivery/.test(d.slug) && lines(input.deliveryRules).length) out.push("## Доставка", "", ...lines(input.deliveryRules).map((r) => `- ${r}`), "");
  if (/company-profile|company\/profile/.test(d.slug)) {
    const extra: string[] = [];
    if (input.legalName) extra.push(`- Юридическое лицо: ${sanitizeText(input.legalName)}`);
    if (input.inn) extra.push(`- ИНН: ${sanitizeText(input.inn)}`);
    if (input.ogrn) extra.push(`- ОГРН: ${sanitizeText(input.ogrn)}`);
    const ms = marketSince(input);
    if (ms) extra.push(`- ${ms[0].toUpperCase()}${ms.slice(1)}`);
    const ps = lines(input.productsServices);
    if (ps.length) { extra.push("- Продукты и услуги:"); ps.forEach((p) => extra.push(`  - ${p}`)); }
    if (extra.length) out.push("## Сведения о компании", "", ...extra, "");
  }
  if (/what-is|catalog\/offers/.test(d.slug)) out.push(...priceTable(input));
  if (/what-is|catalog\/offers/.test(d.slug)) {
    const ps = lines(input.productsServices);
    if (ps.length) out.push("## Типы продукции и услуг", "", ...ps.map((p) => `- ${p}`), "");
    out.push(...galleryBlock(input));
  }
  if (/selection/.test(d.slug)) out.push(...selectionBlock(input), ...priceTable(input));
  if (/manufactur|service-flow|order/.test(d.slug)) {
    out.push(...orderFlow(input));
    const calc = lines(input.calculationNotes);
    if (calc.length) out.push("## Расчет объема", "", ...calc.map((c) => `- ${c}`), "");
  }
  if (/faq/.test(d.slug)) {
    const qs = validQueries(input);
    if (qs.length) out.push("## Вопросы и ответы", "", ...qs.flatMap((q) => [`### ${sanitizeText(q.query)}`, "", faqAnswer(input, q), ""]));
  }
  if (facts.length) {
    out.push("## Проверяемые сведения", "");
    for (const f of facts) {
      const param = f.parameter && f.topic !== "price" ? ` (${f.parameter}${f.value ? `: ${f.value}` : ""}${f.unit ? ` ${f.unit}` : ""})` : "";
      const mark = f.status === "confirmed" ? "" : " [требует уточнения]";
      out.push(`- ${stripFiller(sanitizeText(f.statement))}${param}${mark}. Источник: ${mdLink(hostOf(f.source_url), f.source_url, `${name} - ${hostOf(f.source_url)}`)} (${f.id})`);
    }
    out.push("");
  }
  if (facts.some((f) => f.topic === "parameter" || f.standard)) {
    out.push("## Применимость", "", "Параметры действуют в пределах, указанных на странице-источнике.", "");
  }
  if (validPrices(input).length || facts.some((f) => f.topic === "price")) out.push(PRICE_NOTE(input.site, input.checkedAt), "");
  out.push("---", "");
  out.push(`Дата обновления: ${input.checkedAt}`);
  out.push(`Ответственный: ${sanitizeText(input.owner) || "требует уточнения"}`);
  out.push(`Страница сайта: ${mdLink(sanitizeText(d.title), d.sitePage || input.site, `${name} - ${sanitizeText(d.title)}`)}`);
  out.push(`Каноника: ${repoLinks(input).repoUrl}/blob/main/docs/${d.slug}.md`);
  const srcs = [...new Set(facts.map((f) => f.source_url))];
  out.push(`Первоисточники: ${srcs.length ? srcs.join(", ") : "требуют уточнения"}`);
  return out.join("\n") + "\n";
}

const Q_STOP = new Set("сколько стоит стоимость цена цены почем прайс купить заказать где кто какой какая какое какие выбрать лучше нужно надо можно доставка доставкой доставки доставку объект объекта городе город куба кубов кубометр тонну тонны тонн метр метра рублей руб цене ценам".split(" "));
/** Meaningful words of a question (object), excluding generic question words, city and company name. Niche-agnostic. */
function objectWords(input: KbInput, text: string): string[] {
  const ctx = `${input.city || ""} ${input.companyName || ""}`.toLowerCase().replace(/ё/g, "е");
  const ctxW = ctx.split(/[^a-zа-я0-9]+/).filter((w) => w.length >= 3);
  return text.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9-]+/)
    .filter((w) => w.length >= 4 && !Q_STOP.has(w) && !ctxW.some((c) => c.slice(0, 4) === w.slice(0, 4)));
}
const sharedPrefix = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
/** Word-form tolerant overlap: common prefix >= 3 and >= 60% of the shorter word. */
function matchesObject(hay: string, objs: string[]): boolean {
  const ws = hay.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9-]+/).filter((w) => w.length >= 3);
  return objs.some((o) => ws.some((w) => { const n = sharedPrefix(o, w); return n >= 3 && n >= 0.6 * Math.min(o.length, w.length); }));
}

const PRICE_Q = /цен|стоим|сколько|почем|прайс/i;
const DELIV_Q = /достав|привез|самовывоз/i;
const WHERE_Q = /где (купить|заказать|взять)|купить|заказать|контакт|телефон/i;
const CHOOSE_Q = /какой|какую|какое|выбрать|подобрать|для чего|подходит/i;
const CALC_Q = /рассчит|расчет|посчит|сколько (нужно|надо|куб|тонн)|объем/i;

const priceLine = (input: KbInput, p: KbPrice) =>
  `${sanitizeText(p.name)} от ${firstNumber(p.priceFrom)} ${sanitizeText(p.currency || "руб")}${p.unit ? `/${sanitizeText(p.unit)}` : ""}${p.zone ? ` (${sanitizeText(p.zone)})` : ""}`;

export type FaqIntent = "entity.find" | "offer.price" | "calc.volume" | "offer.delivery" | "offer.select" | "fallback";
/** Niche-agnostic FAQ router: first match wins. Signals are generic Russian question words only. */
export function faqIntent(query: string): FaqIntent {
  const t = ` ${query.toLowerCase().replace(/ё/g, "е")} `;
  const price = /сколько стоит|какая цена|\bцен[аыуе]?\b|почем|стоимост/.test(t);
  const deliv = /достав/.test(t);
  const delivCost = deliv && (/от чего зависит/.test(t) || /(тариф|стоимост\S*|цен\S*)\s+(\S+\s+)?достав/.test(t) || /достав\S*\s+(стоит|считается|рассчитыва)/.test(t));
  if (/\sгде\s|\sкто\s|куп(ить|лю)|заказать|какие компании/.test(t) && !price) return "entity.find";
  if (delivCost) return "offer.delivery"; // "стоимость доставки" must not fall into offer.price
  if (price) return "offer.price";
  if (/рассчит|расчет|посчит|сколько\s+(\S+\s+)?(кубов|куба|м3|тонн|тонны)|сколько нужно|объем/.test(t)) return "calc.volume";
  if (deliv) return "offer.delivery";
  if (/какой|какая|какое|какие|выбрать|подобрать|что лучше|\sдля\s/.test(t)) return "offer.select";
  return "fallback";
}

export function faqAnswer(input: KbInput, q: KbQuery): string {
  const text = q.query.toLowerCase();
  const qs = stems(text);
  const ps = validPrices(input);
  const priceNote = `Ориентир на дату проверки ${input.checkedAt}, не оферта. Вне зоны уточнять у компании.`;
  const intent = faqIntent(q.query);
  const deliv = () => {
    const r = lines(input.deliveryRules);
    return r.length ? `${r.slice(0, 3).join(". ")}. Условия уточнить у компании.` : "Стоимость доставки считается от адреса и объема. Уточнить у компании.";
  };
  // A. where / who / buy, without a price question
  if (intent === "entity.find") {
    const c = input.contacts;
    const phones = [c?.phoneSales, c?.phoneSupport].flatMap((v) => String(v ?? "").split(/[,;\n]+/)).map(sanitizeText).filter(Boolean);
    const objs = objectWords(input, text);
    const page = ps.find((p) => p.pageUrl && objs.length && matchesObject(`${p.name} ${p.category}`, objs))?.pageUrl;
    const parts = [sanitizeText(input.companyName), input.city && !(c?.address || "").includes(input.city) && `г. ${sanitizeText(input.city)}`, c?.address && sanitizeText(c.address), phones.length && `тел. ${phones.join(", ")}`, page || input.contactsPage || input.site].filter(Boolean);
    return `${parts.join(", ")}.`;
  }
  // D (explicit). delivery cost / tariff
  // B. price of the object named in the question
  if (intent === "offer.price") {
    const objs = objectWords(input, text);
    const hit = objs.length ? ps.filter((p) => matchesObject(`${p.name} ${p.category}`, objs)) : ps;
    if (hit.length) return `${hit.slice(0, 6).map((p) => priceLine(input, p)).join("; ")}. ${priceNote}`;
    return "Цена не указана, уточнить у компании.";
  }
  // C. calculation: only formula, no prices
  if (intent === "calc.volume") {
    const r = lines(input.calculationNotes);
    return r.length ? `${r.slice(0, 3).join(". ")}. Это ориентир, точный объем уточнить у компании.`
      : "Объем = длина × ширина × толщина (для ленты: длина × ширина × высота), запас 5-10%. Это ориентир, точный объем уточнить у компании.";
  }
  // D. delivery
  if (intent === "offer.delivery") return deliv();
  // E. choose: only from client's tasks column
  if (intent === "offer.select") {
    const rows = ps.filter((p) => p.useCases.trim()).flatMap((p) => p.useCases.split(/[;,]\s*/).filter(Boolean).map((u) => ({ u, p })));
    const byTask = rows.filter((r) => stems(r.u).some((w) => qs.includes(w)));
    const m = (byTask.length ? byTask : rows.filter((r) => stems(r.p.name).some((w) => qs.includes(w)))).slice(0, 4);
    if (m.length) return `${m.map((r) => `для задачи "${sanitizeText(r.u)}" - ${sanitizeText(r.p.name)}`).join("; ")}. Подбор уточнить у компании.`;
    return `Назначение не указано, уточнить у компании: ${input.contactsPage || input.site}.`;
  }
  const d = input.docs.find((x) => x.slug === q.doc);
  if (d && PROOF_DOC.test(d.slug)) return "Номера документов на сайте не опубликованы. Уточнить у компании.";
  const f = input.facts.filter((x) => x.status === "confirmed" && stems(x.statement).some((w) => qs.includes(w))).slice(0, 2);
  if (f.length) return f.map((x) => sanitizeText(x.statement).replace(/\.$/, "")).join(". ") + ".";
  return "Уточнить у компании.";
}

function priceSvg(input: KbInput): string {
  const ps = validPrices(input).map((p) => ({ ...p, n: Number(p.priceFrom.replace(/\s/g, "").replace(",", ".")) })).filter((p) => p.n > 0).slice(0, 12);
  const max = Math.max(...ps.map((p) => p.n));
  const rowH = 28, w = 640, labelW = 220, barW = w - labelW - 120;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const h = ps.length * rowH + 50;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="sans-serif" font-size="12">`,
    `<title>Цены "от" ${esc(sanitizeText(input.companyName))} - ориентир, не оферта</title>`,
    ...ps.map((p, i) => {
      const y = i * rowH + 10, bw = Math.max(2, Math.round((p.n / max) * barW));
      return `<text x="0" y="${y + 16}">${esc(sanitizeText(p.name).slice(0, 32))}</text><rect x="${labelW}" y="${y + 4}" width="${bw}" height="16" fill="#6E56CF"/><text x="${labelW + bw + 6}" y="${y + 16}">от ${esc(p.priceFrom)} ${esc(p.currency || "руб")}${p.unit ? "/" + esc(p.unit) : ""}</text>`;
    }),
    `<text x="0" y="${h - 10}" fill="#666">Ориентир, не оферта. Проверено ${input.checkedAt}. Источник: ${esc(input.priceSource || input.site)}</text>`,
    "</svg>",
  ].join("\n") + "\n";
}

export function buildKnowledgeBase(raw: KbInput): Record<string, string> {
  // Primary = form + price file (confirmed). Secondary = site parser: always needs_confirmation, never in README/llms/lead paragraphs.
  const input: KbInput = { ...raw, docs: contractDocs(raw), facts: raw.facts.map((f) => ({ ...f, status: "needs_confirmation" as const })) };
  const files: Record<string, string> = {};
  const site = input.site.replace(/\/+$/, "");
  const name = sanitizeText(input.companyName);
  const docFor = (topic: string) => {
    const find = (re: RegExp) => input.docs.find((d) => re.test(d.slug))?.slug || "";
    if (topic === "company") return find(/company\/profile/);
    if (topic === "contacts" || topic === "geography") return find(/geography/);
    if (topic === "price") return find(/selection/);
    return "";
  };
  const cf = clientFacts(input).map((f) => ({ ...f, doc: docFor(f.topic) }));
  // Site price facts whose number already exists in the client price list are merged (no contradicting duplicate).
  const priceNums = new Set(validPrices(input).map((p) => firstNumber(p.priceFrom)).filter(Boolean));
  const siteFacts = input.facts.filter((f) => !(f.topic === "price" && priceNums.size && (priceNums.has(firstNumber(f.value)) || priceNums.has(firstNumber(f.statement)))));
  const allFacts = [...cf, ...siteFacts];
  const confirmed = allFacts.filter((f) => f.status === "confirmed");
  const primary = new Set(cf.map((f) => f.id));
  const pending = allFacts.length - confirmed.length;
  const sections = [...new Set(input.docs.map((d) => d.slug.split("/")[0]))];
  const prices = validPrices(input);
  const imgs = clientImages(input);
  const ms = marketSince(input);
  const proofDocsEmpty = new Set(input.docs.filter((d) => PROOF_DOC.test(d.slug) && !allFacts.some((f) => f.doc === d.slug && f.status === "confirmed")).map((d) => d.slug));
  const products = lines(input.productsServices);
  const { repoUrl, rawLlms, siteLlms } = repoLinks(input);
  const allQ = validQueries(input);

  // README - first line: who, where, what, what the archive does not do
  const lead = `${name}${input.city ? `, ${sanitizeText(input.city)}` : ""}${products.length ? ` - ${products.slice(0, 4).join(", ").toLowerCase()}` : ""}. Архив - проверяемый справочник компании со ссылками на источники; не рейтинг, не сравнение с конкурентами и не гарантия цитирования ИИ.`;
  files["README.md"] = [
    `# ${name} - техническая база знаний`, "",
    lead, "",
    input.legalName ? `Юридическое лицо: ${sanitizeText(input.legalName)}` : "",
    input.inn ? `ИНН: ${sanitizeText(input.inn)}` : "",
    input.ogrn ? `ОГРН: ${sanitizeText(input.ogrn)}` : "",
    `Официальный сайт: ${site}`,
    `Репозиторий: ${repoUrl}`,
    `Город: ${sanitizeText(input.city) || "не опубликовано"}${input.region ? `, ${sanitizeText(input.region)}` : ""}`,
    input.geographyNote ? `География: ${sanitizeText(input.geographyNote)}` : "",
    ms ? `Компания ${ms}` : "", "",
    stripFiller(sanitizeText(input.description)), "",
    ...(products.length ? ["## Продукты и услуги", "", ...products.map((s) => `- ${s}`), ""] : []),
    ...(prices.length ? [...priceTable(input)] : []),
    "## Разделы", "",
    ...input.docs.map((d) => `- [${sanitizeText(d.title)}](docs/${d.slug}.md)`),
    "", "## Ключевые сведения", "",
    ...(cf.length ? cf.slice(0, 10).map((f) => `- ${sanitizeText(f.statement)} (${f.source_url})`) : ["- Сведения требуют подтверждения."]),
    "", "## Важно", "",
    "Репозиторий является дополнительной документацией и не заменяет сайт, каталог и страницы услуг.", "",
    "## Данные", "",
    "- data/facts.csv - реестр фактов",
    "- data/products.csv - продукты, цены от, фото с сайта",
    "- data/query-map.csv - карта связей запрос -> документ -> страница сайта",
    "- data/glossary.json, data/faq.json",
    ...(files["data/selection-matrix.csv"] !== undefined || prices.some((p) => p.useCases.trim()) ? ["- data/selection-matrix.csv - задача -> позиция (из прайса клиента)"] : []),
    ...(lines(input.calculationNotes).length ? ["- data/calc-examples.csv - примеры расчета от компании"] : []), "",
    "Факты из формы и прайса - confirmed (primary); факты, собранные с сайта, - needs_confirmation (secondary) и в README не выводятся.",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n") + "\n";

  // llms.txt
  const llms = [
    `# ${name}`, "",
    `> ${lead}`, "",
    ...(prices.length ? [PRICE_NOTE(site, input.checkedAt), ""] : []),
    "## Официальный сайт", "",
    `- ${mdLink("Главная", `${site}/`, `${name} - Главная`)}`,
    input.contactsPage ? `- ${mdLink("Контакты", input.contactsPage, `${name} - Контакты`)}` : "", "",
    "## Каноника", "",
    `- Сайт: ${site}`, `- llms.txt на сайте: ${siteLlms}`, `- Репозиторий: ${repoUrl}`, `- llms.txt в репозитории: ${rawLlms}`, "",
    "## Документация", "",
    ...input.docs.map((d) => `- [${sanitizeText(d.title)}](docs/${d.slug}.md): ${sanitizeText(d.task)}`), "",
    "## Данные", "",
    "- [Реестр фактов](data/facts.csv)",
    "- [Продукты и цены](data/products.csv)",
    "- [Карта связей](data/query-map.csv)",
    "- [FAQ](data/faq.json)",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n") + "\n";
  files["llms.txt"] = llms;
  files["site/llms.txt"] = llms;

  for (const d of input.docs) files[`docs/${d.slug}.md`] = docFile(input, d, allFacts);

  // data
  files["data/facts.csv"] = csv(
    ["fact_id", "source_type", "topic", "statement", "parameter", "unit", "value", "standard", "source_url", "status", "checked_at", "version", "doc"],
    allFacts.map((f) => [f.id, primary.has(f.id) ? "primary" : "secondary", f.topic, f.statement, f.parameter, f.unit, f.value, f.standard, f.source_url, f.status, input.checkedAt, "1.0", f.doc]),
  );
  const params = allFacts.filter((f) => f.topic === "parameter" || f.standard);
  if (params.length) files["data/technical-parameters.csv"] = csv(
    ["name", "type", "standard", "parameter", "unit", "value", "source_url", "checked_at", "status"],
    params.map((f) => [f.statement, f.topic, f.standard, f.parameter, f.unit, f.value, f.source_url, input.checkedAt, f.status]),
  );
  const imgSet = new Set(imgs);
  files["data/products.csv"] = csv(
    ["name", "category", "price_from", "currency", "unit", "zone", "use_cases", "page_url", "image_url"],
    prices.length
      ? prices.map((p) => [p.name, p.category, firstNumber(p.priceFrom), p.currency || "руб", p.unit, p.zone, p.useCases, p.pageUrl || input.priceSource || site, imgSet.has(p.imageUrl) ? p.imageUrl : ""])
      : products.map((p) => [p, "", "", "", "", "", "", site, ""]),
  );
  const withUses = prices.filter((p) => p.useCases.trim());
  if (withUses.length) files["data/selection-matrix.csv"] = csv(
    ["task", "product", "price_from", "unit", "page_url"],
    withUses.flatMap((p) => p.useCases.split(/[;,]\s*/).filter(Boolean).map((u) => [u, p.name, firstNumber(p.priceFrom), p.unit, p.pageUrl || site])),
  );
  if (lines(input.deliveryRules).length) files["data/delivery.csv"] = csv(
    ["rule", "source_url", "checked_at"], lines(input.deliveryRules).map((r) => [r, input.contactsPage || site, input.checkedAt]),
  );
  if (prices.length >= 3) files["assets/prices.svg"] = priceSvg(input);

  const sources = [...new Set(allFacts.map((f) => f.source_url).filter(Boolean))];
  files["data/source-register.csv"] = csv(
    ["source_id", "url", "host", "type", "checked_at", "status", "fact_owner", "facts_count"],
    sources.map((u, i) => {
      const fs = allFacts.filter((f) => f.source_url === u);
      const own = hostOf(u) === hostOf(site);
      return [`S-${String(i + 1).padStart(3, "0")}`, u, hostOf(u), own ? "company_site" : "external",
        input.checkedAt, fs.every((f) => f.status === "confirmed") ? "confirmed" : "needs_confirmation",
        own ? name : hostOf(u), String(fs.length)];
    }),
  );
  files["data/query-map.csv"] = csv(
    ["query", "github_doc", "site_page", "owner"],
    allQ.map((q) => [q.query, q.doc && !proofDocsEmpty.has(q.doc) ? `docs/${q.doc}.md` : "", q.sitePage || site, input.owner]),
  );
  const manual = effectiveGlossary(input)
    .map((t) => ({ term: sanitizeText(t.term), definition: stripFiller(sanitizeText(t.definition)), context: sanitizeText(t.context) }));
  files["data/glossary.json"] = JSON.stringify({ version: "1.0", checked_at: input.checkedAt, items: manual }, null, 2) + "\n";
  files["data/faq.json"] = JSON.stringify({
    version: "1.0", checked_at: input.checkedAt,
    items: allQ.map((q) => ({
      question: sanitizeText(q.query), intent: faqIntent(q.query), answer: faqAnswer(input, q),
      doc: q.doc && !proofDocsEmpty.has(q.doc) ? `docs/${q.doc}.md` : "", site_page: q.sitePage || site,
    })),
  }, null, 2) + "\n";

  files["sources/site-page-map.md"] = [
    `# Карта страниц ${hostOf(site)}`, "",
    "| Документ | Страница сайта | Приоритет |", "|---|---|---|",
    ...input.docs.map((d) => `| docs/${d.slug}.md | ${d.sitePage || "не указана"} | ${d.priority} |`),
  ].join("\n") + "\n";
  const stds = [...new Set(allFacts.map((f) => f.standard).filter(Boolean))];
  files["sources/standards-register.md"] = [
    "# Реестр стандартов", "",
    ...(stds.length ? stds.map((s) => `- ${sanitizeText(s)}: ${[...new Set(allFacts.filter((f) => f.standard === s).map((f) => f.source_url))].join(", ")}`) : ["На сайте не опубликованы номера стандартов."]),
  ].join("\n") + "\n";

  const optional = ["data/selection-matrix.csv", "data/calc-examples.csv"].filter((f) => files[f] || (f.includes("calc") && lines(input.calculationNotes).length));
  files["CHANGELOG.md"] = `# История изменений\n\n## 1.1 - ${input.checkedAt}\n\n- ${input.docs.length} документов, ${allFacts.length} фактов (подтверждено ${confirmed.length}), ${allQ.length} запросов, ${sources.length} источников.\n- Файлы: data/products.csv${optional.length ? ", " + optional.join(", ") : ""}.\n${prices.length ? `- Цены "от": ${prices.length} позиций, ориентир на ${input.checkedAt}.\n` : ""}`;
  files["CONTRIBUTING.md"] = [
    "# Регламент обновления", "",
    "1. Каждый новый факт добавляется в data/facts.csv с URL источника и датой проверки.",
    "2. Факт без подтверждения публикуется только с пометкой [требует уточнения].",
    "3. Цены публикуются только \"от\", как на сайте компании, с единицей, зоной и датой проверки; это ориентир, не оферта.",
    "4. Запрещены рейтинги, сравнения с конкурентами, отзывы и инструкции моделям.",
    "5. Один документ - одна задача, первый абзац - прямой ответ.",
    "6. Фото - только с домена компании. Стоковые и сгенерированные изображения запрещены.",
    "7. Проверка источников - не реже раза в квартал, изменения фиксируются в CHANGELOG.md.",
    `8. Ответственный: ${sanitizeText(input.owner) || "требует уточнения"}.`,
  ].join("\n") + "\n";
  files["LICENSE"] = input.license === "MIT"
    ? `MIT License\n\nCopyright (c) ${input.checkedAt.slice(0, 4)} ${name}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, subject to including this notice.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n`
    : `Creative Commons Attribution 4.0 International (CC BY 4.0)\n\nCopyright (c) ${input.checkedAt.slice(0, 4)} ${name}\n\nМатериалы можно использовать при указании источника: ${site}\nhttps://creativecommons.org/licenses/by/4.0/\n`;

  if (lines(input.calculationNotes).length) files["data/calc-examples.csv"] = csv(
    ["example", "source", "checked_at"], lines(input.calculationNotes).map((r) => [r, input.site, input.checkedAt]),
  );
  // Enforce output contract: drop everything not listed.
  for (const k of Object.keys(files)) if (!CONTRACT_ALWAYS.includes(k) && !CONTRACT_OPTIONAL.includes(k)) delete files[k];
  const v = validateKb(input);
  const faqItems = allQ.map((q) => faqAnswer(input, q));
  const blockers: string[] = [];
  if (prices.length && faqItems.some((a) => /цена на сайте не опубликована/i.test(a))) blockers.push("FAQ пишет \"цены нет\" при наличии прайса");
  const svcRows = input.queries.filter((q) => q.query.trim() && SERVICE_Q.test(q.query)).length;
  if (svcRows) blockers.push(`Служебные строки в запросах (исключены из query-map): ${svcRows}`);
  if (Object.keys(files).some((p) => p.startsWith("/"))) blockers.push("В архиве есть абсолютные пути");
  const pi = input.priceImport;
  if ((input.priceList?.length || pi?.rowsRead) && !prices.filter((p) => firstNumber(p.priceFrom)).length) blockers.push("Прайс дал 0 числовых цен при непустом вводе");
  if (pi) for (const e of pi.errors) if (!/чужого домена/.test(e)) blockers.push(e);
  if (prices.length && faqItems.some((a) => /^уточнить у компании\.?$/i.test(a.trim())) && allQ.some((q, i) => PRICE_Q.test(q.query.toLowerCase()) && /^уточнить/i.test(faqItems[i]))) blockers.push("FAQ про цену отвечает \"уточнить\" при наличии прайса");
  const hasC = !!(input.contacts && (input.contacts.address || input.contacts.phoneSales || input.contactsPage));
  if (hasC && confirmed.length === 0) blockers.push("confirmed = 0 при заполненных контактах");
  files["REPORT.md"] = [
    "# Отчет о подготовке базы знаний", "",
    `Дата: ${input.checkedAt}`, `Репозиторий: ${repoUrl}`, `llms.txt в репозитории: ${rawLlms}`,
    `Документов: ${input.docs.length} (разделы: ${sections.join(", ")})`,
    `Фактов всего: ${allFacts.length}`, `confirmed: ${confirmed.length}`, `needs_confirmation: ${pending}`,
    `Источников: ${sources.length}`, `Запросов в карте связей: ${allQ.length} (в faq.json: ${allQ.length})`,
    `Позиций с ценой "от": ${prices.filter((p) => firstNumber(p.priceFrom)).length}`, `Терминов в словаре: ${manual.length}`, `Фото с домена клиента: ${imgs.length}`,
    input.priceImport ? `Файл прайса ${input.priceImport.filename}: строк прочитано ${input.priceImport.rowsRead}, с числом ${input.priceImport.withPrice}, отброшено ${input.priceImport.dropped}, чужих фото отброшено ${input.priceImport.photosDropped}` : "",
    ...(input.priceImport?.errors || []).map((e) => `Прайс: ${e}`),
    proofDocsEmpty.size ? `Документы-заглушки (нет подтвержденных документов): ${[...proofDocsEmpty].join(", ")}` : "", "",
    "## Новые файлы", "", "- data/products.csv", ...optional.map((f) => `- ${f}`), "",
    "## Блокеры", "", ...(blockers.length ? blockers.map((b) => `- ${b}`) : ["Нет."]), "",
    "## Проверки", "", ...(v.ok ? ["Все проверки пройдены."] : v.issues.map((i) => `- ${i}`)), "",
    "## Размещение", "",
    `1. Создать публичный репозиторий ${repoUrl} и загрузить файлы архива (кроме папки site/).`,
    `2. Залить site/llms.txt на ${siteLlms}.`,
    "3. Создать на сайте раздел \"Техническая документация\" со ссылкой на репозиторий.",
    "4. Упоминание компании в ответах ИИ - измеряемый результат мониторинга, но не гарантированный результат работ.",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n") + "\n";

  return files;
}

/** Default thematic template. Admin edits it in step 2. */
export function defaultDocs(site: string): KbDoc[] {
  const s = site.replace(/\/+$/, "");
  const d = (slug: string, title: string, task: string, priority: "P1" | "P2"): KbDoc =>
    ({ slug, title, task, priority, sitePage: s, directAnswer: "" });
  return [
    d("company/profile", "Информация о компании", "реквизиты и деятельность", "P2"),
    d("company/geography", "География и контакты", "адрес, зона работы, способ связи", "P2"),
    d("catalog/offers", "Продукты и цены", "что предлагает компания, цены от", "P1"),
    d("catalog/selection", "Как подобрать", "позиции прайса и назначение по данным клиента", "P1"),
    d("service/order-flow", "Как заказать", "порядок заказа, что нужно от заказчика", "P1"),
    d("faq/faq", "Частые вопросы", "ответы на карту запросов", "P1"),
  ];
}

/** Output contract: legacy/edited slugs are mapped to the fixed document set; anything else is dropped. */
const CONTRACT_DOCS: Array<[RegExp, string]> = [
  [/company-profile|company\/profile/, "company/profile"],
  [/geograph/, "company/geography"],
  [/what-is|catalog\/offers|offers/, "catalog/offers"],
  [/selection/, "catalog/selection"],
  [/service-flow|order|manufactur/, "service/order-flow"],
  [/faq/, "faq/faq"],
];
export function contractDocs(input: KbInput): KbDoc[] {
  const defs = defaultDocs(input.site);
  const hasCatalog = validPrices(input).length > 0 || lines(input.productsServices).length > 0;
  return defs.filter((d) => hasCatalog || !/^catalog\//.test(d.slug)).map((def) => {
    const own = input.docs.find((x) => CONTRACT_DOCS.some(([re, slug]) => slug === def.slug && re.test(x.slug)));
    return own ? { ...own, slug: def.slug } : def;
  });
}
export const CONTRACT_ALWAYS = ["README.md", "llms.txt", "site/llms.txt", "docs/company/profile.md", "docs/company/geography.md", "docs/service/order-flow.md", "docs/faq/faq.md", "data/facts.csv", "data/products.csv", "data/query-map.csv", "data/faq.json", "data/glossary.json", "REPORT.md"];
export const CONTRACT_OPTIONAL = ["docs/catalog/offers.md", "docs/catalog/selection.md", "data/selection-matrix.csv", "data/calc-examples.csv"];

