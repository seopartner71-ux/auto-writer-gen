ALTER TABLE public.keywords ADD COLUMN IF NOT EXISTS competitor_tables jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.keywords ADD COLUMN IF NOT EXISTS competitor_lists jsonb DEFAULT '[]'::jsonb;