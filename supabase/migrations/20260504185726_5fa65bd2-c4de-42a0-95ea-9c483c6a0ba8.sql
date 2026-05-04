
-- SEO tips for showing during article generation
CREATE TABLE public.seo_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  language text NOT NULL DEFAULT 'ru',
  category text NOT NULL DEFAULT 'general',
  tip text NOT NULL,
  source text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seo_tips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active tips"
  ON public.seo_tips FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins manage tips"
  ON public.seo_tips FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_seo_tips_lang_active ON public.seo_tips(language, is_active);
