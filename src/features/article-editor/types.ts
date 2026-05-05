export interface KeywordRef {
  language?: string | null;
  seed_keyword?: string | null;
}

export interface BenchmarkData {
  benchmark: {
    target_word_count: number;
    median_word_count: number;
    target_h2_count: number;
    median_h3_count: number;
    target_img_count: number;
    median_keyword_density: number;
  };
  must_use_phrases: Array<{ phrase: string }>;
  entities: Array<{ name: string; importance: number }>;
}