ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS generation_mode TEXT NOT NULL DEFAULT 'full';
CREATE INDEX IF NOT EXISTS idx_articles_generation_mode ON public.articles (generation_mode);