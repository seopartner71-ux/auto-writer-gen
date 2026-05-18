DO $$
DECLARE
  jid bigint;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname IN ('rank-tracker-daily','rank-tracker-cron','rank-tracker-every-3-days')
  LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END$$;

SELECT cron.schedule(
  'rank-tracker-every-3-days',
  '0 4 */3 * *',
  $$
  SELECT net.http_post(
    url := 'https://mwcejojlbqpolplshjgj.supabase.co/functions/v1/rank-tracker-run',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
    ),
    body := jsonb_build_object('cron', true)
  );
  $$
);