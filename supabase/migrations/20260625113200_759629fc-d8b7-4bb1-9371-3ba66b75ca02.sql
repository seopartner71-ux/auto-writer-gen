DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'content-plan-drain-queue') THEN
    PERFORM cron.unschedule('content-plan-drain-queue');
  END IF;
END $$;

SELECT cron.schedule(
  'content-plan-drain-queue',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://mwcejojlbqpolplshjgj.supabase.co/functions/v1/content-plan-process-next',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);