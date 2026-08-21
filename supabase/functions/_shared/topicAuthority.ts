// ============================================================================
// P16 - TOPIC AUTHORITY ENGINE (rules layer)
//
//   SEMANTICS -> [TOPIC MAP] -> CONTENT PLAN -> WRITER -> SEO -> LINKS -> BUILD
//
// Pure + deterministic. No DB, no LLM, no HTML.
// Owns: keyword clustering, commercial <-> informational binding, topic map,
// article typing, article priority, authority scoring.
//
// Does NOT touch PDE, page_registry, Content Engine, SEO Engine,
// Commercial Engine, Build or QA.
// ============================================================================

export type ArticleType =
  | "supporting_article"
  | "expert_article"
  | "faq_article"
  | "comparison_article"
  | "guide_article"
  | "news_article";

export type PlanIntent = "informational" | "commercial" | "navigational" | "transactional";

export const ARTICLE_TYPES: ArticleType[] = [
  "supporting_article", "expert_article", "faq_article",
  "comparison_article", "guide_article", "news_article",
];

// ---------------------------------------------------------------------------
// text helpers (same normalisation family as siloUrl.entityKey)
// ---------------------------------------------------------------------------
const STOP = new Set([
  "и", "или", "для", "как", "что", "чем", "это", "the", "and", "for", "with",
  "of", "in", "on", "по", "от", "до", "из", "на", "в", "с", "у", "за", "при",
]);

export const norm = (v: unknown) =>
  String(v ?? "").toLowerCase().replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function tokens(v: unknown): string[] {
  return norm(v).split(" ").filter((w) => w.length > 2 && !STOP.has(w));
}

/** Crude RU/EN stem so "заклепки" == "заклепка" == "заклепок". */
export function stem(w: string): string {
  return w.replace(/(ями|ами|иями|ов|ев|ей|ий|ые|ая|ое|ую|ых|ам|ом|ах|ы|и|а|о|е|у|я|ь|s|es)$/u, "")
    .slice(0, 9);
}

export function stemSet(list: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of list) for (const w of tokens(s)) out.add(stem(w));
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / Math.min(a.size, b.size);
}

// ---------------------------------------------------------------------------
// 1. intent + article typing
// ---------------------------------------------------------------------------
const COMMERCIAL_MARKERS = [
  "купить", "цена", "стоимость", "заказать", "недорого", "дешево", "продажа",
  "доставка", "опт", "прайс", "买", "buy", "price", "order", "cheap", "sale", "cost",
];
const NAV_MARKERS = ["официальный сайт", "контакты", "личный кабинет", "login", "official site"];
const QUESTION_MARKERS = ["как", "почему", "зачем", "что такое", "какой", "какие", "чем", "сколько",
  "how", "why", "what", "which", "when"];
const COMPARE_MARKERS = ["или", "vs", "против", "отличие", "отличия", "отличаются", "сравнение",
  "лучше", "difference", "compare", "versus"];
const GUIDE_MARKERS = ["как выбрать", "инструкция", "руководство", "гайд", "пошагово",
  "how to", "guide", "step by step"];
const EXPERT_MARKERS = ["гост", "din", "iso", "стандарт", "требования", "расчет", "нормы",
  "standard", "requirements", "calculation"];
const NEWS_MARKERS = ["новост", "2026", "2027", "обзор рынка", "news", "trends"];

const hasAny = (s: string, list: string[]) => list.some((m) => s.includes(m));

export function classifyIntent(keyword: string): PlanIntent {
  const s = norm(keyword);
  if (hasAny(s, NAV_MARKERS)) return "navigational";
  if (hasAny(s, COMMERCIAL_MARKERS)) return "commercial";
  return "informational";
}

export function isInformational(keyword: string): boolean {
  return classifyIntent(keyword) === "informational";
}

