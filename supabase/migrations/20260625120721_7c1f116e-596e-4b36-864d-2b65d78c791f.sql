
-- ===== Telegram notifications: helper, triggers, cron =====

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Helper: fire-and-forget POST to telegram-notify edge function
CREATE OR REPLACE FUNCTION public.tg_notify(_type text, _data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := 'https://mwcejojlbqpolplshjgj.supabase.co/functions/v1/telegram-notify';
  v_key text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_key := NULL;
  END;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_key, '')
    ),
    body := jsonb_build_object('type', _type, 'data', _data)
  );
EXCEPTION WHEN OTHERS THEN
  -- never break business logic on TG failure
  NULL;
END;
$$;

-- ===== 1 & 7. Articles: done / error =====
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
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
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

DROP TRIGGER IF EXISTS tg_articles_status_notify ON public.articles;
CREATE TRIGGER tg_articles_status_notify
AFTER UPDATE OF status ON public.articles
FOR EACH ROW EXECUTE FUNCTION public.tg_trigger_article_status();

-- ===== 2. New registration (profiles insert with status='pending') =====
CREATE OR REPLACE FUNCTION public.tg_trigger_new_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.status, '') = 'pending' THEN
    PERFORM public.tg_notify('new_registration', jsonb_build_object(
      'full_name', COALESCE(NEW.full_name, '-'),
      'email', NEW.email
    ));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_profiles_insert_notify ON public.profiles;
CREATE TRIGGER tg_profiles_insert_notify
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_trigger_new_profile();

-- ===== 3, 5, 6. Profiles update: activation, low/no credits =====
CREATE OR REPLACE FUNCTION public.tg_trigger_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 3) pending -> active
  IF COALESCE(OLD.status,'') = 'pending' AND NEW.status = 'active' THEN
    PERFORM public.tg_notify('user_activated', jsonb_build_object(
      'full_name', COALESCE(NEW.full_name,'-'),
      'email', NEW.email
    ));
  END IF;

  -- 5, 6) credits thresholds
  IF NEW.credits_amount IS DISTINCT FROM OLD.credits_amount THEN
    IF COALESCE(OLD.credits_amount,0) > 0 AND COALESCE(NEW.credits_amount,0) = 0 THEN
      PERFORM public.tg_notify('no_credits', jsonb_build_object(
        'full_name', COALESCE(NEW.full_name,'-'),
        'email', NEW.email
      ));
    ELSIF COALESCE(OLD.credits_amount,0) >= 10
      AND COALESCE(NEW.credits_amount,0) < 10
      AND COALESCE(NEW.credits_amount,0) > 0 THEN
      PERFORM public.tg_notify('low_credits', jsonb_build_object(
        'full_name', COALESCE(NEW.full_name,'-'),
        'email', NEW.email,
        'balance', NEW.credits_amount
      ));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_profiles_update_notify ON public.profiles;
CREATE TRIGGER tg_profiles_update_notify
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_trigger_profile_update();

-- ===== 8. Content plan responded =====
CREATE OR REPLACE FUNCTION public.tg_trigger_plan_responded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_domain text;
  v_ok int;
  v_rev int;
  v_no int;
BEGIN
  IF NEW.client_responded_at IS NOT NULL
     AND OLD.client_responded_at IS NULL THEN
    SELECT name, domain INTO v_name, v_domain
      FROM public.content_clients WHERE id = NEW.client_id;
    IF v_name IS NULL THEN
      SELECT name, domain INTO v_name, v_domain
        FROM public.projects WHERE id = NEW.project_id;
    END IF;

    SELECT
      COUNT(*) FILTER (WHERE status='ok'),
      COUNT(*) FILTER (WHERE status='rev'),
      COUNT(*) FILTER (WHERE status='no')
    INTO v_ok, v_rev, v_no
    FROM public.content_topics WHERE plan_id = NEW.id;

    PERFORM public.tg_notify('plan_responded', jsonb_build_object(
      'client_name', COALESCE(v_name,'-'),
      'domain', COALESCE(v_domain,'-'),
      'month', NEW.month,
      'year', NEW.year,
      'ok', COALESCE(v_ok,0),
      'rev', COALESCE(v_rev,0),
      'no', COALESCE(v_no,0)
    ));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_plans_responded_notify ON public.content_plans;
