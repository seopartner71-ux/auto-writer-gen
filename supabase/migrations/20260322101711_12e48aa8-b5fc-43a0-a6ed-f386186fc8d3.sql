
-- Indexing logs table
CREATE TABLE public.indexing_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  article_id uuid REFERENCES public.articles(id) ON DELETE CASCADE,
  url text NOT NULL,
  provider text NOT NULL, -- 'google' or 'indexnow'
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'success', 'error'
  response_message text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.indexing_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own indexing logs" ON public.indexing_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own indexing logs" ON public.indexing_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- GSC key storage on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gsc_json_key text;
