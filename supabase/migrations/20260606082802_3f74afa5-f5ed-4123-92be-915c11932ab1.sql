
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
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role)) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT
    pe.stage,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE pe.verdict = 'pass') AS passes,
    COUNT(*) FILTER (WHERE pe.verdict = 'warning') AS warnings,
    COUNT(*) FILTER (WHERE pe.verdict = 'fail') AS fails,
    COUNT(*) FILTER (WHERE pe.error_kind IS NOT NULL) AS errors,
    ROUND(AVG(pe.score)::numeric, 1) AS avg_score,
    ROUND(AVG(pe.duration_ms)::numeric, 0) AS avg_duration_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY pe.duration_ms)::numeric, 0) AS p95_duration_ms,
    ROUND(SUM(pe.cost_usd)::numeric, 4) AS total_cost_usd
  FROM public.pipeline_events pe
  WHERE pe.created_at >= now() - interval '24 hours'
  GROUP BY pe.stage
  ORDER BY total DESC;
END;
$$;
