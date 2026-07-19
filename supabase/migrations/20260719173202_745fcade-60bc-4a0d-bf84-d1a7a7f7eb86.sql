ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS narration_person text NULL;
ALTER TABLE public.articles DROP CONSTRAINT IF EXISTS articles_narration_person_check;
ALTER TABLE public.articles ADD CONSTRAINT articles_narration_person_check CHECK (narration_person IS NULL OR narration_person IN ('ya','my'));