-- Enable pgvector for semantic similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column for semantic interlinking (OpenAI text-embedding-3-small = 1536 dims)
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Track which model produced the article (for A/B quality comparison)
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS generation_model text;

-- HNSW index for fast cosine similarity (only on rows that have an embedding)
CREATE INDEX IF NOT EXISTS idx_articles_embedding_hnsw
  ON public.articles
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_articles_generation_model
  ON public.articles (generation_model)
  WHERE generation_model IS NOT NULL;

-- RPC: find top-K semantically similar articles inside the same project
CREATE OR REPLACE FUNCTION public.match_project_articles(
  p_project_id uuid,
  p_query_embedding vector(1536),
  p_exclude_id uuid,
  p_match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  title text,
  published_url text,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.title,
    a.published_url,
    1 - (a.embedding <=> p_query_embedding) AS similarity
  FROM public.articles a
  WHERE a.project_id = p_project_id
    AND a.id <> p_exclude_id
    AND a.embedding IS NOT NULL
    AND a.status IN ('completed', 'published')
  ORDER BY a.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;