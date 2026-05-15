
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS source_page_url text;

CREATE TABLE IF NOT EXISTS public.source_page_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  url text NOT NULL,
  facts jsonb,
  raw_text text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, url)
);

CREATE INDEX IF NOT EXISTS idx_source_page_cache_user_url ON public.source_page_cache (user_id, url);
CREATE INDEX IF NOT EXISTS idx_source_page_cache_expires ON public.source_page_cache (expires_at);

ALTER TABLE public.source_page_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own source page cache"
  ON public.source_page_cache FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can insert own source page cache"
  ON public.source_page_cache FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own source page cache"
  ON public.source_page_cache FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own source page cache"
  ON public.source_page_cache FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_source_page_cache_updated_at
  BEFORE UPDATE ON public.source_page_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
