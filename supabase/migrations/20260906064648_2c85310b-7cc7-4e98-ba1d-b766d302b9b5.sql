-- lovable-cron-fallback-reviewed: 1440 runs/day; wake-on-enqueue via trigger and unschedule-after-drain by the worker, so the job exists only while the generation queue is non-empty
CREATE OR REPLACE FUNCTION public.commerce_content_worker_wake()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'commerce-content-worker-tick') THEN
    PERFORM cron.schedule(
      'commerce-content-worker-tick',
      '* * * * *',
      $job$
      SELECT net.http_post(
        url := 'https://mwcejojlbqpolplshjgj.supabase.co/functions/v1/commerce-content-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT secret_value FROM public.internal_cron_secrets WHERE name = 'commerce_content_worker' LIMIT 1)
        ),
        body := '{}'::jsonb
      );
      $job$
    );
  END IF;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.commerce_content_worker_wake() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_content_worker_wake() TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_content_worker_sleep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.commerce_content_autorun WHERE enabled AND status IN ('idle','running')) THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'commerce-content-worker-tick') THEN
    PERFORM cron.unschedule('commerce-content-worker-tick');
  END IF;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.commerce_content_worker_sleep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_content_worker_sleep() TO service_role;

CREATE OR REPLACE FUNCTION public.commerce_content_autorun_wake_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.enabled AND NEW.status IN ('idle','running') THEN
    PERFORM public.commerce_content_worker_wake();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS commerce_content_autorun_wake ON public.commerce_content_autorun;
CREATE TRIGGER commerce_content_autorun_wake
  AFTER INSERT OR UPDATE OF enabled, status ON public.commerce_content_autorun
  FOR EACH ROW EXECUTE FUNCTION public.commerce_content_autorun_wake_trg();