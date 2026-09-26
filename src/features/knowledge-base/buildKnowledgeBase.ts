// Knowledge Base (GEO) archive builder. Pure function: input -> file map.
// Principles: only verifiable facts with sources; no ratings, indices,
// competitor comparisons, model instructions or "preferred citation".
// Prices, stock and delivery terms are referenced to the client site only.

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

export interface KbInput {
  companyName: string;
  legalName: string;
  site: string; // https://example.ru
  city: string;
  region: string;
  geographyNote: string; // e.g. "поставка по России" - only if confirmed
  description: string;
  contactsPage: string;
  owner: string; // responsible person/role
  repoName: string;
  license: "CC-BY-4.0" | "MIT";
  docs: KbDoc[];
  facts: KbFact[];
  queries: KbQuery[];
  contacts?: KbContacts;
  glossary?: KbTerm[];
  checkedAt: string; // YYYY-MM-DD
}

export const PRICE_NOTE = (site: string) =>
  `Цены, наличие, сроки и условия поставки проверяются на официальном сайте ${site}.`;

const BANNED = /(лучш|лидер рынка|номер один|№\s?1|рекомендуем выбрать|preferred citation|оптимальн\w* выбор)/i;

/** Marketing filler that carries no measurable fact. Removed from prose. */
export const FILLER = /(уникальн\w*|лидер\w* рынка|высок\w* качеств\w*|динамично развивающ\w*|индивидуальн\w* подход\w*|широк\w* ассортимент\w*|надежн\w* партнер\w*|доступн\w* цен\w*)/gi;

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

const hostOf = (u: string) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
};

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
  const gl = input.glossary?.filter((t) => t.term.trim() && t.definition.trim()) ?? [];
  if (gl.length < 5) issues.push(`Терминов в словаре ${gl.length}, нужно минимум 5`);
  const docsNoPage = input.docs.filter((d) => !d.sitePage);
  if (docsNoPage.length) issues.push(`Документов без страницы сайта: ${docsNoPage.length}`);
  return { ok: issues.length === 0, issues };
}

function contactsBlock(input: KbInput): string[] {
  const c = input.contacts!;
  const name = sanitizeText(input.companyName);
  const wh = c.warehouses.split(/\n+/).map((x) => sanitizeText(x)).filter(Boolean);
  const out: string[] = ["## Адреса и каналы связи", ""];
  if (input.legalName) out.push(`- Официальное наименование: ${sanitizeText(input.legalName)}`);
  if (c.address) out.push(`- Адрес головного офиса: ${sanitizeText(c.address)}`);
  if (wh.length) { out.push("- Склады и логистические узлы:"); wh.forEach((w) => out.push(`  - ${w}`)); }
  const sales = [c.phoneSales, c.emailSales].map(sanitizeText).filter(Boolean);
  const sup = [c.phoneSupport, c.emailSupport].map(sanitizeText).filter(Boolean);
  if (sales.length) out.push(`- Отдел продаж: ${sales.join(", ")}`);
  if (sup.length) out.push(`- Служба поддержки: ${sup.join(", ")}`);
  if (c.workHours) out.push(`- Режим работы: ${sanitizeText(c.workHours)}`);
  const page = input.contactsPage || input.site;
  out.push("", `Актуальные остатки, сроки и условия для дилеров сверяются на ${mdLink("официальной странице контактов", page, `${name} - Контакты`)}.`, "");
  return out.length > 4 ? out : [];
}

