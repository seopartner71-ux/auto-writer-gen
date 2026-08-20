// ============================================================================
// P13 - CONTENT QUALITY HARDENING (pure core: no DB, no LLM, no network)
//
//   PDE -> REGISTRY -> CONTENT -> [CONTENT QUALITY] -> QA -> BUILD
//
// Answers one question per page: "is this content actually good enough for
// this page type?" Volume is only one signal among several - intent match,
// factual density, semantic coverage and required commercial factors weigh
// more. Nothing here invents data: a factor with no source is Missing Data,
// not a defect of the text.
// ============================================================================

import type { PageKind, SeoContent } from "./commerceContent.ts";
import { tokens, stem, contentWordCount } from "./commerceContent.ts";

export type ContentSeverity = "critical_content" | "warning_content" | "acceptable";

export type ContentProblemCode =
  | "no_content"
  | "thin_for_type"
  | "low_semantic_coverage"
  | "few_semantic_terms"
  | "missing_entities"
  | "missing_faq"
  | "intent_mismatch"
  | "template_content"
  | "duplicated_blocks"
  | "missing_required_factor";

export interface ContentProblem {
  code: ContentProblemCode;
  severity: ContentSeverity;
  detail?: string;
}

// ---------------------------------------------------------------------------
// 8. Per page type thresholds. One hard word count for every type is wrong:
//    a product card is complete at 140 useful words, an informational page
//    is not complete at 400.
// ---------------------------------------------------------------------------

export interface ContentProfile {
  /** below this the page is thin for its type */
  minWords: number;
  /** target size, used for the sufficiency score only */
  goodWords: number;
  minBlocks: number;
  minFaq: number;
  minSemanticTerms: number;
  minEntities: number;
  /** share of the page semantics (0-100) that must appear in the text */
  minCoverage: number;
  /** what really matters for this type - shown in the UI and sent to the model */
  focus: string[];
}

export const CONTENT_PROFILE: Record<PageKind, ContentProfile> = {
  product: {
    minWords: 130, goodWords: 260, minBlocks: 2, minFaq: 1,
    minSemanticTerms: 5, minEntities: 2, minCoverage: 45,
    focus: ["факты товара", "характеристики", "применение", "порядок заказа"],
  },
  service: {
    minWords: 160, goodWords: 320, minBlocks: 3, minFaq: 2,
    minSemanticTerms: 6, minEntities: 2, minCoverage: 45,
    focus: ["состав услуги", "процесс", "расчет стоимости", "регион", "CTA"],
  },
  category: {
    minWords: 170, goodWords: 340, minBlocks: 3, minFaq: 2,
    minSemanticTerms: 7, minEntities: 3, minCoverage: 50,
    focus: ["интент категории", "ассортимент", "помощь с выбором", "смежные разделы"],
  },
  hub: {
    minWords: 200, goodWords: 420, minBlocks: 3, minFaq: 2,
    minSemanticTerms: 8, minEntities: 3, minCoverage: 50,
    focus: ["обзор темы", "дочерние разделы", "навигация", "сущности"],
  },
  informational: {
    minWords: 520, goodWords: 900, minBlocks: 4, minFaq: 2,
    minSemanticTerms: 8, minEntities: 4, minCoverage: 55,
    focus: ["полнота ответа", "критерии", "ошибки", "сущности"],
  },
  article: {
    minWords: 400, goodWords: 900, minBlocks: 3, minFaq: 0,
    minSemanticTerms: 5, minEntities: 3, minCoverage: 40,
    focus: ["полнота ответа", "структура", "связанные страницы"],
  },
};

export function profileFor(kind: string | null | undefined): ContentProfile {
  return CONTENT_PROFILE[(kind || "category") as PageKind] || CONTENT_PROFILE.category;
}

// ---------------------------------------------------------------------------
// 9. Semantic coverage - meaning, not keyword count
// ---------------------------------------------------------------------------

