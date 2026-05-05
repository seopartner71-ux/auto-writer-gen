
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS ai_score_internal integer,
  ADD COLUMN IF NOT EXISTS ai_score_zerogpt integer,
  ADD COLUMN IF NOT EXISTS ai_score integer,
  ADD COLUMN IF NOT EXISTS burstiness_score numeric,
  ADD COLUMN IF NOT EXISTS burstiness_status text,
  ADD COLUMN IF NOT EXISTS keyword_density numeric,
  ADD COLUMN IF NOT EXISTS keyword_density_status text,
  ADD COLUMN IF NOT EXISTS quality_status text;
