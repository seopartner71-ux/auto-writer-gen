CREATE TABLE IF NOT EXISTS public.article_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  storage_path text NOT NULL,
  public_url text NOT NULL,
  prompt text,
  visual_prompt text,
  model text DEFAULT 'schnell',
  aspect_ratio text DEFAULT '16:9',
  style text,
  mode text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_article_images_user_created
  ON public.article_images(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_images_article
  ON public.article_images(article_id);

ALTER TABLE public.article_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own images"
  ON public.article_images FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins see all images"
  ON public.article_images FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));
