// Knowledge Base (GEO) archive builder. Pure function: input -> file map.
// Principles: only verifiable facts with sources; no ratings, indices,
// competitor comparisons, model instructions or "preferred citation".
// Prices are published only "from", exactly as the client publishes them,
// marked as a reference (not an offer) with the check date.

import { refFor, tasksOf, concreteUse, REF_NOTE } from "./kbReference";

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
  synonyms?: string; // optional, comma-separated, client-provided
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
export const SERVICE_Q = /→|->|docs\/|https?:|github_doc|\.md\b|когда вставишь|\bзамени(те)?\b|\bTODO\b|здесь будет|^\s*\(.*\)\s*$/i;
/** Generator service text that must never reach the archive. */
export const SERVICE_TEXT = /когда вставишь|\(\s*замени|\bзамените?\s+(на|url|ссылк)|\bTODO\b|здесь будет|\blorem\b/i;

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

const stems = (s: string) => s.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/i).filter((w) => w.length >= 4 || /\d/.test(w)).map((w) => w.slice(0, 3));

/** Client calc examples: "задача | формула | пример_вход | пример_выход | оговорка". Lines without "|" are ignored. */
export type CalcRow = { task: string; formula: string; input: string; output: string; caveat: string };
export const calcRows = (s?: string): CalcRow[] => String(s ?? "").split(/\n+/)
  .map((l) => l.split("|").map((x) => x.trim()))
  .filter((c) => c.length >= 2 && c[0] && c[1])
  .map(([task, formula, input = "", output = "", caveat = ""]) => ({ task, formula, input, output, caveat }));
/** Generic calc vocabulary: never counts as a match to a client task. */
const CALC_GENERIC = new Set(stems("рассчитать посчитать расчет объем сколько нужно надо кубов тонн метров площадь какой какая формула"));
function matchCalc(q: string, rows: CalcRow[]): CalcRow | undefined {
  const qs = new Set(stems(q).filter((x) => !CALC_GENERIC.has(x)));
  let best: CalcRow | undefined, n = 0;
  for (const r of rows) {
    const k = new Set(stems(r.task).filter((x) => !CALC_GENERIC.has(x))); let c = 0;
    k.forEach((x) => { if (qs.has(x)) c++; });
    if (c > n) { n = c; best = r; }
  }
  return best;
}
export const calcAnswer = (r: CalcRow) =>
  [`${sanitizeText(r.task)}: ${sanitizeText(r.formula)}.`,
   r.input || r.output ? `Пример: ${sanitizeText(r.input)}${r.output ? ` -> ${sanitizeText(r.output)}` : ""}.` : "",
   r.caveat ? `${sanitizeText(r.caveat).replace(/^./, (c) => c.toUpperCase())}.` : "Это ориентир, уточнить у компании."].filter(Boolean).join(" ").replace(/\.\./g, ".");

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
    .replace(/[ \t\u00a0]{2,}/g, " ")
    .trim();
}