export function detectArticleType(text: string): ArticleType {
  const s = norm(text);
  if (hasAny(s, NEWS_MARKERS)) return "news_article";
  if (hasAny(s, COMPARE_MARKERS)) return "comparison_article";
  if (hasAny(s, GUIDE_MARKERS)) return "guide_article";
  if (hasAny(s, EXPERT_MARKERS)) return "expert_article";
  if (hasAny(s, QUESTION_MARKERS)) return "faq_article";
  return "supporting_article";
}

// ---------------------------------------------------------------------------
// 6. structure per article type (the writer must follow it)
// ---------------------------------------------------------------------------
export const ARTICLE_STRUCTURE: Record<ArticleType, { ru: string[]; en: string[]; rules: { ru: string; en: string } }> = {
  guide_article: {
    ru: ["Введение", "Как выбрать", "Основные критерии", "Ошибки при выборе", "FAQ", "Что делать дальше"],
    en: ["Intro", "How to choose", "Key criteria", "Common mistakes", "FAQ", "Next step"],
    rules: {
      ru: "Практическое руководство. Каждый критерий - отдельный H2, внутри 2-4 H3. В конце блок с призывом перейти на коммерческую страницу.",
      en: "Practical guide. One H2 per criterion with 2-4 H3 inside. End with a CTA to a commercial page.",
    },
  },
  comparison_article: {
    ru: ["Введение", "Что сравниваем", "Таблица сравнения", "Когда что выбрать", "Ошибки", "FAQ"],
    en: ["Intro", "What we compare", "Comparison table", "When to pick which", "Mistakes", "FAQ"],
    rules: {
      ru: "ОБЯЗАТЕЛЬНА markdown-таблица сравнения минимум 4 строки и 3 колонки. Без выдуманных цифр: если параметра нет в данных - пиши 'уточняется'.",
      en: "A markdown comparison table with at least 4 rows and 3 columns is MANDATORY. Never invent numbers.",
    },
  },
  faq_article: {
    ru: ["Короткий ответ", "Развернутое объяснение", "Частые вопросы", "Итог"],
    en: ["Short answer", "Detailed explanation", "Common questions", "Summary"],
    rules: {
      ru: "Формат вопрос-ответ под низкочастотные запросы. Первый абзац - прямой ответ в 2-3 предложения.",
      en: "Question-answer format for long-tail queries. First paragraph is a direct 2-3 sentence answer.",
    },
  },
  expert_article: {
    ru: ["Введение", "Практика и опыт", "Разбор деталей", "Практические советы", "Примеры", "FAQ"],
    en: ["Intro", "Practice and experience", "Details", "Practical tips", "Examples", "FAQ"],
    rules: {
      ru: "Обязательны: опыт компании из профиля, практические советы, минимум 2 разобранных примера ситуаций. Опыт брать только из данных профиля.",
      en: "Mandatory: company experience from the profile, practical tips, at least 2 worked examples. Experience only from profile data.",
    },
  },
  supporting_article: {
    ru: ["Введение", "Разбор темы", "Что учитывать", "Ошибки", "FAQ"],
    en: ["Intro", "Topic breakdown", "What to consider", "Mistakes", "FAQ"],
    rules: {
      ru: "Поддерживающая статья кластера. Раскрывает тему и ведет на коммерческие страницы кластера.",
      en: "Supporting cluster article. Explains the topic and routes to the cluster commercial pages.",
    },
  },
  news_article: {
    ru: ["Суть", "Контекст", "Что это меняет", "Итог"],
    en: ["Summary", "Context", "What changes", "Bottom line"],
    rules: {
      ru: "Без выдуманных дат, цифр и заявлений компаний. Только общий отраслевой контекст.",
      en: "No invented dates, numbers or company statements. Industry context only.",
    },
  },
};

// ---------------------------------------------------------------------------
// 2. topic map
// ---------------------------------------------------------------------------
export interface CommercialPage {
  registry_id: string;
  url_path: string;
  page_type: string;
  title: string;
  status: string;
  entity_id?: string | null;
  entity_type?: string | null;
  demand_score?: number | null;
  cluster_name?: string | null;
  silo_name?: string | null;
}

