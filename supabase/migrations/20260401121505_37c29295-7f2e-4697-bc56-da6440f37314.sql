ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS telegraph_path text DEFAULT NULL;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS telegraph_access_token text DEFAULT NULL;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS telegraph_url text DEFAULT NULL;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS anchor_target_url text DEFAULT NULL;