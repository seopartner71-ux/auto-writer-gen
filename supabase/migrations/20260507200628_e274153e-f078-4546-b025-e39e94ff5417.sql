
-- 1) Project-level fields for search engine ping tracking
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS indexnow_key text,
  ADD COLUMN IF NOT EXISTS last_search_ping_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_search_ping_status text;

-- Backfill IndexNow keys for existing projects
UPDATE public.projects
SET indexnow_key = replace(gen_random_uuid()::text, '-', '')
WHERE indexnow_key IS NULL;

-- 2) Detailed log of every ping
CREATE TABLE IF NOT EXISTS public.search_engine_pings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid,
  article_id uuid,
  url text NOT NULL,
  provider text NOT NULL,        -- 'google' | 'yandex' | 'indexnow'
  status text NOT NULL,          -- 'success' | 'error' | 'deprecated'
  response_code int,
  response_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_engine_pings_project ON public.search_engine_pings(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_engine_pings_user ON public.search_engine_pings(user_id, created_at DESC);

ALTER TABLE public.search_engine_pings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own pings"
  ON public.search_engine_pings FOR SELECT
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert own pings"
  ON public.search_engine_pings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins manage all pings"
  ON public.search_engine_pings FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
