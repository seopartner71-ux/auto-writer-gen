
CREATE TABLE IF NOT EXISTS public.page_visits (
  id bigserial PRIMARY KEY,
  page text NOT NULL,
  visited_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NULL,
  session_key text NULL,
  user_agent text NULL,
  referrer text NULL
);

CREATE INDEX IF NOT EXISTS idx_page_visits_page_time ON public.page_visits (page, visited_at DESC);

GRANT INSERT ON public.page_visits TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.page_visits_id_seq TO anon, authenticated;
GRANT SELECT ON public.page_visits TO authenticated;
GRANT ALL ON public.page_visits TO service_role;

ALTER TABLE public.page_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can insert page visits"
  ON public.page_visits FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "admins can view page visits"
  ON public.page_visits FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.get_page_visit_stats(p_page text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT jsonb_build_object(
    'today',     COUNT(*) FILTER (WHERE visited_at >= date_trunc('day', now())),
    'yesterday', COUNT(*) FILTER (WHERE visited_at >= date_trunc('day', now()) - interval '1 day'
                                    AND visited_at <  date_trunc('day', now())),
    'week',      COUNT(*) FILTER (WHERE visited_at >= now() - interval '7 days'),
    'month',     COUNT(*) FILTER (WHERE visited_at >= now() - interval '30 days'),
    'total',     COUNT(*),
    'unique_today',  COUNT(DISTINCT session_key) FILTER (WHERE visited_at >= date_trunc('day', now())),
    'unique_month',  COUNT(DISTINCT session_key) FILTER (WHERE visited_at >= now() - interval '30 days'),
    'unique_total',  COUNT(DISTINCT session_key)
  ) INTO v_result
  FROM public.page_visits
  WHERE page = p_page;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_page_visit_stats(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_page_visit_daily(p_page text, p_days int DEFAULT 30)
RETURNS TABLE(day date, visits bigint, uniques bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    (visited_at AT TIME ZONE 'UTC')::date AS day,
    COUNT(*)::bigint AS visits,
    COUNT(DISTINCT session_key)::bigint AS uniques
  FROM public.page_visits
  WHERE page = p_page
    AND visited_at >= now() - (p_days || ' days')::interval
  GROUP BY 1
  ORDER BY 1 DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_page_visit_daily(text, int) TO authenticated;
