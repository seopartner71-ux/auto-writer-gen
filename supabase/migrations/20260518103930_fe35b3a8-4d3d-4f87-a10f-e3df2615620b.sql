DO $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;

  -- Unschedule existing job if present
  BEGIN
    PERFORM cron.unschedule('quality-check-backfill');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM cron.schedule(
      'quality-check-backfill',
      '*/15 * * * *',
      format(
        $job$SELECT net.http_post(
          url := %L,
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
          body := '{}'::jsonb
        );$job$,
        v_url || '/functions/v1/quality-check-backfill',
        v_key
      )
    );
  END IF;
END $$;