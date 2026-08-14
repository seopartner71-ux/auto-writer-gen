// Persona Engine v2.0 - типы. Новый слой, существующие типы проекта не изменяются.

export type PersonaStatus = "draft" | "active" | "testing" | "archived";

export interface SiteDnaData {
  site_identity?: string | null;
  business_type?: string | null;
  brand_name?: string | null;
  industry?: string | null;
  sub_industries?: string[];
  products?: string[];
  services?: string[];
  categories?: string[];
  audience?: string | null;
  positioning?: string | null;
  usp?: string[];
  brand_voice?: string | null;
  terminology?: string[];
  expertise_areas?: string[];
  commercial_context?: string | null;
  editorial_context?: string | null;
  content_patterns?: string[];
  important_entities?: string[];
  trust_signals?: string[];
  restrictions?: string[];
  competitors_context?: string | null;
  language?: string | null;
  market?: string | null;
  [key: string]: unknown;
}

export interface SiteDnaRow {
  id: string;
  user_id: string;
  url: string;
  data: SiteDnaData;
  analyzed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoiceDna {
  formality?: number;
  warmth?: number;
  energy?: number;
  authority?: number;
  emotionality?: number;
  directness?: number;
  subjectivity?: number;
  conversationality?: number;
  preferred_person?: string;
  preferred_tense?: string;
  preferred_sentence_complexity?: string;
  preferred_paragraph_density?: string;
}

export interface PersonaDna {
  identity?: {
    role?: string;
    competence_area?: string;
    competence_limits?: string[];
    status?: string;
  };
  expertise?: Record<string, unknown>;
  audience?: Record<string, unknown>;
  purpose?: { primary?: string; secondary?: string; tertiary?: string };
  voice?: VoiceDna;
  narrative?: Record<string, unknown>;
  fact_policy?: { rules?: string[]; on_missing_data?: string };
  source_policy?: Record<string, unknown>;
  seo_policy?: { principles?: string[]; forbidden?: string[] };
  geo_policy?: { enabled?: boolean; principles?: string[] };
  platform_policy?: Record<string, unknown>;
  anti_ai_policy?: { forbidden_patterns?: string[]; required_variety?: string[] };
  editorial_rules?: string[];
  forbidden_behaviour?: string[];
  quality_control?: Record<string, string[]>;
  confidence?: Record<string, number>;
  conflicts?: { rule_a: string; rule_b: string; resolution: string }[];
  missing_inputs?: string[];
  [key: string]: unknown;
}

export interface StyleDna {
  vocabulary?: Record<string, string>;
  sentence_style?: Record<string, string | number>;
  paragraph_style?: Record<string, string>;
  rhythm?: Record<string, string>;
  [key: string]: unknown;
}

export interface StyleFingerprint {
  avg_sentence_length: number;
  sentence_length_variance: number;
  avg_paragraph_length: number;
  paragraph_length_variance: number;
  question_frequency: number;
  first_person_frequency: number;
  list_frequency: number;
  heading_frequency: number;
  technical_term_density: number;
  subjectivity_score: number;
  emotionality_score: number;
  directness_score: number;
  samples_count: number;
}

export interface Persona {
  id: string;
  user_id: string;
  name: string;
  role: string | null;
  description: string | null;
  status: PersonaStatus;
  version: string;
  site_url: string | null;
  site_dna_id: string | null;
  /** Связанный профиль автора (author_profiles) - через него идёт генерация статей. */
  author_profile_id?: string | null;
  persona_dna: PersonaDna;
  style_dna: StyleDna;
  style_fingerprint: StyleFingerprint | null;
  quality_rules: Record<string, unknown>;
  master_prompt: string | null;
  health_score: number;
  articles_generated: number;
  project_ids: string[];
  language: string;
  change_log: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonaVersion {
  id: string;
  persona_id: string;
  version: string;
  snapshot: Record<string, unknown>;
  change_log: string | null;
  created_at: string;
}

export interface PersonaEvaluation {
  id: string;
  persona_id: string;
  article_id: string | null;
  task: string | null;
  output_text: string | null;
  scores: Record<string, number>;
  total_score: number;
  deviations: { area: string; observed: string; expected: string; severity: string }[];
  suggestions: { field: string; current: string; suggested: string; reason: string }[];
  created_at: string;
}

export type PlatformKey = "website" | "dzen" | "vc" | "telegraph" | "external_media";

export interface PlatformDna {
  key: PlatformKey;
  label: string;
  format: string;
  length: string;
  style: string;
  storytelling: string;
  structure: string;
  commercial: string;
}

export const PLATFORM_DNA: Record<PlatformKey, PlatformDna> = {
  website: {
    key: "website", label: "Сайт",
    format: "SEO-статья с подзаголовками", length: "4000-12000 знаков",
    style: "экспертный, структурный", storytelling: "умеренный, только по делу",
    structure: "H2/H3, списки, таблицы, FAQ", commercial: "мягкая, через пользу",
  },
  dzen: {
    key: "dzen", label: "Дзен",
    format: "лонгрид для ленты", length: "3000-7000 знаков",
    style: "разговорный, живой", storytelling: "высокий, допустимы сцены",
    structure: "короткие абзацы, крючок в начале", commercial: "минимальная",
  },
  vc: {
    key: "vc", label: "vc.ru",
    format: "аналитический материал", length: "5000-15000 знаков",
    style: "деловой, с цифрами", storytelling: "кейсовый",
    structure: "тезис - аргумент - вывод", commercial: "только в конце, без рекламы",
  },
  telegraph: {
    key: "telegraph", label: "Telegra.ph",
    format: "простая публикация", length: "2000-6000 знаков",
    style: "нейтральный", storytelling: "низкий",
    structure: "минимум разметки", commercial: "допустима ссылка",
  },
  external_media: {
    key: "external_media", label: "Внешние СМИ",
    format: "редакционный материал", length: "4000-9000 знаков",
    style: "строгий, редакционный", storytelling: "низкий",
    structure: "журналистская подача", commercial: "запрещена прямая реклама",
  },
};