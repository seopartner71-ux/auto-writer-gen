ALTER TABLE public.keywords
  ADD COLUMN IF NOT EXISTS must_cover_topics text[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS content_gaps jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS recommended_headings text[] DEFAULT NULL;