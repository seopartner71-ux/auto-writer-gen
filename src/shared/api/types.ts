export type AppRole = "admin" | "user";
export type Plan = "free" | "basic" | "pro";
export type ArticleStatus = "draft" | "review" | "published";
export type SearchIntent = "informational" | "transactional" | "navigational";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  plan: Plan;
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
  title: string | null;
  content: string | null;
  meta_description: string | null;
  seo_score: { readability?: number; keywordDensity?: number; structure?: number } | null;
  status: ArticleStatus;
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

// Plan limits
export const PLAN_LIMITS: Record<Plan, { maxGenerations: number; models: string[] }> = {
  basic: {
    maxGenerations: 30,
    models: ["google/gemini-2.5-flash-lite", "openai/gpt-5-nano"],
  },
  pro: {
    maxGenerations: 100,
    models: ["google/gemini-2.5-pro", "openai/gpt-5", "google/gemini-2.5-flash"],
  },
};
