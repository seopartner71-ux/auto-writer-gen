ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS ai_score_claude integer,
  ADD COLUMN IF NOT EXISTS rewritten boolean NOT NULL DEFAULT false;