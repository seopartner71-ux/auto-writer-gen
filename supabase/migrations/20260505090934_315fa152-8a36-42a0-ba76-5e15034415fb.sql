ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS turgenev_status text,
  ADD COLUMN IF NOT EXISTS turgenev_details jsonb;