export interface KeywordRow {
  keyword: string;
  frequency?: number | null;
  intent?: string | null;
  site_cluster_id?: string | null;
  silo_id?: string | null;
}

export interface TopicClusterDraft {
  name: string;
  main_entity: string;
  commercial_pages: string[];   // registry ids
  commercial_paths: string[];
  keywords: string[];
  authority_score: number;
}

const COMMERCIAL_TYPES = new Set(["hub", "category", "product", "service", "local"]);

export function isCommercialPage(p: { page_type?: string | null; status?: string | null }): boolean {
  return COMMERCIAL_TYPES.has(String(p.page_type || "")) &&
    ["approved", "review"].includes(String(p.status || ""));
}

/**
 * Builds the topic map: every commercial cluster (hub / category) becomes one
 * topic cluster, products and services attach to the closest one, informational
 * keywords are distributed by stem overlap.
 */
export function buildTopicMap(
  pages: CommercialPage[],
  keywords: KeywordRow[],
): TopicClusterDraft[] {
  const commercial = pages.filter(isCommercialPage);
  const anchors = commercial.filter((p) => p.page_type === "hub" || p.page_type === "category");
  const leaves = commercial.filter((p) => p.page_type !== "hub" && p.page_type !== "category");

  const base = (anchors.length ? anchors : commercial).map((p) => ({
    page: p,
    key: stemSet([p.title || p.cluster_name || p.url_path]),
  }));
  if (!base.length) return [];

  const drafts = new Map<string, TopicClusterDraft & { keySet: Set<string> }>();
  for (const b of base) {
    const name = String(b.page.title || b.page.cluster_name || b.page.url_path).trim();
    const k = norm(name);
    const existing = drafts.get(k);
    if (existing) {
      existing.commercial_pages.push(b.page.registry_id);
      existing.commercial_paths.push(b.page.url_path);
      continue;
    }
    drafts.set(k, {
      name,
      main_entity: mainEntity(name),
      commercial_pages: [b.page.registry_id],
      commercial_paths: [b.page.url_path],
      keywords: [],
      authority_score: 0,
      keySet: b.key,
    });
  }

  const list = [...drafts.values()];
  const attach = (text: string, onHit: (d: typeof list[number]) => void) => {
    const s = stemSet([text]);
    let best: typeof list[number] | null = null;
    let bestScore = 0;
    for (const d of list) {
      const sc = overlap(s, d.keySet);
      if (sc > bestScore) { bestScore = sc; best = d; }
    }
    if (best && bestScore >= 0.34) onHit(best);
  };

  for (const leaf of leaves) {
    attach(leaf.title || leaf.url_path, (d) => {
      d.commercial_pages.push(leaf.registry_id);
      d.commercial_paths.push(leaf.url_path);
    });
  }

  for (const kw of keywords) {
    const word = String(kw.keyword || "").trim();
    if (!word) continue;
    attach(word, (d) => { if (!d.keywords.includes(word)) d.keywords.push(word); });
  }

  return list.map(({ keySet: _k, ...d }) => ({
    ...d,
    commercial_pages: [...new Set(d.commercial_pages)],
    commercial_paths: [...new Set(d.commercial_paths)],
    keywords: d.keywords.slice(0, 200),
    authority_score: clusterAuthorityScore({
      commercial_pages_count: new Set(d.commercial_pages).size,
      keywords_count: d.keywords.length,
      articles_count: 0,
      linked_articles: 0,
    }),
  })).sort((a, b) => b.commercial_pages.length - a.commercial_pages.length);
}

export function mainEntity(name: string): string {
  const t = tokens(name);
  return (t[0] || norm(name) || "").trim();
}

