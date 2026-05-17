
CREATE TABLE IF NOT EXISTS public.onboarding_email_log (
  user_id uuid NOT NULL,
  day integer NOT NULL CHECK (day IN (1, 3, 7)),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.onboarding_email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view onboarding email log"
ON public.onboarding_email_log FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Schedule hourly run of the onboarding sequence dispatcher
DO $$
DECLARE
  v_url text;
  v_key text;
  v_jobid bigint;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'Skip cron: missing vault secrets';
    RETURN;
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'send-onboarding-sequence-hourly';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'send-onboarding-sequence-hourly',
    '17 * * * *',
    format($cron$
      select net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{}'::jsonb
      ) as request_id;
    $cron$,
      v_url || '/functions/v1/send-onboarding-sequence',
      jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key)::text
    )
  );
END $$;
