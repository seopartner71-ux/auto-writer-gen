CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.internal_cron_secrets (
  name text PRIMARY KEY,
  secret_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.internal_cron_secrets TO service_role;

ALTER TABLE public.internal_cron_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No client access to internal cron secrets" ON public.internal_cron_secrets;
CREATE POLICY "No client access to internal cron secrets"
  ON public.internal_cron_secrets FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

INSERT INTO public.internal_cron_secrets (name, secret_value)
VALUES ('document_jobs_worker', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'document-jobs-worker-tick') THEN
    PERFORM cron.unschedule('document-jobs-worker-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'document-jobs-worker-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://mwcejojlbqpolplshjgj.supabase.co/functions/v1/document-jobs-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT secret_value FROM public.internal_cron_secrets WHERE name = 'document_jobs_worker' LIMIT 1),
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13Y2Vqb2psYnFwb2xwbHNoamdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTM5ODIsImV4cCI6MjA4OTY2OTk4Mn0.J9VPQi7CIudwmbXJw4vr8WjIrplVdNU5o5X06bliulU'
    ),
    body := '{}'::jsonb
  );
  $$
);

UPDATE public.document_generation_jobs
SET status = 'queued', attempts = 0, last_error = null, claimed_at = null, completed_at = null, updated_at = now()
WHERE status = 'failed'
  AND (COALESCE(last_error, '') ILIKE '%invalid token%' OR COALESCE(last_error, '') ILIKE '%Unauthorized%');

UPDATE public.ecosystem_formats ef
SET status = 'queued', progress = 0, error_reason = null, updated_at = now()
FROM public.document_generation_jobs j
WHERE j.ecosystem_format_id = ef.id
  AND j.status = 'queued'
  AND ef.status IN ('queued','generating','failed');