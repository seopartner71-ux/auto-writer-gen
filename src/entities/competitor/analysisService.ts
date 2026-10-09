import { supabase } from "@/integrations/supabase/client";

// ── Types ──────────────────────────────────────────────────────────────
export interface CompetitorAnalysis {
  url: string;
  position: number;
  structure: {
    h1: string;
    h_tags: { level: number; text: string }[];
    word_count: number;
    char_count: number;
    paragraph_count: number;
    avg_paragraph_length: number;
  };
  content: {
    keywords: { word: string; density: number; tf_idf: number }[];
    lsi_phrases: string[];
    entities: { name: string; type: string; importance: number }[];
  };
  media: {
    images_count: number;
    has_video: boolean;
    video_links: string[];
  };
  seo: {
    title: string;
    description: string;
    main_keyword_density: number;
  };
}

export interface DeepParseBenchmark {
  total_parsed: number;
  failed_urls: { url: string; reason: string }[];
  median_word_count: number;
  median_img_count: number;
  median_h2_count: number;
  median_h3_count: number;
  median_paragraph_count: number;
  median_keyword_density: number;
  video_percentage: number;
  target_word_count: number;
  target_img_count: number;
  target_h2_count: number;
}

export interface Entity {
  name: string;
  type: string;
  importance: number;
  competitors_using?: number;
}

export interface MustUsePhrase {
  phrase: string;
  reason: string;
}

export interface TfidfPhrase {
  phrase: string;
  total: number;
  docs: number;
  tfidf: number;
  commonality: number;
}

export interface BestCompetitorHeadings {
  url: string;
  position: number;
  title: string;
  h1: string;
  headings: { level: number; text: string }[];
}

export interface CompetitorRow {
  url: string;
  position: number;
  word_count: number;
  img_count: number;
  h2_count: number;
  h3_count: number;
  video_presence: boolean;
  keyword_density: number;
  title_tag: string;
  meta_description: string;
}

export interface TermActionRow {
  phrase: string;
  action: "add" | "check" | "skip";
  reason: string;
  source: string;
  docs?: number;
  commonality?: number;
}

export interface DeepParseResult {
  benchmark: DeepParseBenchmark;
  entities: Entity[];
  must_use_phrases: MustUsePhrase[];
  tfidf_phrases: TfidfPhrase[];
  lsi_success_phrases: string[];
  /** add / check / skip with reason; absent in very old responses. */
  term_actions?: TermActionRow[];
  best_competitor_headings: BestCompetitorHeadings;
  per_competitor: CompetitorRow[];
}

// ── Service ────────────────────────────────────────────────────────────

/** Run deep competitor analysis. Uses DB cache unless force_refresh=true. */
export async function fetchAndAnalyze(
  keywordId: string,
  accessToken: string,
  forceRefresh = false
): Promise<DeepParseResult> {
  const { data, error } = await supabase.functions.invoke("deep-parse-competitors", {
    body: { keyword_id: keywordId, force_refresh: forceRefresh },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (error) {
    // Разбор ТОП-10 длится 1-3 минуты, соединение иногда рвётся до ответа,
    // хотя результат уже сохранён в кеш. Дожидаемся его повторными запросами.
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise((r) => setTimeout(r, 20000));
      const retry = await supabase.functions.invoke("deep-parse-competitors", {
        body: { keyword_id: keywordId, force_refresh: false },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!retry.error && retry.data && !retry.data?.error) {
        return retry.data as DeepParseResult;
      }
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data as DeepParseResult;
}

/** Build prompt context from deep analysis for article generation */
export function buildAnalysisContext(result: DeepParseResult): string {
  const { benchmark, entities, must_use_phrases, lsi_success_phrases } = result;
  const actions = result.term_actions || [];
  const actionOf = new Map(actions.map((t) => [t.phrase.trim().toLowerCase(), t.action]));
  const isAdd = (p: string) => (actionOf.get(p.trim().toLowerCase()) ?? "add") === "add";

  const entityList = [...entities]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 15)
    .map((e) => `${e.name} (${e.type}, importance: ${e.importance}/10)`)
    .join(", ");

  const lsiList = [
    ...must_use_phrases.map((p) => p.phrase),
    ...lsi_success_phrases,
  ].filter(isAdd).slice(0, 25).join(", ");

  const checkList = actions.filter((t) => t.action === "check").slice(0, 20)
    .map((t) => `- ${t.phrase} (${t.reason})`).join("\n");
  const skipList = actions.filter((t) => t.action === "skip").slice(0, 20)
    .map((t) => `- ${t.phrase}`).join("\n");

  return `
COMPETITOR DEEP ANALYSIS DATA:
- Recommended word count: ${benchmark.target_word_count} words (median: ${benchmark.median_word_count}, target: +10%)
- Target images: ${benchmark.target_img_count} (median: ${benchmark.median_img_count})
- Target H2 sections: ${benchmark.target_h2_count} (median: ${benchmark.median_h2_count})
- Target keyword density: ${benchmark.median_keyword_density}%
- ${benchmark.video_percentage}% of competitors include video

MANDATORY ENTITIES (Google associates these with the topic):
${entityList}

LSI PHRASES (critical for ranking):
${lsiList}
${checkList ? `
CHECK AGAINST CLIENT FACTS (competitor promises: prices, terms, warranty, delivery, certificates):
${checkList}
RULE: use a CHECK item only if the same fact is present in the client data, knowledge base or company profile given in this prompt, and take the value from the client data, never from competitors. If the client data does not confirm it, do not state it as the company's promise; at most describe the topic neutrally without numbers or guarantees ("уточняйте у менеджера").` : ""}
${skipList ? `
DO NOT USE (template, legal or navigation noise from competitor sites):
${skipList}` : ""}

INSTRUCTION: Write an article that technically surpasses these metrics. Include ALL mandatory entities naturally. Use LSI phrases throughout. Word count must be at least ${benchmark.target_word_count} words.`;
}

