DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.monitor_stats(uuid,timestamp with time zone,timestamp with time zone,text,text)'::regprocedure) INTO definition;
  IF position('''bots'', count(DISTINCT bot_name)' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected bot page aggregation not found';
  END IF;
  definition := replace(definition, '''bots'', count(DISTINCT bot_name)', '''bots'', count(DISTINCT bot_name), ''bot_names'', COALESCE(jsonb_agg(DISTINCT bot_name ORDER BY bot_name) FILTER (WHERE bot_name IS NOT NULL), ''[]''::jsonb)');
  EXECUTE definition;
END;
$migration$;