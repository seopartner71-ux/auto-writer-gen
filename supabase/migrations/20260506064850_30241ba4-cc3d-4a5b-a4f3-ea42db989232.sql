ALTER TABLE public.article_audits ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DELETE FROM public.article_audits a
USING public.article_audits b
WHERE a.user_id = b.user_id
  AND a.url = b.url
  AND a.created_at < b.created_at;

DROP POLICY IF EXISTS "Users update own audits" ON public.article_audits;
CREATE POLICY "Users update own audits" ON public.article_audits
  FOR UPDATE USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_audits_user_url ON public.article_audits(user_id, url);