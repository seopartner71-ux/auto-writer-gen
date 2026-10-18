DO $migration$
DECLARE definition text; old_fragment text := '''bot_names'', COALESCE(jsonb_agg(DISTINCT bot_name ORDER BY bot_name) FILTER (WHERE bot_name IS NOT NULL), ''[]''::jsonb)'; new_fragment text := old_fragment || ', ''http_statuses'', COALESCE((SELECT jsonb_agg(jsonb_build_object(''code'', codes.http_status, ''requests'', codes.requests) ORDER BY codes.http_status NULLS LAST) FROM (SELECT e2.http_status, count(*) AS requests FROM e e2 WHERE e2.kind=''bot'' AND e2.url=e.url GROUP BY e2.http_status) codes), ''[]''::jsonb)';
BEGIN
 SELECT pg_get_functiondef('public.monitor_stats(uuid,timestamptz,timestamptz,text,text)'::regprocedure) INTO definition;
 IF strpos(definition, old_fragment)=0 THEN RAISE EXCEPTION 'Expected monitor_stats aggregation not found'; END IF;
 EXECUTE replace(definition, old_fragment, new_fragment);
END $migration$;