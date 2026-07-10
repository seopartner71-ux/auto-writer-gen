
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS humanize_profile text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS main_keyword text,
  ADD COLUMN IF NOT EXISTS source_url text;

-- Constraint защищает от опечаток в profile
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'articles_humanize_profile_check'
  ) THEN
    ALTER TABLE public.articles
      ADD CONSTRAINT articles_humanize_profile_check
      CHECK (humanize_profile IN ('standard','conservative'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_articles_user_source_rewrite
  ON public.articles(user_id, created_at DESC)
  WHERE source = 'rewrite';
