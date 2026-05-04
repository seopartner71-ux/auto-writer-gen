
-- Background jobs
CREATE TABLE public.background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  article_id uuid,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  progress integer NOT NULL DEFAULT 0,
  payload jsonb,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX idx_bg_jobs_user ON public.background_jobs(user_id, created_at DESC);
CREATE INDEX idx_bg_jobs_article ON public.background_jobs(article_id);
ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_bg_jobs_select" ON public.background_jobs
  FOR SELECT USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "own_bg_jobs_insert" ON public.background_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_bg_jobs_update" ON public.background_jobs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own_bg_jobs_delete" ON public.background_jobs
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_bg_jobs_updated
  BEFORE UPDATE ON public.background_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.background_jobs;

-- SERP positions
CREATE TABLE public.serp_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  article_id uuid NOT NULL,
  keyword text NOT NULL,
  position integer,
  url text,
  search_engine text NOT NULL DEFAULT 'google',
  region text NOT NULL DEFAULT 'ru',
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_serp_article ON public.serp_positions(article_id, checked_at DESC);
CREATE INDEX idx_serp_user ON public.serp_positions(user_id, checked_at DESC);
ALTER TABLE public.serp_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_serp_select" ON public.serp_positions
  FOR SELECT USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "own_serp_insert" ON public.serp_positions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_serp_delete" ON public.serp_positions
  FOR DELETE USING (auth.uid() = user_id);

-- Article comments
CREATE TABLE public.article_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  article_id uuid NOT NULL,
  selected_text text,
  comment text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_article ON public.article_comments(article_id, created_at DESC);
ALTER TABLE public.article_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_comments_select" ON public.article_comments
  FOR SELECT USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "own_comments_insert" ON public.article_comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_comments_update" ON public.article_comments
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own_comments_delete" ON public.article_comments
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_comments_updated
  BEFORE UPDATE ON public.article_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
