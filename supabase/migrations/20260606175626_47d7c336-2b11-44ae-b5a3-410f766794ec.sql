ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS data_nuggets_coverage numeric,
  ADD COLUMN IF NOT EXISTS persona_deviation numeric,
  ADD COLUMN IF NOT EXISTS h2_warnings jsonb;