/** 0-100 topical authority of a cluster. */
export function clusterAuthorityScore(i: {
  commercial_pages_count: number;
  keywords_count: number;
  articles_count: number;
  linked_articles: number;
}): number {
  const pages = Math.min(1, i.commercial_pages_count / 6) * 20;
  const kws = Math.min(1, i.keywords_count / 40) * 20;
  const arts = Math.min(1, i.articles_count / 5) * 40;
  const links = i.articles_count ? (i.linked_articles / i.articles_count) * 20 : 0;
  return Math.round(pages + kws + arts + links);
}

// ---------------------------------------------------------------------------
// 4. automatic content plan
// ---------------------------------------------------------------------------
export interface PlanDraft {
  title: string;
  intent: PlanIntent;
  article_type: ArticleType;
  target_keywords: string[];
  linked_pages: string[];   // registry ids
  priority: number;
}

interface Tpl { type: ArticleType; ru: (e: string) => string; en: (e: string) => string }

const TEMPLATES: Tpl[] = [
  { type: "guide_article", ru: (e) => `Как выбрать ${e}`, en: (e) => `How to choose ${e}` },
  { type: "supporting_article", ru: (e) => `Какие бывают ${e}: виды и размеры`, en: (e) => `Types and sizes of ${e}` },
  { type: "comparison_article", ru: (e) => `${cap(e)}: сравнение материалов и исполнений`, en: (e) => `${cap(e)}: materials compared` },
  { type: "supporting_article", ru: (e) => `Типичные ошибки при работе с ${e}`, en: (e) => `Common mistakes with ${e}` },
  { type: "expert_article", ru: (e) => `Стандарты и требования к ${e}`, en: (e) => `Standards and requirements for ${e}` },
];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Genitive-ish RU form so titles read naturally ("заклепки" -> "заклепок"). */
function entityPhrase(cluster: TopicClusterDraft, ru: boolean): string {
  const name = String(cluster.name || cluster.main_entity || "").trim();
  return ru ? name.toLowerCase() : name.toLowerCase();
}

export function planTopicsForCluster(
  cluster: TopicClusterDraft,
  opts: { lang?: string; maxFaq?: number } = {},
): PlanDraft[] {
  const ru = String(opts.lang || "ru").toLowerCase() !== "en";
  const entity = entityPhrase(cluster, ru);
  if (!entity) return [];

  const infoKeywords = cluster.keywords.filter(isInformational);
  const out: PlanDraft[] = TEMPLATES.map((tpl, i) => ({
    title: (ru ? tpl.ru(entity) : tpl.en(entity)).trim(),
    intent: "informational" as PlanIntent,
    article_type: tpl.type,
    target_keywords: pickKeywords(infoKeywords, tpl.type, entity),
    linked_pages: cluster.commercial_pages.slice(0, 6),
    priority: 0,
  })).map((p, i) => ({ ...p, priority: articlePriority(p, cluster) - i }));

  // FAQ articles from real long-tail informational queries
  const maxFaq = opts.maxFaq ?? 2;
  const questions = infoKeywords
    .filter((k) => hasAny(norm(k), QUESTION_MARKERS) && norm(k).split(" ").length >= 3)
    .slice(0, maxFaq);
  for (const q of questions) {
    const title = cap(q.trim());
    if (out.some((o) => norm(o.title) === norm(title))) continue;
    const draft: PlanDraft = {
      title,
      intent: "informational",
      article_type: detectArticleType(q) === "comparison_article" ? "comparison_article" : "faq_article",
      target_keywords: [q],
      linked_pages: cluster.commercial_pages.slice(0, 4),
      priority: 0,
    };
    out.push({ ...draft, priority: articlePriority(draft, cluster) - 6 });
  }

  return out;
}

