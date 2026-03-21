
CREATE TABLE public.scheduled_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  keyword_id uuid REFERENCES public.keywords(id) ON DELETE CASCADE NOT NULL,
  author_profile_id uuid REFERENCES public.author_profiles(id) ON DELETE SET NULL,
  scheduled_at timestamp with time zone NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.scheduled_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scheduled generations"
  ON public.scheduled_generations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scheduled generations"
  ON public.scheduled_generations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scheduled generations"
  ON public.scheduled_generations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own scheduled generations"
  ON public.scheduled_generations FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all scheduled generations"
  ON public.scheduled_generations FOR ALL
  USING (true)
  WITH CHECK (true);
