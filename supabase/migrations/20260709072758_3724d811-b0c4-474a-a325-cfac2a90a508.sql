
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS geo jsonb;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS geo_details jsonb;
ALTER TABLE public.keywords ADD COLUMN IF NOT EXISTS geo_details jsonb;

CREATE INDEX IF NOT EXISTS idx_articles_language ON public.articles(language);
CREATE INDEX IF NOT EXISTS idx_keywords_language ON public.keywords(language);
CREATE INDEX IF NOT EXISTS idx_projects_language ON public.projects(language);
