ALTER TABLE public.keywords ADD COLUMN IF NOT EXISTS language text DEFAULT 'ru';
ALTER TABLE public.keywords ADD COLUMN IF NOT EXISTS geo text DEFAULT 'ru';