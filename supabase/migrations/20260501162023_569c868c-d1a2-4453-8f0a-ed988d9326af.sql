ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS turgenev_score integer,
  ADD COLUMN IF NOT EXISTS uniqueness_percent integer,
  ADD COLUMN IF NOT EXISTS ai_human_score integer,
  ADD COLUMN IF NOT EXISTS quality_badge text,
  ADD COLUMN IF NOT EXISTS quality_checked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS quality_details jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_articles_quality_badge ON public.articles(quality_badge);