
ALTER TABLE public.article_versions
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS word_count integer;

UPDATE public.article_versions av
SET user_id = a.user_id
FROM public.articles a
WHERE av.article_id = a.id AND av.user_id IS NULL;

ALTER TABLE public.article_versions ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_article_versions_article ON public.article_versions(article_id, created_at DESC);

ALTER TABLE public.article_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own versions" ON public.article_versions;
DROP POLICY IF EXISTS "Users insert own versions" ON public.article_versions;
DROP POLICY IF EXISTS "Users delete own versions" ON public.article_versions;

CREATE POLICY "Users view own versions"
  ON public.article_versions FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert own versions"
  ON public.article_versions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own versions"
  ON public.article_versions FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
