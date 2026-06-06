
CREATE TABLE public.pipeline_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  article_id UUID,
  stage TEXT NOT NULL,
  verdict TEXT,
  score NUMERIC,
  duration_ms INTEGER,
  model TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost_usd NUMERIC DEFAULT 0,
  error_kind TEXT,
  error_message TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_events_created_at ON public.pipeline_events (created_at DESC);
CREATE INDEX idx_pipeline_events_stage ON public.pipeline_events (stage, created_at DESC);
CREATE INDEX idx_pipeline_events_article ON public.pipeline_events (article_id) WHERE article_id IS NOT NULL;
CREATE INDEX idx_pipeline_events_user ON public.pipeline_events (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_pipeline_events_verdict ON public.pipeline_events (verdict) WHERE verdict IS NOT NULL;

GRANT SELECT ON public.pipeline_events TO authenticated;
GRANT ALL ON public.pipeline_events TO service_role;

ALTER TABLE public.pipeline_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own pipeline events"
  ON public.pipeline_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins see all pipeline events"
  ON public.pipeline_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Service role inserts pipeline events"
  ON public.pipeline_events FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Aggregated health view for admin dashboard (last 24h).
CREATE OR REPLACE FUNCTION public.pipeline_health_24h()
RETURNS TABLE (
  stage TEXT,
  total BIGINT,
  passes BIGINT,
  warnings BIGINT,
  fails BIGINT,
  errors BIGINT,
  avg_score NUMERIC,
  avg_duration_ms NUMERIC,
  p95_duration_ms NUMERIC,
  total_cost_usd NUMERIC
)
LANGUAGE SQL
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    stage,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE verdict = 'pass') AS passes,
    COUNT(*) FILTER (WHERE verdict = 'warning') AS warnings,
    COUNT(*) FILTER (WHERE verdict = 'fail') AS fails,
    COUNT(*) FILTER (WHERE error_kind IS NOT NULL) AS errors,
    ROUND(AVG(score)::numeric, 1) AS avg_score,
    ROUND(AVG(duration_ms)::numeric, 0) AS avg_duration_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::numeric, 0) AS p95_duration_ms,
    ROUND(SUM(cost_usd)::numeric, 4) AS total_cost_usd
  FROM public.pipeline_events
  WHERE created_at >= now() - interval '24 hours'
  GROUP BY stage
  ORDER BY total DESC;
$$;

GRANT EXECUTE ON FUNCTION public.pipeline_health_24h() TO authenticated;
