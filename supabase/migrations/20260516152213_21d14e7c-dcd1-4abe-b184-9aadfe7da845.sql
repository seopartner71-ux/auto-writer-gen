ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS humanize_meta jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pipeline_stages jsonb DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_articles_rewritten ON public.articles(rewritten) WHERE rewritten = true;