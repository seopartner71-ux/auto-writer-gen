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
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13Y2Vqb2psYnFwb2xwbHNoamdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTM5ODIsImV4cCI6MjA4OTY2OTk4Mn0.J9VPQi7CIudwmbXJw4vr8WjIrplVdNU5o5X06bliulU',
      'x-content-plan-drain', '1'
    ),
    body := '{}'::jsonb
  );
  $$
);