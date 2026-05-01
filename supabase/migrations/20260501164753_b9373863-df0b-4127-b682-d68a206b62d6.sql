-- Article rankings tracker (GSC positions per keyword per article)
CREATE TABLE IF NOT EXISTS public.article_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  article_id uuid NOT NULL,
  keyword text NOT NULL,
  position numeric,
  clicks integer DEFAULT 0,
  impressions integer DEFAULT 0,
  ctr numeric DEFAULT 0,
  url text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_article_rankings_user ON public.article_rankings(user_id);
CREATE INDEX IF NOT EXISTS idx_article_rankings_article ON public.article_rankings(article_id);
CREATE INDEX IF NOT EXISTS idx_article_rankings_checked ON public.article_rankings(checked_at DESC);

ALTER TABLE public.article_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own rankings"
ON public.article_rankings FOR SELECT
USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert own rankings"
ON public.article_rankings FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service can manage rankings"
ON public.article_rankings FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Sandbox rate limit table (by IP, no auth)
CREATE TABLE IF NOT EXISTS public.sandbox_rate_limits (
  ip_hash text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT date_trunc('hour', now()),
  request_count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, window_start)
);

ALTER TABLE public.sandbox_rate_limits ENABLE ROW LEVEL SECURITY;
-- Only service role accesses (no policies for authenticated)