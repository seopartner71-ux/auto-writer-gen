
-- 1. Setting to toggle per-article TG notifications (off by default)
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'tg_per_article_enabled',
  'false',
  'Отправлять ли Telegram-уведомление на каждую готовую статью. По умолчанию выключено — используется дневной digest.'
)
ON CONFLICT (key) DO NOTHING;

-- 2. Gate per-article trigger on the flag
CREATE OR REPLACE FUNCTION public.tg_trigger_article_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_name text;
  v_domain text;
  v_source text;
  v_enabled text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_enabled FROM public.app_settings WHERE key = 'tg_per_article_enabled';
  IF COALESCE(v_enabled, 'false') <> 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('completed','done','published') THEN
    SELECT email, full_name INTO v_email, v_name FROM public.profiles WHERE id = NEW.user_id;
    SELECT domain INTO v_domain FROM public.projects WHERE id = NEW.project_id;
    v_source := CASE WHEN NEW.content_topic_id IS NOT NULL THEN 'Контент-план' ELSE 'Статьи' END;
    PERFORM public.tg_notify('article_done', jsonb_build_object(
      'user_name', COALESCE(v_name, v_email, '-'),
      'email', v_email,
      'title', NEW.title,
      'domain', COALESCE(v_domain, '-'),
      'source', v_source
    ));
  ELSIF NEW.status IN ('error','failed') THEN
    SELECT email, full_name INTO v_email, v_name FROM public.profiles WHERE id = NEW.user_id;
    PERFORM public.tg_notify('article_error', jsonb_build_object(
      'user_name', COALESCE(v_name, v_email, '-'),
      'email', v_email,
      'title', NEW.title,
      'error', COALESCE(NEW.quality_status, 'unknown')
    ));
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Cron: daily digest at 18:00 UTC = 21:00 МСК
DO $$
DECLARE v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
  LIMIT 1;

  PERFORM cron.unschedule('tg-daily-digest') WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'tg-daily-digest'
  );

  PERFORM cron.schedule(
    'tg-daily-digest',
    '0 18 * * *',
    format($cron$
      SELECT net.http_post(
        url := 'https://mwcejojlbqpolplshjgj.supabase.co/functions/v1/tg-daily-digest',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %s'
        ),
        body := '{}'::jsonb
      ) AS request_id;
    $cron$, COALESCE(v_key, ''))
  );
END $$;