export interface SemanticCoverage {
  /** 0-100: share of the page vocabulary that is really present in the text */
  score: number;
  primary: string[];
  secondary: string[];
  entities: string[];
  covered: string[];
  missing: string[];
  /** primary keyword present in h1/title/intro */
  primary_in_head: boolean;
}

function contentText(c: SeoContent | null | undefined): string {
  if (!c) return "";
  return [
    c.intro,
    ...(c.body || []).map((b) => `${b.heading} ${b.text}`),
    ...(c.faq || []).map((f) => `${f.q} ${f.a}`),
  ].join(" ");
}

function stemSet(list: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of list) for (const t of tokens(s)) out.add(stem(t));
  return out;
}

export function semanticCoverage(
  content: SeoContent | null | undefined,
  extra?: { primary?: string[]; secondary?: string[] },
): SemanticCoverage {
  const primary = [...new Set([...(content?.primary_keywords || []), ...(extra?.primary || [])])].filter(Boolean);
  const secondary = [...new Set([
    ...(content?.secondary_keywords || []),
    ...(content?.semantic_terms || []),
    ...(extra?.secondary || []),
  ])].filter(Boolean);
  const entities = (content?.entities || []).filter(Boolean);

  const body = stemSet([contentText(content)]);
  const head = stemSet([content?.h1 || "", content?.seo_title || "", content?.intro || ""]);

  const check = (phrase: string, where: Set<string>): boolean => {
    const st = [...stemSet([phrase])];
    if (!st.length) return false;
    const hit = st.filter((w) => where.has(w)).length;
    return hit / st.length >= 0.6;
  };

  const covered: string[] = [];
  const missing: string[] = [];
  const weigh: { phrase: string; weight: number }[] = [
    ...primary.map((p) => ({ phrase: p, weight: 3 })),
    ...entities.map((p) => ({ phrase: p, weight: 2 })),
    ...secondary.map((p) => ({ phrase: p, weight: 1 })),
  ];
  let total = 0;
  let got = 0;
  for (const w of weigh) {
    total += w.weight;
    if (check(w.phrase, body)) { got += w.weight; covered.push(w.phrase); }
    else missing.push(w.phrase);
  }

  return {
    score: total ? Math.round((got / total) * 100) : 0,
    primary, secondary, entities,
    covered: [...new Set(covered)].slice(0, 40),
    missing: [...new Set(missing)].slice(0, 40),
    primary_in_head: primary.length ? primary.some((p) => check(p, head)) : false,
  };
}

// ---------------------------------------------------------------------------
// 2 + 8. Multi-signal assessment. Words are one signal out of six.
// ---------------------------------------------------------------------------

const TEMPLATE_MARKERS = [
  "широкий ассортимент", "лучшие цены", "индивидуальный подход",
  "команда профессионалов", "высокое качество по низкой цене",
];

export interface ContentAssessment {
  kind: PageKind;
  has_content: boolean;
  words: number;
  blocks: number;
  faq: number;
  entities: number;
  semantic_terms: number;
  coverage: number;
  /** 0-100 aggregate of all signals, not of the word count alone */
  sufficiency: number;
  thin: boolean;
  low_semantic: boolean;
  intent_ok: boolean;
  template: boolean;
  problems: ContentProblem[];
  severity: ContentSeverity;
  missing_terms: string[];
}

