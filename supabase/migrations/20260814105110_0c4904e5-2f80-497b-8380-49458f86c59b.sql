ALTER TABLE public.personas
  ADD COLUMN IF NOT EXISTS author_profile_id uuid REFERENCES public.author_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_personas_author_profile ON public.personas(author_profile_id);