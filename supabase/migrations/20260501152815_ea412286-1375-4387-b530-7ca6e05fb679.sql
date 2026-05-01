CREATE TABLE public.tier2_backlinks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  article_id UUID REFERENCES public.articles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  external_url TEXT,
  canonical_url TEXT NOT NULL,
  teaser_title TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_tier2_user ON public.tier2_backlinks(user_id);
CREATE INDEX idx_tier2_project ON public.tier2_backlinks(project_id);
CREATE INDEX idx_tier2_article ON public.tier2_backlinks(article_id);

ALTER TABLE public.tier2_backlinks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own tier2 backlinks"
  ON public.tier2_backlinks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own tier2 backlinks"
  ON public.tier2_backlinks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all tier2 backlinks"
  ON public.tier2_backlinks FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role full access tier2"
  ON public.tier2_backlinks FOR ALL
  USING (auth.role() = 'service_role');