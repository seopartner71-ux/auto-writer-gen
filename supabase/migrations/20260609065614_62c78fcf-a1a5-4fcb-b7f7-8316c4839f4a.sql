CREATE OR REPLACE FUNCTION public.add_tracked_keywords(_rows jsonb)
RETURNS TABLE(inserted integer, skipped integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _total integer := 0;
  _inserted integer := 0;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'invalid_rows';
  END IF;

  WITH parsed AS (
    SELECT DISTINCT ON (
      lower(trim(item->>'keyword')),
      lower(trim(item->>'target_domain')),
      lower(trim(COALESCE(item->>'engine', 'google'))),
      lower(trim(COALESCE(item->>'region', 'ru'))),
      lower(trim(COALESCE(item->>'city', '')))
    )
      trim(item->>'keyword') AS keyword,
      lower(trim(item->>'target_domain')) AS target_domain,
      lower(trim(COALESCE(item->>'engine', 'google'))) AS engine,
      lower(trim(COALESCE(item->>'region', 'ru'))) AS region,
      NULLIF(trim(COALESCE(item->>'city', '')), '') AS city
    FROM jsonb_array_elements(_rows) AS item
    WHERE trim(COALESCE(item->>'keyword', '')) <> ''
      AND trim(COALESCE(item->>'target_domain', '')) <> ''
      AND lower(trim(COALESCE(item->>'engine', 'google'))) IN ('google', 'yandex')
  ), counted AS (
    SELECT count(*)::integer AS total FROM parsed
  ), ins AS (
    INSERT INTO public.tracked_keywords (user_id, keyword, target_domain, engine, region, city)
    SELECT _user_id, keyword, target_domain, engine, COALESCE(NULLIF(region, ''), 'ru'), city
    FROM parsed
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT counted.total, count(ins.*)::integer
  INTO _total, _inserted
  FROM counted
  LEFT JOIN ins ON true
  GROUP BY counted.total;

  RETURN QUERY SELECT _inserted, GREATEST(_total - _inserted, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.add_tracked_keywords(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_tracked_keywords(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_tracked_keywords(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_tracked_keywords(jsonb) TO service_role;