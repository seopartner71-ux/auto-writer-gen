CREATE TABLE public.monitor_bot_verify_cache (
  ip TEXT PRIMARY KEY,
  ua_pattern TEXT NOT NULL,
  result TEXT NOT NULL,
  rdns_host TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.monitor_bot_verify_cache TO service_role;
ALTER TABLE public.monitor_bot_verify_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read verify cache" ON public.monitor_bot_verify_cache
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.monitor_stats(p_site uuid, p_from timestamptz, p_to timestamptz, p_kind text DEFAULT NULL, p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE r jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  WITH e AS (
    SELECT * FROM monitor_events
    WHERE NOT is_test AND occurred_at >= p_from AND occurred_at < p_to
      AND (p_site IS NULL OR site_id = p_site)
      AND (p_kind IS NULL OR kind = p_kind)
      AND (p_name IS NULL OR bot_name = p_name OR source_name = p_name)
  )
  SELECT jsonb_build_object(
    'bot_requests', (SELECT count(*) FROM e WHERE kind='bot'),
    'bot_unique_urls', (SELECT count(DISTINCT url) FROM e WHERE kind='bot'),
    'referral_visits', (SELECT count(*) FROM e WHERE kind='referral'),
    'referral_visitors', (SELECT count(DISTINCT visitor_hash) FROM e WHERE kind='referral' AND visitor_hash IS NOT NULL),
    'referral_sources', (SELECT count(DISTINCT source_name) FROM e WHERE kind='referral'),
    'last_event_at', (SELECT max(received_at) FROM e),
    'daily', COALESCE((SELECT jsonb_agg(d ORDER BY d->>'day') FROM (
        SELECT jsonb_build_object('day', to_char(date_trunc('day', occurred_at),'YYYY-MM-DD'),
          'bot', count(*) FILTER (WHERE kind='bot'), 'referral', count(*) FILTER (WHERE kind='referral')) d
        FROM e GROUP BY date_trunc('day', occurred_at)) x), '[]'::jsonb),
    'bots', COALESCE((SELECT jsonb_agg(b ORDER BY (b->>'requests')::int DESC) FROM (
        SELECT jsonb_build_object('name', bot_name, 'category', max(bot_category), 'requests', count(*),
          'unique_urls', count(DISTINCT url), 'last', max(occurred_at),
          'verified', count(*) FILTER (WHERE bot_verified='verified'),
          'spoofed', count(*) FILTER (WHERE bot_verified='spoofed'),
          'unknown', count(*) FILTER (WHERE bot_verified='unknown' OR bot_verified IS NULL)) b
        FROM e WHERE kind='bot' GROUP BY bot_name) x), '[]'::jsonb),
    'bot_pages', COALESCE((SELECT jsonb_agg(p ORDER BY (p->>'requests')::int DESC) FROM (
        SELECT jsonb_build_object('url', url, 'requests', count(*), 'bots', count(DISTINCT bot_name),
          'bot_names', COALESCE(jsonb_agg(DISTINCT bot_name ORDER BY bot_name) FILTER (WHERE bot_name IS NOT NULL), '[]'::jsonb),
          'verified', count(*) FILTER (WHERE bot_verified='verified'),
          'spoofed', count(*) FILTER (WHERE bot_verified='spoofed'),
          'http_statuses', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', codes.http_status, 'requests', codes.requests) ORDER BY codes.http_status NULLS LAST) FROM (SELECT e2.http_status, count(*) AS requests FROM e e2 WHERE e2.kind='bot' AND e2.url=e.url GROUP BY e2.http_status) codes), '[]'::jsonb)) p
        FROM e WHERE kind='bot' GROUP BY url ORDER BY count(*) DESC LIMIT 50) x), '[]'::jsonb),
    'sources', COALESCE((SELECT jsonb_agg(s ORDER BY (s->>'visits')::int DESC) FROM (
        SELECT jsonb_build_object('name', source_name, 'visits', count(*),
          'visitors', count(DISTINCT visitor_hash), 'last', max(occurred_at),
          'detection', string_agg(DISTINCT detection, ', ')) s
        FROM e WHERE kind='referral' GROUP BY source_name) x), '[]'::jsonb),
    'landing_pages', COALESCE((SELECT jsonb_agg(p ORDER BY (p->>'visits')::int DESC) FROM (
        SELECT jsonb_build_object('url', url, 'visits', count(*), 'sources', string_agg(DISTINCT source_name, ', ')) p
        FROM e WHERE kind='referral' GROUP BY url ORDER BY count(*) DESC LIMIT 50) x), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END $fn$;