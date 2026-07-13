
CREATE OR REPLACE FUNCTION public.get_funnel_stats(_since timestamptz DEFAULT NULL)
RETURNS TABLE(event_name text, total bigint, unique_users bigint)
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
  SELECT
    ae.event_name::text,
    COUNT(*)::bigint AS total,
    COUNT(DISTINCT ae.user_id)::bigint AS unique_users
  FROM public.activation_events ae
  INNER JOIN public.profiles p ON p.id = ae.user_id
  WHERE (_since IS NULL OR ae.created_at >= _since)
  GROUP BY ae.event_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_funnel_orphans(_since timestamptz DEFAULT NULL)
RETURNS TABLE(orphan_users bigint, orphan_events bigint, real_registrations bigint)
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
  WITH regs AS (
    SELECT ae.user_id, (p.id IS NOT NULL) AS has_profile
    FROM public.activation_events ae
    LEFT JOIN public.profiles p ON p.id = ae.user_id
    WHERE ae.event_name = 'registered'
      AND (_since IS NULL OR ae.created_at >= _since)
  )
  SELECT
    COUNT(*) FILTER (WHERE NOT has_profile)::bigint AS orphan_users,
    COUNT(*) FILTER (WHERE NOT has_profile)::bigint AS orphan_events,
    COUNT(*) FILTER (WHERE has_profile)::bigint AS real_registrations
  FROM regs;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_funnel_stats(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_funnel_orphans(timestamptz) TO authenticated;
