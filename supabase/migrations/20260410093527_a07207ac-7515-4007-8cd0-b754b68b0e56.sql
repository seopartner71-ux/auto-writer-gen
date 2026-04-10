
-- 1. Fix public article access: replace broad policy with column-restricted approach
-- Move telegraph tokens to separate table
CREATE TABLE IF NOT EXISTS public.article_telegraph_tokens (
  article_id uuid PRIMARY KEY REFERENCES public.articles(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.article_telegraph_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own telegraph tokens"
  ON public.article_telegraph_tokens
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.articles a WHERE a.id = article_telegraph_tokens.article_id AND a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.articles a WHERE a.id = article_telegraph_tokens.article_id AND a.user_id = auth.uid()));

-- Migrate existing tokens
INSERT INTO public.article_telegraph_tokens (article_id, access_token)
SELECT id, telegraph_access_token FROM public.articles
WHERE telegraph_access_token IS NOT NULL AND telegraph_access_token != ''
ON CONFLICT (article_id) DO NOTHING;

-- 2. Fix FAQ policies to include anon
DROP POLICY IF EXISTS "Anyone can view published faq articles" ON public.faq_articles;
CREATE POLICY "Anyone can view published faq articles"
  ON public.faq_articles
  FOR SELECT
  TO public
  USING (is_published = true);

DROP POLICY IF EXISTS "Anyone can view faq categories" ON public.faq_categories;
CREATE POLICY "Anyone can view faq categories"
  ON public.faq_categories
  FOR SELECT
  TO public
  USING (true);