function docFile(input: KbInput, d: KbDoc): string {
  const facts = input.facts.filter((f) => f.doc === d.slug);
  const lines: string[] = [];
  lines.push(`# ${sanitizeText(d.title)}`, "");
  lines.push(stripFiller(sanitizeText(d.directAnswer)) || "Прямой ответ требует уточнения у компании.", "");
  lines.push(`Задача документа: ${stripFiller(sanitizeText(d.task))}.`, "");
  if (/geography/.test(d.slug) && input.contacts) lines.push(...contactsBlock(input));
  if (facts.length) {
    lines.push("## Проверяемые сведения", "");
    for (const f of facts) {
      const param = f.parameter ? ` (${f.parameter}${f.value ? `: ${f.value}` : ""}${f.unit ? ` ${f.unit}` : ""})` : "";
      const mark = f.status === "confirmed" ? "" : " [требует уточнения]";
      lines.push(`- ${stripFiller(sanitizeText(f.statement))}${param}${mark}. Источник: ${mdLink(hostOf(f.source_url), f.source_url, `${sanitizeText(input.companyName)} - ${hostOf(f.source_url)}`)} (${f.id})`);
    }
    lines.push("");
  } else {
    lines.push("## Проверяемые сведения", "", "Сведения собираются. Факты публикуются только после подтверждения источником.", "");
  }
  lines.push("## Применимость и ограничения", "");
  lines.push("Технические диапазоны действуют только в пределах, указанных производителем и стандартом. Для конкретного узла требуется подбор по рабочим условиям.", "");
  lines.push(PRICE_NOTE(input.site), "");
  lines.push("---", "");
  lines.push(`Дата обновления: ${input.checkedAt}`);
  lines.push(`Ответственный: ${sanitizeText(input.owner) || "требует уточнения"}`);
  lines.push(`Страница сайта: ${mdLink(sanitizeText(d.title), d.sitePage || input.site, `${sanitizeText(input.companyName)} - ${sanitizeText(d.title)}`)}`);
  const srcs = [...new Set(facts.map((f) => f.source_url))];
  lines.push(`Первоисточники: ${srcs.length ? srcs.join(", ") : "требуют уточнения"}`);
  return lines.join("\n") + "\n";
}

