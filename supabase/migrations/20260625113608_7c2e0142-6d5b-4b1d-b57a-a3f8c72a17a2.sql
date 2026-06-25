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
      'x-content-plan-drain', 'cpq_20260625_1136_4f9d7a9e8b0c42b6'
    ),
    body := '{}'::jsonb
  );
  $$
);