CREATE TRIGGER tg_plans_responded_notify
AFTER UPDATE ON public.content_plans
FOR EACH ROW EXECUTE FUNCTION public.tg_trigger_plan_responded();

-- ===== 9. Stuck queue checker (called by cron every 5 min) =====
CREATE OR REPLACE FUNCTION public.tg_check_stuck_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.id, t.title, t.updated_at, c.name AS client_name
    FROM public.content_topics t
    LEFT JOIN public.content_plans p ON p.id = t.plan_id
    LEFT JOIN public.content_clients c ON c.id = p.client_id
    WHERE t.gen_status = 'processing'
      AND t.updated_at < now() - interval '10 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM public.error_logs e
        WHERE e.context = 'tg_stuck_queue:' || t.id::text
          AND e.created_at > now() - interval '1 hour'
      )
  LOOP
    INSERT INTO public.error_logs(context, message)
    VALUES ('tg_stuck_queue:'||r.id::text, 'alert sent');
    PERFORM public.tg_notify('stuck_queue', jsonb_build_object(
      'title', r.title,
      'client_name', COALESCE(r.client_name,'-'),
      'minutes', EXTRACT(EPOCH FROM (now() - r.updated_at))/60
    ));
  END LOOP;
END;
$$;

-- ===== 10. Daily summary (called by cron at 17:00 UTC = 20:00 MSK) =====
CREATE OR REPLACE FUNCTION public.tg_send_daily_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day_start timestamptz := date_trunc('day', (now() AT TIME ZONE 'Europe/Moscow')) AT TIME ZONE 'Europe/Moscow';
  v_articles_today int;
  v_new_pending int;
  v_activated int;
  v_credits_spent int;
  v_payments_count int;
  v_payments_sum numeric;
  v_errors int;
  v_total_active int;
  v_total_articles int;
BEGIN
  SELECT COUNT(*) INTO v_articles_today
    FROM public.articles
    WHERE status IN ('completed','done','published')
      AND COALESCE(updated_at, created_at) >= v_day_start;

  SELECT COUNT(*) INTO v_new_pending
    FROM public.profiles
    WHERE created_at >= v_day_start AND status = 'pending';

  SELECT COUNT(*) INTO v_activated
    FROM public.profiles
    WHERE status = 'active' AND updated_at >= v_day_start;

  SELECT COALESCE(SUM(-amount), 0) INTO v_credits_spent
    FROM public.credit_transactions
    WHERE amount < 0 AND created_at >= v_day_start;

  SELECT COUNT(*), COALESCE(SUM(amount_rub), 0)
    INTO v_payments_count, v_payments_sum
    FROM public.payment_logs
    WHERE status = 'success' AND created_at >= v_day_start;

  SELECT COUNT(*) INTO v_errors
    FROM public.articles
    WHERE status IN ('error','failed')
      AND COALESCE(updated_at, created_at) >= v_day_start;

  SELECT COUNT(*) INTO v_total_active FROM public.profiles WHERE status = 'active';
  SELECT COUNT(*) INTO v_total_articles FROM public.articles
    WHERE status IN ('completed','done','published');

  PERFORM public.tg_notify('daily_summary', jsonb_build_object(
    'articles_today', v_articles_today,
    'new_pending', v_new_pending,
    'activated', v_activated,
    'credits_spent', v_credits_spent,
    'payments_count', v_payments_count,
    'payments_sum', v_payments_sum,
    'errors', v_errors,
    'total_active', v_total_active,
    'total_articles', v_total_articles
  ));
END;
$$;

-- ===== Cron jobs =====
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tg-stuck-queue') THEN
    PERFORM cron.unschedule('tg-stuck-queue');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tg-daily-summary') THEN
    PERFORM cron.unschedule('tg-daily-summary');
  END IF;
END $$;

SELECT cron.schedule(
  'tg-stuck-queue',
  '*/5 * * * *',
  $$ SELECT public.tg_check_stuck_queue(); $$
);

SELECT cron.schedule(
  'tg-daily-summary',
  '0 17 * * *',
  $$ SELECT public.tg_send_daily_summary(); $$
);
