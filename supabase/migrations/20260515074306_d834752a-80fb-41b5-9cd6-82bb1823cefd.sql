ALTER TABLE public.articles
ADD COLUMN IF NOT EXISTS turgenev_auto_fixed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_articles_turgenev_auto_fixed
ON public.articles(turgenev_auto_fixed)
WHERE turgenev_auto_fixed = false;