
CREATE TABLE IF NOT EXISTS public.article_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL,
  user_id uuid NOT NULL,
  section_index integer NOT NULL,
  h2_title text NOT NULL,
  prompt text,
  content text DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, section_index)
);

CREATE INDEX IF NOT EXISTS idx_article_sections_article ON public.article_sections(article_id, section_index);
CREATE INDEX IF NOT EXISTS idx_article_sections_user ON public.article_sections(user_id);

ALTER TABLE public.article_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own article sections"
  ON public.article_sections FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all article sections"
  ON public.article_sections FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_article_sections_updated_at
  BEFORE UPDATE ON public.article_sections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.article_sections;
