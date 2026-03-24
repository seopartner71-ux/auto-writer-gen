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

export interface DeepParseResult {
  benchmark: DeepParseBenchmark;
  entities: Entity[];
  must_use_phrases: MustUsePhrase[];
  tfidf_phrases: TfidfPhrase[];
  lsi_success_phrases: string[];
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

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as DeepParseResult;
}

/** Build prompt context from deep analysis for article generation */
export function buildAnalysisContext(result: DeepParseResult): string {
  const { benchmark, entities, must_use_phrases, lsi_success_phrases } = result;

  const entityList = entities
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 15)
    .map((e) => `${e.name} (${e.type}, importance: ${e.importance}/10)`)
    .join(", ");

  const lsiList = [
    ...must_use_phrases.map((p) => p.phrase),
    ...lsi_success_phrases,
  ].slice(0, 25).join(", ");

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

INSTRUCTION: Write an article that technically surpasses these metrics. Include ALL mandatory entities naturally. Use LSI phrases throughout. Word count must be at least ${benchmark.target_word_count} words.`;
}
