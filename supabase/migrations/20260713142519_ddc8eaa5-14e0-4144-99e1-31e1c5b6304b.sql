CREATE OR REPLACE FUNCTION public.get_funnel_sources(_since timestamptz DEFAULT NULL)
RETURNS TABLE(source text, registrations bigint, first_sessions bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  WITH ev AS (
    SELECT
      COALESCE(NULLIF(LOWER(ae.metadata->>'source'), ''), 'direct') AS source,
      ae.user_id,
      ae.event_name
    FROM public.activation_events ae
    INNER JOIN public.profiles p ON p.id = ae.user_id
    WHERE (_since IS NULL OR ae.created_at >= _since)
      AND ae.event_name IN ('registration_completed', 'first_session_start')
  )
  SELECT
    ev.source,
    COUNT(DISTINCT ev.user_id) FILTER (WHERE ev.event_name = 'registration_completed')::bigint AS registrations,
    COUNT(DISTINCT ev.user_id) FILTER (WHERE ev.event_name = 'first_session_start')::bigint  AS first_sessions
  FROM ev
  GROUP BY ev.source
  ORDER BY registrations DESC, first_sessions DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_funnel_sources(timestamptz) TO authenticated;