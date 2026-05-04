
CREATE TABLE public.benchmark_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  keyword_id uuid NOT NULL,
  data jsonb NOT NULL,
  context text NOT NULL,
  instructions text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, keyword_id)
);

CREATE INDEX idx_benchmark_cache_lookup ON public.benchmark_cache(user_id, keyword_id);
CREATE INDEX idx_benchmark_cache_expires ON public.benchmark_cache(expires_at);

ALTER TABLE public.benchmark_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own benchmark cache"
  ON public.benchmark_cache FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert own benchmark cache"
  ON public.benchmark_cache FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own benchmark cache"
  ON public.benchmark_cache FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own benchmark cache"
  ON public.benchmark_cache FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