/** Empty CSV cells are forbidden: an absent value is stated explicitly. */
export const EMPTY_CELL = "не указано на сайте";
const csvCell = (v: string) => {
  const s = sanitizeText(v) || EMPTY_CELL;
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
  // Requisites live on the contacts/requisites page, not on the home page.
  const req = input.contactsPage || input.site;
  if (input.legalName) add("company", `Юридическое лицо: ${input.legalName}`, "legal_name", input.legalName, req);
  if (input.inn) add("company", `ИНН ${input.inn}`, "inn", input.inn, req);
  if (input.ogrn) add("company", `ОГРН ${input.ogrn}`, "ogrn", input.ogrn, req);
  const ms = marketSince(input);
  if (ms) add("company", `Компания ${ms}`, "market_since", String(input.registeredAt || input.yearsOnMarket || ""), req);
  if (c?.address) add("contacts", `Адрес: ${c.address}`, "address", c.address);
  for (const w of lines(c?.warehouses).filter((w) => w.toLowerCase() !== sanitizeText(c?.address || "").toLowerCase())) add("geography", `Склад: ${w}`, "warehouse", w);
  const same = (a?: string, b?: string) => !!a && !!b && a.replace(/\D/g, "") === b.replace(/\D/g, "") && a.replace(/\D/g, "").length > 0 || (!!a && a.trim().toLowerCase() === (b || "").trim().toLowerCase());
  if (c?.phoneSales) add("contacts", `Телефон компании: ${c.phoneSales}`, "phone", c.phoneSales);
  if (c?.emailSales) add("contacts", `Почта компании: ${c.emailSales}`, "email", c.emailSales);
  if (c?.phoneSupport && !same(c.phoneSupport, c.phoneSales)) add("contacts", `Телефон поддержки: ${c.phoneSupport}`, "phone", c.phoneSupport);
  if (c?.emailSupport && !same(c.emailSupport, c.emailSales)) add("contacts", `Почта поддержки: ${c.emailSupport}`, "email", c.emailSupport);
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

/** Product group: reference group, rental by hourly unit, else category or first word. */
export function groupOf(p: KbPrice): string {
  const r = refFor(p.name);
  if (r) return r.group;
  if (/^ч(ас)?$/i.test(p.unit.trim()) || /аренд|самосвал|экскаватор|погрузчик/i.test(p.name)) return "аренда техники";
  if (/съемк|геодез|вынос|разбивоч|осадк|замер|подсчет объем/i.test(p.name)) return "геодезические работы";
  return (p.category.trim() || p.name.split(/\s+/)[0]).toLowerCase();
}

/** One line per group: "щебень от 1200 руб/м3". */
export function groupSummary(input: KbInput): string[] {
  const groups = new Map<string, KbPrice[]>();
  for (const p of validPrices(input)) { const g = groupOf(p); groups.set(g, [...(groups.get(g) || []), p]); }
  return [...groups.entries()].map(([g, ps]) => {
    const min = ps.reduce((a, b) => (Number(firstNumber(b.priceFrom).replace(",", ".")) < Number(firstNumber(a.priceFrom).replace(",", ".")) ? b : a));
    return `${g} (${ps.length} поз.) - от ${firstNumber(min.priceFrom)} ${sanitizeText(min.currency || "руб")}${min.unit && min.unit !== "-" ? `/${sanitizeText(min.unit)}` : ""}`;
  });
}

export interface SelRow { task: string; product: KbPrice; limit: string; basis: "client" | "reference" | "none" }
/** Task -> product rows: client tasks first, otherwise labelled general-practice reference. */
export function selectionRows(input: KbInput): SelRow[] {
  const out: SelRow[] = [];
  for (const p of validPrices(input)) {
    if (p.useCases.trim()) {
      for (const u of p.useCases.split(/[;,]\s*/).filter(Boolean)) out.push({ task: sanitizeText(u), product: p, limit: "не указано на сайте", basis: "client" });
      continue;
    }
    const r = refFor(p.name);
    if (r?.group === "бетон") {
      const use = concreteUse(p.name);
      if (use) { out.push({ task: use, product: p, limit: r.limit, basis: "reference" }); continue; }
    }
    if (r) { for (const t of r.tasks) out.push({ task: t, product: p, limit: r.limit, basis: "reference" }); continue; }
  }
  return out;
}

function selectionBlock(input: KbInput): string[] {
  const rows = selectionRows(input);
  const ps = validPrices(input);
  if (!ps.length) return [];
  const priceCell = (p: KbPrice) => `от ${firstNumber(p.priceFrom)} ${sanitizeText(p.currency || "руб")}${p.unit && p.unit !== "-" ? `/${sanitizeText(p.unit)}` : ""}`;
  const srcCell = (r: SelRow) => r.basis === "client" ? `прайс компании (${r.product.pageUrl || input.priceSource || input.site})` : "общая строительная практика";
  const covered = new Set(rows.map((r) => r.product.name));
  const rest = ps.filter((p) => !covered.has(p.name) && groupOf(p) !== "аренда техники" && groupOf(p) !== "геодезические работы");
  const tasks = [...new Set(rows.map((r) => r.task))];
  const hasRef = rows.some((r) => r.basis === "reference");
  const out: string[] = [
    "## Задача -> что брать", "",
    "| Задача | Что брать | Ограничение | Цена от | Источник |", "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.task} | ${sanitizeText(r.product.name)} | ${sanitizeText(r.limit)}${r.basis === "reference" ? ` (${REF_NOTE})` : ""} | ${priceCell(r.product)} | ${srcCell(r)} |`),
    ...rest.map((p) => `| на сайте не зафиксировано, уточнить | ${sanitizeText(p.name)} | на сайте не зафиксировано, уточнить | ${priceCell(p)} | прайс компании |`),
    "",
  ];
  if (hasRef) out.push(`Строки с источником "общая строительная практика" - ${REF_NOTE}. Окончательный выбор материала, класса и фракции подтверждает компания или проект.`, "");
  if (tasks.length) {
    const groupsByTask = tasks.map((t) => [t, [...new Set(rows.filter((r) => r.task === t).map((r) => sanitizeText(r.product.name)))]] as const);
    out.push("## Схема подбора", "", "```mermaid", "flowchart LR",
      ...groupsByTask.flatMap(([t, names], i) => names.slice(0, 4).map((n, j) => `  T${i}["${t.replace(/"/g, "'")}"] --> P${i}_${j}["${n.replace(/"/g, "'")}"]`)),
      "```", "",
      `Текстом: ${groupsByTask.map(([t, names]) => `для задачи "${t}" - ${names.slice(0, 4).join(" или ")}`).join("; ")}.`, "");
  }
  return out;
}

/** Fix glued path segments ("/contactscontacts/") and foreign hosts; never empty. */
export function cleanSiteUrl(input: KbInput, u?: string): string {
  const site = input.site.replace(/\/+$/, "");
  const raw = String(u ?? "").trim();
  if (!/^https?:\/\//.test(raw)) return `${site}/`;
  try {
    const url = new URL(raw);
    const h = hostOf(site);
    const x = url.hostname.replace(/^www\./, "");
    if (x !== h && !x.endsWith(`.${h}`)) return `${site}/`;
    url.pathname = url.pathname.split("/").map((seg) => { const m = seg.match(/^(.+)\1$/); return m && m[1].length >= 3 ? m[1] : seg; }).join("/");
    return url.toString();
  } catch { return `${site}/`; }
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
  const vp = validPrices(input);
  const groups = groupSummary(input);
  if (/selection/.test(d.slug) && vp.length) {
    const client = vp.filter((p) => p.useCases.trim()).length;
    out.push(client
      ? `Как выбрать материал под задачу: таблица ниже связывает задачу, позицию ${name}, ограничение и цену "от". Назначение указано компанией для ${client} из ${vp.length} позиций.`
      : `Как выбрать материал под задачу: таблица ниже связывает задачу, позицию ${name}, ограничение и цену "от". Компания не фиксирует назначение позиций на сайте, поэтому связки задача - материал даны как ${REF_NOTE}.`, "");
  } else if (/offers/.test(d.slug) && vp.length) {
    out.push(`${name}${input.city ? ` (${sanitizeText(input.city)})` : ""} поставляет: ${groups.join("; ")}. Полный перечень с ценами "от" - в разделе "Как подобрать".`, "");
  } else if (/delivery/.test(d.slug)) {
    const r = lines(input.deliveryRules);
    out.push(r.length ? `Доставка ${name}: ${r[0].replace(/\.$/, "")}.` : `Условия доставки (расчет стоимости, минимальный объем) на сайте не зафиксированы, уточнить у компании: ${input.contactsPage || input.site}.`, "");
  }
  else {
    const own = stripFiller(sanitizeText(d.directAnswer)).replace(/[^.]*\bобычно\s+(берут|выбирают|используют)[^.]*\.?/gi, "").trim();
    const c = input.contacts;
    const dirs = groups.map((g) => g.split(" (")[0]).join(", ");
    const fallback = /profile/.test(d.slug) ? `${sanitizeText(input.legalName) || name}${input.city ? `, ${sanitizeText(input.city)}` : ""}${dirs ? ` - ${dirs}` : ""}.`
      : /geography/.test(d.slug) ? `${name}${c?.address ? `: ${sanitizeText(c.address)}` : ""}${input.geographyNote ? `. Зона работы: ${sanitizeText(input.geographyNote)}` : ""}${c?.workHours ? `. Режим: ${sanitizeText(c.workHours)}` : ""}.`
      : /order/.test(d.slug) ? `Заказ в ${name}: заявка по телефону или через сайт ${input.site}, подбор позиции, расчет объема и стоимости, ${lines(input.deliveryRules).length ? "доставка" : "отгрузка"}.`
      : /faq/.test(d.slug) ? `Ответы на ${validQueries(input).length} частых вопросов о ${name}: где купить, сколько стоит, что выбрать, как рассчитать.`
      : `Сведения ${name} по теме "${sanitizeText(d.title)}" на сайте не зафиксированы, уточнить у компании.`;
    out.push(own || fallback, "");
  }
  out.push(`Задача документа: ${stripFiller(sanitizeText(d.task))}.`, "");
  if (/geography/.test(d.slug) && input.contacts) out.push(...contactsBlock(input));
  if (/delivery/.test(d.slug)) {
    const r = lines(input.deliveryRules);
    out.push("## Условия доставки", "", ...(r.length ? r.map((x) => `- ${x}`) : ["- Расчет стоимости: не зафиксировано на сайте, уточнить у компании.", "- Минимальный объем: не зафиксировано на сайте, уточнить у компании."]), "");
    out.push("## Зона работы", "", `- ${sanitizeText(input.geographyNote) || "не зафиксировано на сайте, уточнить у компании"}`, "");
    const trucks = vp.filter((p) => /самосвал|доставк|манипулятор/i.test(p.name));
    if (trucks.length) out.push("## Транспорт в прайсе", "", ...trucks.map((p) => `- ${priceLine(input, p)}`), "", PRICE_NOTE(input.site, input.checkedAt), "");
  }
  if (/company-profile|company\/profile/.test(d.slug)) {
    const extra: string[] = [];
    if (input.legalName) extra.push(`- Юридическое лицо: ${sanitizeText(input.legalName)}`);
    if (input.inn) extra.push(`- ИНН: ${sanitizeText(input.inn)}`);
    if (input.ogrn) extra.push(`- ОГРН: ${sanitizeText(input.ogrn)}`);
    const ms = marketSince(input);
    if (ms) extra.push(`- ${ms[0].toUpperCase()}${ms.slice(1)}`);
    if (groups.length) extra.push(`- Направления: ${groups.map((g) => g.split(" (")[0]).join(", ")}`);
    if (extra.length) out.push("## Сведения о компании", "", ...extra, "");
  }
  if (/what-is|catalog\/offers/.test(d.slug)) {
    if (groups.length) out.push("## Направления и цены \"от\"", "", ...groups.map((g) => `- ${g}`), "", PRICE_NOTE(input.site, input.checkedAt), "");
    const ps = lines(input.productsServices);
    if (ps.length) out.push("## Типы продукции и услуг", "", ...ps.map((p) => `- ${p}`), "");
    out.push(...galleryBlock(input));
  }
  if (/selection/.test(d.slug)) out.push(...selectionBlock(input), ...priceTable(input));
  if (/manufactur|service-flow|order/.test(d.slug)) {
    out.push(...orderFlow(input));
    const calc = calcRows(input.calculationNotes);
    if (calc.length) out.push("## Примеры расчета", "", ...calc.map((c) => `- ${calcAnswer(c)}`), "");
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
    .filter((w) => (w.length >= 4 || /\d/.test(w)) && !Q_STOP.has(w) && !ctxW.some((c) => c.slice(0, 4) === w.slice(0, 4)));
}
const sharedPrefix = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
/** Word-form tolerant overlap: common prefix >= 3 and >= 60% of the shorter word. */
export const priceHay = (p: KbPrice) => `${p.name} ${p.category} ${(p.synonyms || "").replace(/,/g, " ")}`;
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

export type FaqIntent = "entity.find" | "offer.price" | "offer.compare" | "calc.density" | "calc.volume" | "offer.delivery" | "offer.select" | "fallback";
/** Niche-agnostic FAQ router: first match wins. Signals are generic Russian question words only. */
export function faqIntent(query: string): FaqIntent {
  const t = ` ${query.toLowerCase().replace(/ё/g, "е")} `;
  const price = /сколько стоит|какая цена|\bцен[аыуе]?\b|почем|стоимост/.test(t);
  const deliv = /достав/.test(t);
  const delivCost = deliv && (/от чего зависит/.test(t) || /(тариф|стоимост\S*|цен\S*)\s+(\S+\s+)?достав/.test(t) || /достав\S*\s+(стоит|считается|рассчитыва)/.test(t));
  if (/\sгде\s|\sкто\s|куп(ить|лю)|заказать|какие компании/.test(t) && !price) return "entity.find";
  if (delivCost) return "offer.delivery"; // "стоимость доставки" must not fall into offer.price
  if (/тонн\S*.*\sкуб|куб\S*.*\sтонн|сколько весит|вес\S* (одного )?куба|насыпн\S* плотност/.test(t)) return "calc.density";
  if (/выгодн|дешевл|чем\s.*отлича|в чем разниц|разница между|отличается от/.test(t)) return "offer.compare";
  if (price) return "offer.price";
  // calc.volume: only when the question is about volume/quantity units or an explicit "calculate volume"
  if (/(рассчит|расчет|посчит)/.test(t) || /куб|тонн|объем|\bм3\b|\bметр/.test(t) && /сколько|нужно|надо/.test(t)) return "calc.volume";
  // offer.select: only an explicit choice verb/word, never a lone "для"
  if (/выбрать|подобрать|что лучше|какой|какая|какое|какие|какую|для чего|подходит|используют|нужен|нужна/.test(t)) return "offer.select";
  return "fallback";
}

const fmtN = (n: number) => String(n).replace(".", ",");

export function faqAnswer(input: KbInput, q: KbQuery): string {
  const text = q.query.toLowerCase();
  const qs = stems(text);
  const ps = validPrices(input);
  const priceNote = `Ориентир на дату проверки ${input.checkedAt}, не оферта. Вне зоны уточнять у компании.`;
  const intent = faqIntent(q.query);
  const objs = objectWords(input, text);
  /** Positions named in the question, ranked by distinctive words. */
  const named = (words: string[] = objs): KbPrice[] => {
    if (!words.length) return [];
    const distinct = ps.length > 1 ? words.filter((o) => !ps.every((p) => matchesObject(priceHay(p), [o]))) : objs;
    const use = distinct.length ? distinct : words;
    const scored = ps.map((p) => ({ p, n: use.filter((o) => matchesObject(priceHay(p), [o])).length }));
    const best = Math.max(0, ...scored.map((x) => x.n));
    return best ? scored.filter((x) => x.n === best).map((x) => x.p) : [];
  };
  /** Positions matching any object word (for "X, Y or Z" comparisons). */
  const anyNamed = (): KbPrice[] => objs.length ? ps.filter((p) => objs.some((o) => matchesObject(priceHay(p), [o]))) : [];
  const site = input.contactsPage || input.site;
  const deliv = () => {
    const r = lines(input.deliveryRules);
    return r.length ? `${r.slice(0, 3).join(". ")}. Условия уточнить у компании.` : `Стоимость доставки зависит от адреса и объема; тарифы на сайте не зафиксированы, уточнить у компании: ${site}.`;
  };
  // A. where / who / buy, without a price question
  if (intent === "entity.find") {
    const c = input.contacts;
    const phones = [c?.phoneSales, c?.phoneSupport].flatMap((v) => String(v ?? "").split(/[,;\n]+/)).map(sanitizeText).filter((v, i, a) => v && a.indexOf(v) === i);
    const hit = named().slice(0, 4);
    const page = hit.find((p) => p.pageUrl)?.pageUrl;
    const card = [c?.address ? `адрес: ${sanitizeText(c.address)}` : (input.city ? `г. ${sanitizeText(input.city)}` : ""), phones.length ? `тел. ${phones.join(", ")}` : "", c?.workHours ? `режим: ${sanitizeText(c.workHours)}` : "", `сайт: ${page || site}`].filter(Boolean).join("; ");
    const geo = input.geographyNote ? ` Зона работы: ${sanitizeText(input.geographyNote)}.` : "";
    let head = `${sanitizeText(input.companyName)}`;
    if (hit.length) head = `${hit.map((p) => sanitizeText(p.name)).join(", ")} - в ассортименте ${sanitizeText(input.companyName)}`;
    else if (groupSummary(input).length && /какие компании|кто /.test(text)) head = `${sanitizeText(input.companyName)} (${groupSummary(input).map((g) => g.split(" (")[0]).join(", ")})`;
    let use = "";
    if (/для чего|подходит|применя/.test(text) && hit.length) {
      const r = selectionRows(input).filter((x) => hit.some((h) => h.name === x.product.name));
      if (r.length) use = ` Применение: ${[...new Set(r.map((x) => x.task))].join(", ")}${r.some((x) => x.basis === "reference") ? ` (${REF_NOTE})` : ""}.`;
    }
    return `${head}. ${card[0].toUpperCase()}${card.slice(1)}.${geo}${use}`;
  }
  // B. price of the object named in the question
  if (intent === "offer.price") {
    const hit = !objs.length ? ps : named();
    if (hit.length) return `${hit.slice(0, 6).map((p) => priceLine(input, p)).join("; ")}. ${priceNote}`;
    return "Цена не указана, уточнить у компании.";
  }
  // B2. compare the named positions: prices + general-practice differences
  if (intent === "offer.compare") {
    const hit = anyNamed().sort((a, b) => Number(firstNumber(a.priceFrom).replace(",", ".")) - Number(firstNumber(b.priceFrom).replace(",", ".")));
    if (hit.length >= 2) {
      const diffs = hit.slice(0, 5).map((p) => { const r = refFor(p.name); return r ? `${sanitizeText(p.name)}: ${r.tasks.slice(0, 3).join(", ")}; ограничение - ${r.limit}` : ""; }).filter(Boolean);
      return `По прайсу ${sanitizeText(input.companyName)}: ${hit.slice(0, 5).map((p) => priceLine(input, p)).join("; ")}. Дешевле всего ${sanitizeText(hit[0].name).toLowerCase()}.${diffs.length ? ` Различия (${REF_NOTE}): ${diffs.join(". ")}.` : ""} ${priceNote}`;
    }
    if (hit.length === 1) return `В прайсе ${sanitizeText(input.companyName)} из названного есть ${priceLine(input, hit[0])}; остальное не зафиксировано, уточнить у компании. ${priceNote}`;
    return `Сравнение по данным компании не зафиксировано, уточнить у компании: ${site}.`;
  }
  // C0. tonnes per cubic metre: bulk density
  if (intent === "calc.density") {
    const pool = (anyNamed().length ? anyNamed() : ps).map((p) => ({ p, r: refFor(p.name) })).filter((x) => x.r?.density).slice(0, 6);
    if (pool.length) {
      const ex = pool[0];
      const [a, b] = ex.r!.density!;
      return `Тонны = объем (м3) × насыпная плотность (т/м3). Насыпная плотность (${REF_NOTE}): ${pool.map((x) => `${sanitizeText(x.p.name).toLowerCase()} ${fmtN(x.r!.density![0])}-${fmtN(x.r!.density![1])} т/м3`).join("; ")}. Пример: 10 м3 (${sanitizeText(ex.p.name).toLowerCase()}) ≈ ${fmtN(+(a * 10).toFixed(1))}-${fmtN(+(b * 10).toFixed(1))} т. Точный вес партии зависит от фракции и влажности, уточнить у компании.`;
    }
    return "Тонны = объем (м3) × насыпная плотность (т/м3). Плотность конкретного материала компания на сайте не зафиксировала, уточнить у компании.";
  }
  // C. calculation: formula + short example, no prices
  if (intent === "calc.volume") {
    const hit = matchCalc(q.query, calcRows(input.calculationNotes));
    if (hit) return calcAnswer(hit);
    if (/стяжк/.test(text)) return "Объем раствора или песка для стяжки (м3) = площадь пола (м2) × толщина стяжки (м). Пример: 20 м2 × 0,05 м = 1 м3, с запасом 5-10% ≈ 1,05-1,1 м3. Это ориентир, толщину задает проект.";
    return "Объем (м3) = длина × ширина × толщина слоя, плюс запас 5-10% на уплотнение. Пример: площадка 10 × 4 м, слой 0,15 м: 10 × 4 × 0,15 = 6 м3, с запасом ≈ 6,6 м3. Это ориентир, толщину слоя задает проект.";
  }
  // D. delivery
  if (intent === "offer.delivery") return deliv();
  // E. choose: client tasks first, then labelled general-practice reference
  if (intent === "offer.select") {
    const rowsAll = selectionRows(input);
    const client = rowsAll.filter((r) => r.basis === "client");
    if (client.length) {
      const byTask = client.filter((r) => stems(r.task).some((w) => qs.includes(w)));
      const m = (byTask.length ? byTask : client.filter((r) => stems(r.product.name).some((w) => qs.includes(w)))).slice(0, 4);
      if (m.length) return `${m.map((r) => `для задачи "${sanitizeText(r.task)}" - ${sanitizeText(r.product.name)}`).join("; ")}. Подбор уточнить у компании.`;
    }
    const tasks = tasksOf(text);
    const sc = named(objs.filter((o) => !tasksOf(o).length));
    const gHit = sc.filter((p) => objs.some((o) => matchesObject(groupOf(p), [o])));
    const scope = gHit.length ? gHit : sc;
    // the material named in the question narrows the pool; "бетон" as a task does not narrow to concrete itself
    const inScope = (r: SelRow) => !scope.length || scope.some((p) => p.name === r.product.name);
    let m = rowsAll.filter((r) => r.basis === "reference" && inScope(r) && tasks.some((t) => r.task.includes(t) || t.includes(r.task)));
    if (!m.length && tasks.length) m = rowsAll.filter((r) => r.basis === "reference" && tasks.some((t) => r.task.includes(t)));
    const uniq = [...new Map(m.map((r) => [r.product.name, r])).values()].slice(0, 4);
    if (uniq.length) return `Для задачи "${tasks.join(", ")}" по общей практике берут: ${uniq.map((r) => `${sanitizeText(r.product.name).toLowerCase()} (${priceLine(input, r.product).replace(/^.*? от /, "от ")}; ограничение - ${r.limit})`).join("; ")}. Это ${REF_NOTE}; подбор подтвердить у компании: ${site}.`;
    if (scope.length) {
      const refs = scope.map((p) => ({ p, r: refFor(p.name) })).filter((x) => x.r).slice(0, 4);
      if (refs.length) return `Выбор зависит от задачи. ${refs.map((x) => `${sanitizeText(x.p.name)}: ${x.r!.tasks.slice(0, 3).join(", ")}; ограничение - ${x.r!.limit}`).join(". ")}. Это ${REF_NOTE}; подбор подтвердить у компании: ${site}.`;
    }
    const items = (scope.length ? scope : ps).slice(0, 6).map((p) => sanitizeText(p.name));
    return `Какой вариант брать под эту задачу, на сайте не зафиксировано, уточнить у компании: ${site}.${items.length ? ` В ассортименте: ${items.join(", ")}.` : ""}`;
  }
  const d = input.docs.find((x) => x.slug === q.doc);
  if (d && PROOF_DOC.test(d.slug)) return "Номера документов на сайте не опубликованы. Уточнить у компании.";
  const f = clientFacts(input).filter((x) => x.status === "confirmed" && stems(x.statement).some((w) => qs.includes(w))).slice(0, 2);
  if (f.length) return f.map((x) => sanitizeText(x.statement).replace(/\.$/, "")).join(". ") + ".";
  return `На сайте не зафиксировано, уточнить у компании: ${site}.`;
}

/** Archive document that answers a given intent. Always an existing file. */
export function docForIntent(intent: FaqIntent, hasCatalog: boolean): string {
  if (intent === "entity.find") return "docs/company/geography.md";
  if (intent === "offer.delivery") return "docs/catalog/delivery.md";
  if (!hasCatalog) return "docs/faq/faq.md";
  if (intent === "offer.price") return "docs/catalog/selection.md";
  if (intent === "offer.select" || intent === "offer.compare" || intent === "calc.density" || intent === "calc.volume") return "docs/catalog/selection.md";
  return "docs/faq/faq.md";
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

/** Red only when a price question names a price-list position (distinctive token) and the answer still says "no price". */
export function priceAnswerBlockers(input: KbInput, faq: { query: string; answer: string }[]): string[] {
  const prices = validPrices(input);
  const out: string[] = [];
  for (const { query, answer } of faq) {
    if (faqIntent(query) !== "offer.price" || !/цена не указана|^уточнить/i.test(answer.trim())) continue;
    const objs = objectWords(input, query.toLowerCase());
    const distinct = prices.length > 1 ? objs.filter((o) => !prices.every((p) => matchesObject(priceHay(p), [o]))) : objs;
    if (distinct.length && prices.some((p) => matchesObject(priceHay(p), distinct))) out.push(`FAQ про цену отвечает "уточнить", хотя позиция есть в прайсе: "${query}"`);
  }
  return out;
}

export interface KbGate { blockers: string[]; faq: { query: string; intent: FaqIntent; answer: string }[] }
let lastGate: KbGate = { blockers: [], faq: [] };
/** Build + gate result. Red build = blockers.length > 0. */
export function buildKnowledgeBaseGated(raw: KbInput): { files: Record<string, string> } & KbGate {
  const files = buildKnowledgeBase(raw);
  return { files, ...lastGate };
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
  // One fact - one row: site facts repeating a form value (INN, OGRN, phone, e-mail, address) or each other are dropped.
  const keyOf = (s: string) => { const d = s.replace(/\D/g, ""); return d.length >= 6 ? `d:${d.slice(-10)}` : `t:${sanitizeText(s).toLowerCase().replace(/^[^:]*:\s*/, "")}`; };
  const known = new Set(cf.flatMap((f) => [keyOf(f.value || f.statement), keyOf(f.statement)]));
  const siteFacts = input.facts.filter((f) => !(f.topic === "price" && priceNums.size && (priceNums.has(firstNumber(f.value)) || priceNums.has(firstNumber(f.statement)))))
    .filter((f) => { const k = keyOf(f.value || f.statement); const k2 = keyOf(f.statement); if (known.has(k) || known.has(k2)) return false; known.add(k); known.add(k2); return true; });
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
  const groups = groupSummary(input);
  const what = groups.length ? groups.map((g) => g.split(" (")[0]).join(", ") : products.slice(0, 6).join(", ").toLowerCase();
  const lead = `${name}${input.city ? `, ${sanitizeText(input.city)}` : ""}${what ? ` - ${what}` : ""}. Архив - проверяемый справочник компании со ссылками на источники; не рейтинг, не сравнение с конкурентами и не гарантия цитирования ИИ.`;
  const c = input.contacts;
  const phonesAll = [c?.phoneSales, c?.phoneSupport].flatMap((v) => String(v ?? "").split(/[,;\n]+/)).map(sanitizeText).filter((v, i, a) => v && /\d/.test(v) && a.indexOf(v) === i);
  const contactLines = [
    c?.address ? `Адрес: ${sanitizeText(c.address)}` : "",
    phonesAll.length ? `Телефоны: ${phonesAll.join(", ")}` : "",
    c?.emailSales ? `Почта: ${sanitizeText(c.emailSales)}` : "",
    c?.workHours ? `Режим работы: ${sanitizeText(c.workHours)}` : "",
  ].filter(Boolean);
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
    ms ? `Компания ${ms}` : "",
    ...contactLines, "",
    stripFiller(sanitizeText(input.description)), "",
    ...(groups.length ? ["## Направления и цены \"от\"", "", ...groups.map((g) => `- ${g}`), "", PRICE_NOTE(site, input.checkedAt), "", "Полный перечень позиций и подбор под задачу - [Как подобрать](docs/catalog/selection.md).", ""] : []),
    ...(products.length ? ["## Продукты и услуги", "", ...products.map((s) => `- ${s}`), ""] : []),
    "## Разделы", "",
    ...input.docs.map((d) => `- [${sanitizeText(d.title)}](docs/${d.slug}.md)`),
    "", "## Ключевые сведения", "",
    ...(cf.filter((f) => f.topic !== "price").length ? cf.filter((f) => f.topic !== "price").slice(0, 12).map((f) => `- ${sanitizeText(f.statement)} (${f.source_url})`) : ["- Сведения требуют подтверждения."]),
    "", "## Важно", "",
    "Репозиторий является дополнительной документацией и не заменяет сайт, каталог и страницы услуг.", "",
    "## Данные", "",
    "- data/facts.csv - реестр фактов",
    "- data/products.csv - продукты, цены от, применение, страницы",
    "- data/query-map.csv - карта связей запрос -> документ -> страница сайта",
    "- data/selection-matrix.csv - задача -> позиция, ограничение, основание",
    "- data/glossary.json, data/faq.json",
    ...(calcRows(input.calculationNotes).length ? ["- data/calc-examples.csv - примеры расчета от компании"] : []), "",
    "Факты из формы и прайса - confirmed (primary); факты, собранные с сайта, - needs_confirmation (secondary) и в README не выводятся.",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n") + "\n";

  // llms.txt - one text for the repository and the site
  const llms = [
    `# ${name}`, "",
    `> ${lead}`, "",
    ...(contactLines.length || input.geographyNote ? ["## Компания", "",
      ...(input.legalName ? [`- Юридическое лицо: ${sanitizeText(input.legalName)}`] : []),
      ...(input.city ? [`- Город: ${sanitizeText(input.city)}`] : []),
      ...(input.geographyNote ? [`- Зона работы: ${sanitizeText(input.geographyNote)}`] : []),
      ...(ms ? [`- ${ms[0].toUpperCase()}${ms.slice(1)}`] : []),
      ...contactLines.map((l) => `- ${l}`), ""] : []),
    ...(groups.length ? ["## Что поставляет", "", ...groups.map((g) => `- ${g}`), "", PRICE_NOTE(site, input.checkedAt), ""] : []),
    "## Официальный сайт", "",
    `- ${mdLink("Главная", `${site}/`, `${name} - Главная`)}`,
    input.contactsPage ? `- ${mdLink("Контакты", input.contactsPage, `${name} - Контакты`)}` : "",
    input.priceSource ? `- ${mdLink("Цены", input.priceSource, `${name} - Цены`)}` : "", "",
    "## Каноника", "",
    `- Сайт: ${site}`, `- llms.txt на сайте: ${siteLlms}`, `- Репозиторий: ${repoUrl}`, `- llms.txt в репозитории: ${rawLlms}`, "",
    "## Документация", "",
    ...input.docs.map((d) => `- [${sanitizeText(d.title)}](${repoUrl}/blob/main/docs/${d.slug}.md): ${sanitizeText(d.task)}`), "",
    "## Данные", "",
    `- [Реестр фактов](${repoUrl}/blob/main/data/facts.csv)`,
    `- [Продукты и цены](${repoUrl}/blob/main/data/products.csv)`,
    `- [Подбор: задача -> материал](${repoUrl}/blob/main/data/selection-matrix.csv)`,
    `- [Карта связей](${repoUrl}/blob/main/data/query-map.csv)`,
    `- [FAQ](${repoUrl}/blob/main/data/faq.json)`, "",
    "Справочник со ссылками на источники; не рейтинг и не гарантия цитирования.",
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
  const selRows = selectionRows(input);
  const usesOf = (p: KbPrice) => {
    if (p.useCases.trim()) return p.useCases;
    const r = selRows.filter((x) => x.product.name === p.name);
    return r.length ? `${[...new Set(r.map((x) => x.task))].join("; ")} (${REF_NOTE})` : EMPTY_CELL;
  };
  files["data/products.csv"] = csv(
    ["name", "category", "price_from", "currency", "unit", "zone", "use_cases", "page_url", "image_url"],
    prices.length
      ? prices.map((p) => [p.name, p.category || groupOf(p), firstNumber(p.priceFrom), p.currency || "руб", p.unit, p.zone, usesOf(p), cleanSiteUrl(input, p.pageUrl || input.priceSource || site), imgSet.has(p.imageUrl) ? p.imageUrl : ""])
      : products.map((p) => [p, "", "", "", "", "", "", site, ""]),
  );
  if (selRows.length) files["data/selection-matrix.csv"] = csv(
    ["task", "product", "limit", "price_from", "unit", "basis", "page_url"],
    selRows.map((r) => [r.task, r.product.name, r.limit, firstNumber(r.product.priceFrom), r.product.unit, r.basis === "client" ? "прайс компании" : `общая практика: ${REF_NOTE}`, cleanSiteUrl(input, r.product.pageUrl || input.priceSource || site)]),
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
  // Query map: document by intent (always an existing file), live client page by object/intent.
  const hasCatalog = input.docs.some((d) => d.slug === "catalog/selection");
  const pageFor = (q: KbQuery): string => {
    const it = faqIntent(q.query);
    const objs = objectWords(input, q.query.toLowerCase());
    const prod = objs.length ? prices.find((p) => p.pageUrl && matchesObject(priceHay(p), objs)) : undefined;
    if (it === "entity.find" || it === "offer.delivery") return cleanSiteUrl(input, prod?.pageUrl || input.contactsPage || q.sitePage || site);
    if (it === "offer.price" || it === "offer.compare" || it === "offer.select" || it === "calc.density") return cleanSiteUrl(input, prod?.pageUrl || input.priceSource || q.sitePage || site);
    return cleanSiteUrl(input, q.sitePage || site);
  };
  const qRows = allQ.map((q) => ({ q, doc: docForIntent(faqIntent(q.query), hasCatalog), page: pageFor(q) }));
  files["data/query-map.csv"] = csv(
    ["query", "github_doc", "site_page", "owner"],
    qRows.map(({ q, doc, page }) => [q.query, doc, page, input.owner || name]),
  );
  const manual = effectiveGlossary(input)
    .map((t) => ({ term: sanitizeText(t.term), definition: stripFiller(sanitizeText(t.definition)), context: sanitizeText(t.context) }));
  files["data/glossary.json"] = JSON.stringify({ version: "1.0", checked_at: input.checkedAt, items: manual }, null, 2) + "\n";
  files["data/faq.json"] = JSON.stringify({
    version: "1.0", checked_at: input.checkedAt,
    items: qRows.map(({ q, doc, page }) => ({
      question: sanitizeText(q.query), intent: faqIntent(q.query), answer: faqAnswer(input, q),
      doc, site_page: page,
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

  const optional = ["data/selection-matrix.csv", "data/calc-examples.csv"].filter((f) => files[f] || (f.includes("calc") && calcRows(input.calculationNotes).length));
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

  if (calcRows(input.calculationNotes).length) files["data/calc-examples.csv"] = csv(
    ["task", "formula", "example_input", "example_output", "caveat", "source", "checked_at"],
    calcRows(input.calculationNotes).map((r) => [r.task, r.formula, r.input, r.output, r.caveat, input.site, input.checkedAt]),
  );
  // Enforce output contract: drop everything not listed.
  for (const k of Object.keys(files)) if (!CONTRACT_ALWAYS.includes(k) && !CONTRACT_OPTIONAL.includes(k)) delete files[k];
  const v = validateKb(input);
  // docs count is fixed by the contract; the legacy "7-10 documents" issue does not apply
  v.issues = v.issues.filter((i) => !/^Документов \d+, по ТЗ/.test(i));
  const faqItems = allQ.map((q) => faqAnswer(input, q));
  const blockers: string[] = [];
  if (prices.length && faqItems.some((a) => /цена на сайте не опубликована/i.test(a))) blockers.push("FAQ пишет \"цены нет\" при наличии прайса");
  // Service rows in the query list are excluded automatically and reported in "Проверки" (validateKb).
  // Every query-map row points to an existing archive file and a live client page.
  for (const r of qRows) {
    if (!files[r.doc]) blockers.push(`query-map ссылается на несуществующий файл ${r.doc}: "${r.q.query}"`);
    if (!r.page || cleanSiteUrl(input, r.page) !== r.page) blockers.push(`query-map: некорректная страница сайта "${r.page}"`);
  }
  for (const [path, text] of Object.entries(files)) {
    const bad = text.split("\n").find((l) => SERVICE_TEXT.test(l));
    if (bad) blockers.push(`Служебная строка генератора в ${path}: "${bad.trim().slice(0, 80)}"`);
  }
  const factKeys = new Map<string, string>();
  for (const f of allFacts) {
    const k = `${f.topic}|${f.topic === "price" ? f.parameter + "|" : ""}${(f.value || f.statement).toLowerCase().replace(/\s+/g, " ")}`;
    if (factKeys.has(k)) blockers.push(`Факт продублирован: ${factKeys.get(k)} и ${f.id}`);
    else factKeys.set(k, f.id);
  }
  if (Object.keys(files).some((p) => p.startsWith("/"))) blockers.push("В архиве есть абсолютные пути");
  const pi = input.priceImport;
  if ((input.priceList?.length || pi?.rowsRead) && !prices.filter((p) => firstNumber(p.priceFrom)).length) blockers.push("Прайс дал 0 числовых цен при непустом вводе");
  if (pi) for (const e of pi.errors) if (!/чужого домена/.test(e)) blockers.push(e);
  blockers.push(...priceAnswerBlockers(input, allQ.map((q, i) => ({ query: q.query, answer: faqItems[i] }))));
  const hasC = !!(input.contacts && (input.contacts.address || input.contacts.phoneSales || input.contactsPage));
  if (hasC && confirmed.length === 0) blockers.push("confirmed = 0 при заполненных контактах");
  if (!input.contacts?.phoneSales && !input.contacts?.phoneSupport && !input.contacts?.address && !input.contactsPage) blockers.push("Контакты пустые: entity.find не может дать карточку компании");
  // Generic gate checks (niche-agnostic)
  allQ.forEach((q, i) => {
    const it = faqIntent(q.query), a = faqItems[i];
    if (it === "entity.find" && /доставк\S*\s+(считается|стоит|рассчитыва)|тариф/i.test(a)) blockers.push(`find ответил текстом про доставку: "${q.query}"`);
    if (it === "offer.price") {
      const objs = objectWords(input, q.query.toLowerCase());
      const listed = prices.filter((p) => a.includes(`${sanitizeText(p.name)} от `));
      if (objs.length && listed.length && listed.some((p) => !matchesObject(priceHay(p), objs))) blockers.push(`price ответил чужой позицией: "${q.query}"`);
    }
  });
  if (!prices.some((p) => p.useCases.trim()) && /обычно берут/i.test(files["docs/catalog/selection.md"] || "")) blockers.push("selection.md содержит \"обычно берут\" при пустых задачах");
  const readmeGeo = (files["README.md"] || "").match(/^География: (.*)$/m)?.[1] || "";
  if (readmeGeo !== sanitizeText(input.geographyNote || "")) blockers.push("География README не совпадает с полем \"География\"");
  const addr = sanitizeText(input.contacts?.address || "").toLowerCase();
  if (addr && Object.values(files).some((t) => t.split("\n").some((l) => /склад/i.test(l) && l.toLowerCase().includes(addr)))) blockers.push("Склад совпадает с офисом");
  const dupAnswers = new Map<string, number>();
  faqItems.forEach((a) => dupAnswers.set(a, (dupAnswers.get(a) || 0) + 1));
  const dupCount = [...dupAnswers.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0);
  if (dupCount) v.issues.push(`Одинаковые ответы у разных вопросов: ${dupCount} (проверьте формулировки запросов)`);
  const nc = allFacts.filter((f) => f.status !== "confirmed");
  lastGate = { blockers, faq: allQ.map((q, i) => ({ query: q.query, intent: faqIntent(q.query), answer: faqItems[i] })) };
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
    "## Не подтвердилось", "", ...(nc.length ? [`Фактов со статусом needs_confirmation: ${nc.length} (собраны с сайта, требуют сверки по своему URL).`, ...nc.slice(0, 15).map((f) => `- ${f.id}: ${sanitizeText(f.statement).slice(0, 120)}`)] : ["Нет."]), "",
    "## Файлы архива", "", ...Object.keys(files).filter((f) => f !== "REPORT.md").sort().map((f) => `- ${f}`), "",
    "## Блокеры", "", ...(blockers.length ? blockers.map((b) => `- ${b}`) : ["Нет."]), "",
    "## Проверки", "", ...(!v.issues.length ? ["Все проверки пройдены."] : v.issues.map((i) => `- ${i}`)), "",
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
    d("catalog/delivery", "Доставка", "как считается доставка, минимальный объем, зоны", "P1"),
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
  [/deliver|достав/, "catalog/delivery"],
  [/service-flow|order|manufactur/, "service/order-flow"],
  [/faq/, "faq/faq"],
];
export function contractDocs(input: KbInput): KbDoc[] {
  const defs = defaultDocs(input.site);
  const hasCatalog = validPrices(input).length > 0 || lines(input.productsServices).length > 0;
  return defs.filter((d) => hasCatalog || !/^catalog\//.test(d.slug) || d.slug === "catalog/delivery").map((def) => {
    const own = input.docs.find((x) => CONTRACT_DOCS.some(([re, slug]) => slug === def.slug && re.test(x.slug)));
    return own ? { ...own, slug: def.slug } : def;
  });
}
export const CONTRACT_ALWAYS = ["README.md", "llms.txt", "site/llms.txt", "docs/company/profile.md", "docs/company/geography.md", "docs/catalog/delivery.md", "docs/service/order-flow.md", "docs/faq/faq.md", "data/facts.csv", "data/products.csv", "data/query-map.csv", "data/faq.json", "data/glossary.json", "CHANGELOG.md", "CONTRIBUTING.md", "LICENSE", "REPORT.md"];
export const CONTRACT_OPTIONAL = ["docs/catalog/offers.md", "docs/catalog/selection.md", "data/selection-matrix.csv", "data/calc-examples.csv"];

