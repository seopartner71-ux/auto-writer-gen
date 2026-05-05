
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS last_improve_at timestamptz;

ALTER TABLE public.article_versions
  ADD COLUMN IF NOT EXISTS metadata jsonb;
