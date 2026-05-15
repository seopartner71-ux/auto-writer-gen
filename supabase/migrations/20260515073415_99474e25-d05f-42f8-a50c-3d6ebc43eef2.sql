ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS cluster_fitness_score integer,
  ADD COLUMN IF NOT EXISTS cluster_fitness_details jsonb,
  ADD COLUMN IF NOT EXISTS serp_cluster_pipeline boolean DEFAULT false;

-- Mark all already-existing articles as "before SERP-cluster integration".
UPDATE public.articles
SET serp_cluster_pipeline = false
WHERE serp_cluster_pipeline IS NULL;

CREATE INDEX IF NOT EXISTS idx_articles_serp_pipeline_user
  ON public.articles (user_id, serp_cluster_pipeline);