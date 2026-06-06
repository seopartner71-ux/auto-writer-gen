
CREATE TABLE public.article_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  problem_type text NOT NULL DEFAULT 'none'
    CHECK (problem_type IN ('none','factual','style','structure','length','repetition','off_topic','other')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, user_id)
);

CREATE INDEX article_feedback_article_id_idx ON public.article_feedback(article_id);
CREATE INDEX article_feedback_user_id_idx ON public.article_feedback(user_id);
CREATE INDEX article_feedback_created_at_idx ON public.article_feedback(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.article_feedback TO authenticated;
GRANT ALL ON public.article_feedback TO service_role;

ALTER TABLE public.article_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own feedback"
  ON public.article_feedback
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all feedback"
  ON public.article_feedback
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_article_feedback_updated_at
  BEFORE UPDATE ON public.article_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
