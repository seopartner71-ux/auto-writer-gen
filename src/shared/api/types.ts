export type AppRole = "admin" | "user";
export type Plan = "free" | "basic" | "pro";
export type ArticleStatus = "draft" | "review" | "published" | "research" | "outline" | "generating" | "completed";
export type SearchIntent = "informational" | "transactional" | "navigational";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  plan: Plan;
  is_active: boolean;
  credits_amount: number;
  avatar_url: string | null;
  preferred_language: string | null;
  theme_preference: string | null;
  created_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
}

export interface AuthorProfile {
  id: string;
  user_id: string;
  name: string;
  voice_tone: string | null;
  style_examples: string | null;
  stop_words: string[] | null;
  system_prompt_override: string | null;
  created_at: string;
}

export interface Keyword {
  id: string;
  user_id: string;
  seed_keyword: string;
  lsi_keywords: string[] | null;
  questions: string[] | null;
  intent: SearchIntent | null;
  volume: number | null;
  difficulty: number | null;
  created_at: string;
}

export interface SerpResult {
  id: string;
  keyword_id: string;
  position: number | null;
  url: string | null;
  title: string | null;
  snippet: string | null;
  word_count: number | null;
  headings: Record<string, unknown> | null;
  analyzed_at: string;
}

export interface Article {
  id: string;
  user_id: string;
  keyword_id: string | null;
  author_profile_id: string | null;
  cluster_id: string | null;
  title: string | null;
  content: string | null;
  meta_description: string | null;
  seo_score: { readability?: number; keywordDensity?: number; structure?: number } | null;
  status: ArticleStatus;
  geo: string | null;
  language: string | null;
  lsi_keywords: Record<string, unknown>[] | null;
  suggested_outline: Record<string, unknown>[] | null;
  ai_content_gap: Record<string, unknown>[] | null;
  share_token: string | null;
  is_public: boolean;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiModel {
  id: string;
  model_key: string;
  display_name: string | null;
  tier: string | null;
  is_active: boolean;
  created_at: string;
}

export interface UsageLog {
  id: string;
  user_id: string;
  action: string | null;
  model_used: string | null;
  tokens_used: number | null;
  created_at: string;
}

// New tables
export interface Cluster {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  created_at: string;
}

export interface ArticleMetrics {
  id: string;
  article_id: string;
  word_count: number;
  character_count: number;
  reading_time_minutes: number;
  h2_count: number;
  h3_count: number;
  images_count: number;
  keyword_density: number;
  lsi_covered_count: number;
  content_score: number;
  is_title_optimal: boolean;
  is_description_optimal: boolean;
  schema_json: Record<string, unknown> | null;
  updated_at: string;
}

export interface Competitor {
  id: string;
  article_id: string;
  url: string;
  domain: string;
  title: string | null;
  meta_description: string | null;
  type: string | null;
  word_count: number;
  h2_count: number;
  is_selected: boolean;
  created_at: string;
}

export interface PaaQuestion {
  id: string;
  article_id: string;
  question: string;
  answer_snippet: string | null;
  created_at: string;
}

export interface ArticleVersion {
  id: string;
  article_id: string;
  content: string;
  created_at: string;
}

export interface UserStats {
  user_id: string;
  total_articles_created: number;
  total_words_generated: number;
  average_content_score: number;
  last_activity_at: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  monthly_article_limit: number;
  can_use_paa: boolean;
  can_use_clusters: boolean;
  can_export_html: boolean;
  price_rub: number;
  created_at: string;
}

// Plan limits & feature flags
export interface PlanConfig {
  maxGenerations: number;
  maxAuthorProfiles: number; // -1 = unlimited
  maxProImages: number; // 0 = disabled
  models: string[];
  hasCalendar: boolean;
  hasUniquenessCheck: boolean;
  hasJsonLdSchema: boolean;
  hasFullSerp: boolean;
  hasAntiAiCheck: boolean;
  hasBulkMode: boolean;
  hasWordPress: boolean;
  hasProImageGen: boolean;
  hasMiralinks: boolean;
  hasGoGetLinks: boolean;
}

export const PLAN_LIMITS: Record<Plan, PlanConfig> = {
  free: {
    maxGenerations: 5,
    maxAuthorProfiles: 1,
    maxProImages: 0,
    models: ["google/gemini-2.5-flash-lite"],
    hasCalendar: false,
    hasUniquenessCheck: false,
    hasJsonLdSchema: false,
    hasFullSerp: false,
    hasAntiAiCheck: false,
    hasBulkMode: false,
    hasWordPress: false,
    hasProImageGen: false,
    hasMiralinks: false,
  },
  basic: {
    maxGenerations: 30,
    maxAuthorProfiles: 5,
    maxProImages: 0,
    models: ["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash", "openai/gpt-5-nano"],
    hasCalendar: false,
    hasUniquenessCheck: true,
    hasJsonLdSchema: true,
    hasFullSerp: true,
    hasAntiAiCheck: false,
    hasBulkMode: false,
    hasWordPress: false,
    hasProImageGen: false,
    hasMiralinks: false,
  },
  pro: {
    maxGenerations: 100,
    maxAuthorProfiles: -1,
    maxProImages: 100,
    models: ["google/gemini-2.5-pro", "openai/gpt-5", "google/gemini-2.5-flash", "google/gemini-2.5-flash-lite", "openai/gpt-5-nano"],
    hasCalendar: true,
    hasUniquenessCheck: true,
    hasJsonLdSchema: true,
    hasFullSerp: true,
    hasAntiAiCheck: true,
    hasBulkMode: true,
    hasWordPress: true,
    hasProImageGen: true,
    hasMiralinks: true,
  },
};