export function assessContent(
  kind: PageKind,
  content: SeoContent | null | undefined,
  opts?: { primary?: string[]; secondary?: string[]; missingRequired?: string[]; hasChildren?: boolean },
): ContentAssessment {
  const p = profileFor(kind);
  const words = contentWordCount(content);
  const blocks = content?.body?.length || 0;
  const faq = content?.faq?.length || 0;
  const ents = content?.entities?.length || 0;
  const terms = content?.semantic_terms?.length || 0;
  const cov = semanticCoverage(content, opts);
  const text = contentText(content).toLowerCase();
  const template = TEMPLATE_MARKERS.some((m) => text.includes(m));

  const problems: ContentProblem[] = [];
  const has = !!content && words > 0;
  if (!has) {
    problems.push({ code: "no_content", severity: "critical_content" });
  } else {
    if (words < p.minWords) {
      problems.push({ code: "thin_for_type", severity: words < p.minWords * 0.6 ? "critical_content" : "warning_content", detail: `${words}/${p.minWords}` });
    }
    if (cov.score < p.minCoverage) {
      problems.push({ code: "low_semantic_coverage", severity: cov.score < p.minCoverage * 0.6 ? "critical_content" : "warning_content", detail: `${cov.score}%` });
    }
    if (terms < p.minSemanticTerms) {
      problems.push({ code: "few_semantic_terms", severity: "warning_content", detail: `${terms}/${p.minSemanticTerms}` });
    }
    if (ents < p.minEntities) problems.push({ code: "missing_entities", severity: "warning_content", detail: `${ents}/${p.minEntities}` });
    if (faq < p.minFaq) problems.push({ code: "missing_faq", severity: "warning_content", detail: `${faq}/${p.minFaq}` });
    if (!cov.primary_in_head && cov.primary.length) {
      problems.push({ code: "intent_mismatch", severity: "warning_content", detail: cov.primary[0] });
    }
    if (template) problems.push({ code: "template_content", severity: "warning_content" });
    const headings = (content?.body || []).map((b) => b.heading.toLowerCase().trim()).filter(Boolean);
    if (headings.length > new Set(headings).size) {
      problems.push({ code: "duplicated_blocks", severity: "warning_content" });
    }
  }
  for (const k of opts?.missingRequired || []) {
    problems.push({ code: "missing_required_factor", severity: "warning_content", detail: k });
  }

  // sufficiency: volume is capped at 30 of 100 - the rest is meaning
  const volume = Math.min(1, words / p.goodWords) * 30;
  const structure = (Math.min(1, blocks / p.minBlocks) * 10) + (p.minFaq ? Math.min(1, faq / p.minFaq) * 10 : 10);
  const semantic = (cov.score / 100) * 30;
  const richness = (Math.min(1, ents / Math.max(1, p.minEntities)) * 10)
    + (Math.min(1, terms / Math.max(1, p.minSemanticTerms)) * 10);
  const penalty = (template ? 10 : 0) + (cov.primary.length && !cov.primary_in_head ? 5 : 0);
  const sufficiency = has ? Math.max(0, Math.min(100, Math.round(volume + structure + semantic + richness - penalty))) : 0;

  const severity: ContentSeverity = problems.some((x) => x.severity === "critical_content")
    ? "critical_content"
    : problems.some((x) => x.severity === "warning_content") ? "warning_content" : "acceptable";

  return {
    kind,
    has_content: has,
    words, blocks, faq, entities: ents, semantic_terms: terms,
    coverage: cov.score,
    sufficiency,
    thin: has && words < p.minWords,
    low_semantic: has && (cov.score < p.minCoverage || terms < p.minSemanticTerms),
    intent_ok: !cov.primary.length || cov.primary_in_head,
    template,
    problems,
    severity,
    missing_terms: cov.missing.slice(0, 12),
  };
}

// ---------------------------------------------------------------------------
// 1. Warning classification - what must be fixed vs what is acceptable
// ---------------------------------------------------------------------------

/** QA warning kinds that are structural noise, not a content defect. */
const ACCEPTABLE_SYSTEM = new Set([
  "orphan_page", "page_without_outgoing_links", "empty_cluster", "empty_silo",
  "long_title", "long_description", "img_without_alt", "missing_breadcrumb_schema",
  "keyword_without_target", "category_without_semantic_coverage", "duplicate_h1",
  "missing_canonical", "robots_conflict", "url_not_in_sitemap",
]);

const CRITICAL_CONTENT = new Set([
  "commercial_page_without_content", "page_without_primary_keyword",
  "duplicate_generated_content", "no_content", "thin_critical",
]);