function pickKeywords(keywords: string[], type: ArticleType, entity: string): string[] {
  const wanted: Record<ArticleType, string[]> = {
    guide_article: ["как выбрать", "выбор", "how to", "choose"],
    comparison_article: COMPARE_MARKERS,
    expert_article: EXPERT_MARKERS,
    faq_article: QUESTION_MARKERS,
    supporting_article: ["виды", "размер", "типы", "types", "size"],
    news_article: NEWS_MARKERS,
  };
  const marks = wanted[type] || [];
  const hits = keywords.filter((k) => hasAny(norm(k), marks));
  const rest = keywords.filter((k) => !hits.includes(k));
  return [...new Set([...hits, ...rest])].slice(0, 8).concat(hits.length ? [] : [entity]).slice(0, 8);
}

/** Priority 0-100: demand of the cluster it supports + type weight. */
export function articlePriority(plan: PlanDraft, cluster: TopicClusterDraft): number {
  const typeWeight: Record<ArticleType, number> = {
    guide_article: 30,
    comparison_article: 26,
    supporting_article: 22,
    expert_article: 20,
    faq_article: 16,
    news_article: 8,
  };
  const pages = Math.min(1, cluster.commercial_pages.length / 6) * 40;
  const kws = Math.min(1, plan.target_keywords.length / 6) * 30;
  return Math.max(1, Math.min(100, Math.round(typeWeight[plan.article_type] + pages + kws)));
}

// ---------------------------------------------------------------------------
// 9. article authority score (quality layer for blog articles)
// ---------------------------------------------------------------------------
export interface ArticleSignals {
  words: number;
  headings: number;
  faq: number;
  commercial_links: number;
  keywords_total: number;
  keywords_covered: number;
  entities: number;
  has_table?: boolean;
  article_type: ArticleType;
}

export interface ArticleAuthority {
  score: number;
  status: "PASS" | "REVIEW" | "FAIL";
  issues: string[];
}

export const MIN_WORDS: Record<ArticleType, number> = {
  guide_article: 900,
  comparison_article: 800,
  expert_article: 900,
  supporting_article: 700,
  faq_article: 550,
  news_article: 450,
};

export function articleAuthorityScore(s: ArticleSignals): ArticleAuthority {
  const issues: string[] = [];
  const minW = MIN_WORDS[s.article_type] ?? 700;

  const wordScore = Math.min(1, s.words / minW) * 25;
  if (s.words < minW * 0.8) issues.push(`thin_content:${s.words}/${minW}`);

  const structScore = Math.min(1, s.headings / 5) * 15;
  if (s.headings < 4) issues.push("weak_structure");

  const faqScore = Math.min(1, s.faq / 4) * 15;
  if (s.faq < 3) issues.push("faq_too_small");

  const linkScore = Math.min(1, s.commercial_links / 2) * 20;
  if (s.commercial_links < 2) issues.push("commercial_links_lt_2");

  const coverage = s.keywords_total ? s.keywords_covered / s.keywords_total : 1;
  const covScore = coverage * 15;
  if (coverage < 0.5) issues.push("low_semantic_coverage");

  const entScore = Math.min(1, s.entities / 4) * 10;
  if (s.entities < 2) issues.push("few_entities");

  if (s.article_type === "comparison_article" && !s.has_table) issues.push("missing_comparison_table");

  const score = Math.round(wordScore + structScore + faqScore + linkScore + covScore + entScore);
  const hard = issues.some((i) =>
    i.startsWith("thin_content") || i === "commercial_links_lt_2" || i === "missing_comparison_table");
  const status: ArticleAuthority["status"] = hard || score < 55 ? "FAIL" : score < 75 ? "REVIEW" : "PASS";
  return { score: Math.max(0, Math.min(100, score)), status, issues };
}

/** How many of the target keywords really appear in the body. */
export function coveredKeywords(body: string, keywords: string[]): string[] {
  const bag = stemSet([body]);
  return keywords.filter((k) => {
    const st = [...stemSet([k])];
    if (!st.length) return false;
    return st.filter((w) => bag.has(w)).length / st.length >= 0.6;
  });
}
