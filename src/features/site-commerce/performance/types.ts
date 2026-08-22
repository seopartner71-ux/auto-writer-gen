// P22 - shared types for the Performance Center (read-only analytics layer).

export interface PerfScores {
  seo: number; geo: number; visual: number; media: number;
  commercial: number; content: number; quality: number;
}

export interface GeoPart {
  key: string; weight: number; value: number; points: number;
  label_ru: string; label_en: string;
}

export interface IndexStatus {
  total: number; submitted: number; indexed: number; pending: number;
}

export interface SiloNode {
  id: string; url_path: string; page_type: string; title: string;
  parent: string | null; status: "PASS" | "REVIEW" | "FAIL";
  seo_score: number; visual_score: number; indexed: boolean;
}

export type OppGroup = "seo" | "geo" | "commercial" | "media";
export type OppEngine = "seo-engine" | "commercial-engine" | "media-engine" | "commerce-content" | "blog-engine";

export interface Opportunity {
  group: OppGroup;
  key: string;
  count: number;
  impact: "high" | "medium" | "low";
  engine: OppEngine;
  step: number;
  affected: string[];
  label_ru: string;
  label_en: string;
}

export interface ReleaseRow {
  id: string; version: string | null; pages: number | null;
  published_url: string | null; status: string | null;
  is_current: boolean | null; created_at: string;
}

export interface VisibilityRow {
  query: string; entity: string; model: string;
  mentioned: boolean; position: number | null; cited: boolean;
  confidence: number; checked_at: string;
}

export interface PerfOverview {
  scores: PerfScores;
  geo_breakdown: GeoPart[];
  index_status: IndexStatus;
  silo_map: SiloNode[];
  opportunities: Opportunity[];
  stats: {
    pages: number; content_pages: number; published_urls: number;
    products: number; images: number; clusters: number; organic_ready: boolean;
  };
  site: { production_url: string | null; published_at: string | null; name: string; domain: string };
  releases: ReleaseRow[];
  ai_visibility: VisibilityRow[];
}

export interface ScoreSnapshot {
  id: string; version: string | null; release_id: string | null;
  seo_score: number; geo_score: number; visual_score: number; media_score: number;
  quality_score: number; content_score: number; commercial_score: number;
  pages: number; indexed_urls: number; created_at: string;
}