export function classifyWarning(kind: string): ContentSeverity {
  if (CRITICAL_CONTENT.has(kind)) return "critical_content";
  if (ACCEPTABLE_SYSTEM.has(kind)) return "acceptable";
  return "warning_content";
}

/** 10. Batch selection modes used by the Content Engine. */
export type RegenMode = "only_fail" | "only_thin" | "only_low_semantic" | "only_missing_required";

export function matchesMode(
  mode: RegenMode,
  a: ContentAssessment,
  quality?: { status?: string | null; missing_required?: string[] | null },
): boolean {
  switch (mode) {
    case "only_fail": return String(quality?.status || "") === "FAIL" || !a.has_content;
    case "only_thin": return a.thin || !a.has_content;
    case "only_low_semantic": return a.low_semantic;
    case "only_missing_required": return (quality?.missing_required || []).length > 0;
  }
}

/** Worst-first ordering used by "fix the 10 worst pages". */
export function worstFirst<T extends { assessment: ContentAssessment; commercial_score?: number | null }>(rows: T[]): T[] {
  return [...rows].sort((x, y) => {
    const sx = (x.assessment.sufficiency * 0.6) + ((x.commercial_score ?? 50) * 0.4);
    const sy = (y.assessment.sufficiency * 0.6) + ((y.commercial_score ?? 50) * 0.4);
    return sx - sy;
  });
}

// ---------------------------------------------------------------------------
// QA facts, type-aware. Replaces buildContentFacts for audits: same shape plus
// coverage / sufficiency / severity so the audit can use adaptive thresholds.
// Lives here (not in commerceContent) to keep the module graph acyclic.
// ---------------------------------------------------------------------------

export interface QualityContentFact {
  kind: PageKind;
  name: string;
  path?: string | null;
  has_content: boolean;
  words: number;
  min_words: number;
  faq: number;
  entities: number;
  semantic_terms: number;
  coverage: number;
  sufficiency: number;
  severity: ContentSeverity;
  primary_keyword?: string | null;
  body_hash?: string | null;
  thin?: boolean;
  low_semantic?: boolean;
  intent_ok?: boolean;
}

function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

export function factOfContent(
  kind: PageKind,
  name: string,
  raw: unknown,
  path?: string | null,
): QualityContentFact {
  const c = (raw && typeof raw === "object" ? raw : null) as SeoContent | null;
  const a = assessContent(kind, c);
  const bodyText = c
    ? [c.intro, ...(c.body || []).map((b) => b.text)].join(" ").toLowerCase().replace(/\s+/g, " ").trim()
    : "";
  return {
    kind, name, path,
    has_content: a.has_content,
    words: a.words,
    min_words: profileFor(kind).minWords,
    faq: a.faq,
    entities: a.entities,
    semantic_terms: a.semantic_terms,
    coverage: a.coverage,
    sufficiency: a.sufficiency,
    severity: a.severity,
    primary_keyword: c?.primary_keywords?.[0] || null,
    body_hash: bodyText.length > 60 ? hashText(bodyText) : null,
    thin: a.thin,
    low_semantic: a.low_semantic,
    intent_ok: a.intent_ok,
  };
}

export function buildQualityContentFacts(input: {
  silos?: { id: string; name: string; seo_content?: unknown }[];
  clusters?: { id: string; name: string; seo_content?: unknown }[];
  products?: { id: string; name: string; kind?: string | null; url_path?: string | null; seo_content?: unknown }[];
}): QualityContentFact[] {
  return [
    ...(input.silos || []).map((s) => factOfContent("hub", s.name, s.seo_content)),
    ...(input.clusters || []).map((c) => factOfContent("category", c.name, c.seo_content)),
    ...(input.products || []).map((p) =>
      factOfContent(p.kind === "service" ? "service" : "product", p.name, p.seo_content, p.url_path || null)),
  ];
}
