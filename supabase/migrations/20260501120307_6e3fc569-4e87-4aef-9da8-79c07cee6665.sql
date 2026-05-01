
-- Syndication log
CREATE TABLE IF NOT EXISTS public.syndication_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL,
  project_id uuid,
  user_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('blogger','hashnode','devto')),
  published_url text,
  canonical_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','skipped')),
  error_message text,
  external_post_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_syndication_log_article ON public.syndication_log(article_id);
CREATE INDEX IF NOT EXISTS idx_syndication_log_user ON public.syndication_log(user_id);
CREATE INDEX IF NOT EXISTS idx_syndication_log_project ON public.syndication_log(project_id);

ALTER TABLE public.syndication_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own syndication logs"
ON public.syndication_log FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins view all syndication logs"
ON public.syndication_log FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Projects: syndication settings
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS hashnode_publication_id text,
  ADD COLUMN IF NOT EXISTS syndication_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS syndication_platforms text[] NOT NULL DEFAULT ARRAY['blogger','hashnode','devto']::text[];

-- Articles: cached EN translation to avoid re-translating for hashnode + devto
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS translated_title_en text,
  ADD COLUMN IF NOT EXISTS translated_content_en text;
