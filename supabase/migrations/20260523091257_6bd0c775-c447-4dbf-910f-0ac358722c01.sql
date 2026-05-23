ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS page_type text NOT NULL DEFAULT 'article',
  ADD COLUMN IF NOT EXISTS commercial_brief jsonb;

CREATE INDEX IF NOT EXISTS idx_articles_page_type ON public.articles(page_type);