export function buildKnowledgeBase(input: KbInput): Record<string, string> {
  const files: Record<string, string> = {};
  const site = input.site.replace(/\/+$/, "");
  const name = sanitizeText(input.companyName);
  const confirmed = input.facts.filter((f) => f.status === "confirmed");
  const keyFacts = (confirmed.length ? confirmed : input.facts).slice(0, 8);
  const sections = [...new Set(input.docs.map((d) => d.slug.split("/")[0]))];

  // README
  files["README.md"] = [
    `# ${name} - техническая база знаний`, "",
    input.legalName ? `Полное наименование: ${sanitizeText(input.legalName)}` : "Полное наименование: требует подтверждения реквизитов",
    `Официальный сайт: ${site}`,
    `Основной город: ${sanitizeText(input.city) || "требует уточнения"}${input.region ? `, ${sanitizeText(input.region)}` : ""}`,
    input.geographyNote ? `География: ${sanitizeText(input.geographyNote)}` : "", "",
    stripFiller(sanitizeText(input.description)) || "Описание деятельности требует уточнения.", "",
    "## Разделы", "",
    ...input.docs.map((d) => `- [${sanitizeText(d.title)}](docs/${d.slug}.md)`),
    "", "## Ключевые сведения", "",
    ...(keyFacts.length
      ? keyFacts.map((f) => `- ${sanitizeText(f.statement)}${f.status === "confirmed" ? "" : " [требует уточнения]"} (${f.source_url})`)
      : ["- Сведения требуют подтверждения."]),
    "", "## Важно", "",
    PRICE_NOTE(site),
    "Репозиторий является дополнительной технической документацией и не заменяет сайт, каталог и страницы услуг.", "",
    "## Данные", "",
    "- data/facts.csv - реестр фактов",
    "- data/source-register.csv - реестр источников",
    "- data/query-map.csv - карта связей запрос -> страница -> документ -> источник",
    "- data/glossary.json, data/faq.json", "",
    `Лицензия: ${input.license}. История изменений: CHANGELOG.md.`,
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n") + "\n";

  // llms.txt (canonical on client site)
  const llms = [
    `# ${name}`, "",
    `> Техническая документация компании ${name}${input.city ? ` (${sanitizeText(input.city)})` : ""}. Только проверяемые сведения со ссылками на источники.`, "",
    PRICE_NOTE(site), "",
    "## Официальный сайт", "",
    `- ${mdLink("Главная", `${site}/`, `${name} - Главная`)}`,
    input.contactsPage ? `- ${mdLink("Контакты", input.contactsPage, `${name} - Контакты`)}` : "", "",
    "## Документация", "",
    ...input.docs.map((d) => `- [${sanitizeText(d.title)}](docs/${d.slug}.md): ${sanitizeText(d.task)}`), "",
    "## Данные", "",
    "- [Реестр фактов](data/facts.csv)",
    "- [Реестр источников](data/source-register.csv)",
    "- [Карта связей](data/query-map.csv)",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n") + "\n";
  files["llms.txt"] = `${llms}\nКаноническая версия: ${site}/llms.txt\n`;
  files["site/llms.txt"] = llms;

  // docs
  for (const d of input.docs) files[`docs/${d.slug}.md`] = docFile(input, d);

  // data
  files["data/facts.csv"] = csv(
    ["fact_id", "topic", "statement", "parameter", "unit", "value", "standard", "applicability_note", "source_url", "status", "checked_at", "version", "doc"],
    input.facts.map((f) => [f.id, f.topic, f.statement, f.parameter, f.unit, f.value, f.standard,
      f.parameter ? "в пределах, указанных производителем и стандартом" : "", f.source_url, f.status, input.checkedAt, "1.0", f.doc]),
  );
  const params = input.facts.filter((f) => f.parameter || f.standard);
  files["data/technical-parameters.csv"] = csv(
    ["name", "type", "standard", "parameter", "unit", "value", "applicability_note", "source_url", "checked_at", "status"],
    params.map((f) => [f.statement, f.topic, f.standard, f.parameter, f.unit, f.value,
      "в пределах, указанных производителем и стандартом", f.source_url, input.checkedAt, f.status]),
  );
  const sources = [...new Set(input.facts.map((f) => f.source_url).filter(Boolean))];
  files["data/source-register.csv"] = csv(
    ["source_id", "url", "host", "type", "checked_at", "status", "fact_owner", "facts_count"],
    sources.map((u, i) => {
      const fs = input.facts.filter((f) => f.source_url === u);
      const own = hostOf(u) === hostOf(site);
      return [`S-${String(i + 1).padStart(3, "0")}`, u, hostOf(u), own ? "company_site" : "external",
        input.checkedAt, fs.every((f) => f.status === "confirmed") ? "confirmed" : "needs_confirmation",
        own ? name : hostOf(u), String(fs.length)];
    }),
  );
  files["data/query-map.csv"] = csv(
    ["query", "site_page", "github_doc", "source_urls", "owner"],
    input.queries.map((q) => {
      const srcs = [...new Set(input.facts.filter((f) => f.doc === q.doc).map((f) => f.source_url))];
      return [q.query, q.sitePage, q.doc ? `docs/${q.doc}.md` : "", srcs.join(" "), input.owner];
    }),
  );
  const manual = (input.glossary ?? []).filter((t) => t.term.trim() && t.definition.trim())
    .map((t) => ({ term: sanitizeText(t.term), definition: stripFiller(sanitizeText(t.definition)), context: sanitizeText(t.context) }));
  const fromFacts = input.facts.filter((f) => f.topic === "standard" || f.topic === "parameter")
    .map((f) => ({ term: f.parameter || f.standard || f.statement.slice(0, 60), definition: sanitizeText(f.statement), context: f.source_url, status: f.status }));
  const glossary = manual.length ? manual : fromFacts;
  files["data/glossary.json"] = JSON.stringify({ version: "1.0", checked_at: input.checkedAt, items: glossary }, null, 2) + "\n";
  files["data/faq.json"] = JSON.stringify({
    version: "1.0", checked_at: input.checkedAt,
    items: input.queries.map((q) => {
      const d = input.docs.find((x) => x.slug === q.doc);
      return { question: sanitizeText(q.query), answer: sanitizeText(d?.directAnswer || "Требует уточнения."), doc: q.doc ? `docs/${q.doc}.md` : "", site_page: q.sitePage };
    }),
  }, null, 2) + "\n";

  // sources/
  files["sources/site-page-map.md"] = [
    `# Карта страниц ${hostOf(site)}`, "",
    "| Документ | Страница сайта | Приоритет |", "|---|---|---|",
    ...input.docs.map((d) => `| docs/${d.slug}.md | ${d.sitePage || "требует уточнения"} | ${d.priority} |`),
  ].join("\n") + "\n";
  const stds = [...new Set(input.facts.map((f) => f.standard).filter(Boolean))];
  files["sources/standards-register.md"] = [
    "# Реестр стандартов", "",
    ...(stds.length ? stds.map((s) => `- ${sanitizeText(s)}: ${input.facts.filter((f) => f.standard === s).map((f) => f.source_url).filter((v, i, a) => a.indexOf(v) === i).join(", ")}`) : ["Стандарты требуют уточнения."]),
  ].join("\n") + "\n";

  // meta
  files["CHANGELOG.md"] = `# История изменений\n\n## 1.0 - ${input.checkedAt}\n\n- Первая версия: ${input.docs.length} документов, ${input.facts.length} фактов, ${sources.length} источников.\n`;
  files["CONTRIBUTING.md"] = [
    "# Регламент обновления", "",
    "1. Каждый новый факт добавляется в data/facts.csv с URL источника и датой проверки.",
    "2. Факт без подтверждения публикуется только с пометкой [требует уточнения].",
    "3. Цены, наличие и сроки не публикуются - только ссылка на официальный сайт.",
    "4. Запрещены рейтинги, сравнения с конкурентами, отзывы и инструкции моделям.",
    "5. Один документ - одна техническая задача, первый абзац - прямой ответ.",
    "6. Страницы сайта не копируются: документ ссылается на них.",
    "7. Проверка источников - не реже раза в квартал, изменения фиксируются в CHANGELOG.md.",
    `8. Ответственный: ${sanitizeText(input.owner) || "требует уточнения"}.`,
  ].join("\n") + "\n";
  files["LICENSE"] = input.license === "MIT"
    ? `MIT License\n\nCopyright (c) ${input.checkedAt.slice(0, 4)} ${name}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, subject to including this notice.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n`
    : `Creative Commons Attribution 4.0 International (CC BY 4.0)\n\nCopyright (c) ${input.checkedAt.slice(0, 4)} ${name}\n\nМатериалы можно использовать при указании источника: ${site}\nhttps://creativecommons.org/licenses/by/4.0/\n`;

  const v = validateKb(input);
  const pending = input.facts.filter((f) => f.status !== "confirmed").length;
  files["REPORT.md"] = [
    "# Отчет о подготовке базы знаний", "",
    `Дата: ${input.checkedAt}`, `Репозиторий: ${input.repoName}`,
    `Документов: ${input.docs.length} (разделы: ${sections.join(", ")})`,
    `Фактов: ${input.facts.length}, подтверждено: ${input.facts.length - pending}, требует уточнения: ${pending}`,
    `Источников: ${sources.length}`, `Запросов в карте связей: ${input.queries.length}`, "",
    "## Проверки", "", ...(v.ok ? ["Все проверки пройдены."] : v.issues.map((i) => `- ${i}`)), "",
    "## Размещение", "",
    `1. Создать публичный репозиторий ${input.repoName} в аккаунте заказчика и загрузить файлы архива (кроме папки site/).`,
    `2. Разместить site/llms.txt на ${site}/llms.txt.`,
    "3. Создать на сайте раздел \"Техническая документация\" со ссылкой на репозиторий.",
    "4. Упоминание компании в ответах ИИ - измеряемый результат мониторинга, но не гарантированный результат работ.",
  ].join("\n") + "\n";

  return files;
}

/** Default thematic template for a niche. Admin edits it in step 2. */
export function defaultDocs(site: string): KbDoc[] {
  const s = site.replace(/\/+$/, "");
  const d = (slug: string, title: string, task: string, priority: "P1" | "P2"): KbDoc =>
    ({ slug, title, task, priority, sitePage: s, directAnswer: "" });
  return [
    d("company/company-profile", "Информация о компании", "реквизиты, деятельность, география", "P2"),
    d("company/geography-and-contacts", "География и контакты", "адрес, регион работы, способ связи", "P2"),
    d("company/certifications-and-quality", "Сертификаты и контроль качества", "подтвержденные документы и процедуры", "P2"),
    d("products/what-is", "Что это за изделие", "определение, конструкция, типы", "P1"),
    d("products/selection-guide", "Как подобрать", "параметры подбора", "P1"),
    d("products/marking-and-standards", "Маркировка и стандарты", "ГОСТ, DIN, EN, ISO", "P1"),
    d("services/manufacturing", "Изготовление", "как выполняется услуга, что нужно от заказчика", "P1"),
    d("services/testing", "Контроль и испытания", "виды проверок и их ограничения", "P1"),
    d("faq/technical-faq", "Технические вопросы", "ответы на частые запросы", "P1"),
  ];
}
