-- Annual pricing columns
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS price_rub_annual integer,
  ADD COLUMN IF NOT EXISTS price_usd_annual integer;

-- NANO: 1900 -> 2490, и заполняем годовые -20%
UPDATE public.subscription_plans SET price_rub = 2490, price_usd = 25 WHERE id = 'free';

UPDATE public.subscription_plans
SET price_rub_annual = ROUND(price_rub * 12 * 0.80)::int,
    price_usd_annual = ROUND(price_usd * 12 * 0.80)::int
WHERE price_rub IS NOT NULL;

-- Стартовые кредиты 2 (вместо 3) + окно авто-активации 1 минута
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
  v_admin record;
BEGIN
  INSERT INTO public.profiles (id, email, full_name, registration_ip, onboarding_niche, planned_articles_month, referral_source, credits_amount)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'registration_ip',
    NEW.raw_user_meta_data->>'onboarding_niche',
    (NEW.raw_user_meta_data->>'planned_articles_month')::integer,
    NEW.raw_user_meta_data->>'referral_source',
    2
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  FOR v_admin IN
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  LOOP
    INSERT INTO public.notifications (user_id, title, message)
    VALUES (
      v_admin.user_id,
      'Новый пользователь ждет активации',
      'Email: ' || COALESCE(NEW.email, '-') || '. Имя: ' || COALESCE(NEW.raw_user_meta_data->>'full_name', 'Не указано') ||
      '. Тематика: ' || COALESCE(NEW.raw_user_meta_data->>'onboarding_niche', '-') ||
      '. Статей/мес: ' || COALESCE(NEW.raw_user_meta_data->>'planned_articles_month', '-') ||
      '. Источник: ' || COALESCE(NEW.raw_user_meta_data->>'referral_source', '-') ||
      '. IP: ' || COALESCE(NEW.raw_user_meta_data->>'registration_ip', '-') ||
      '. Аккаунт активируется автоматически через 1 минуту.'
    );
  END LOOP;

  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;

    IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := v_url || '/functions/v1/telegram-notify',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key
        ),
        body := jsonb_build_object(
          'type', 'new_registration',
          'data', jsonb_build_object(
            'email', NEW.email,
            'full_name', NEW.raw_user_meta_data->>'full_name',
            'ip', NEW.raw_user_meta_data->>'registration_ip',
            'niche', NEW.raw_user_meta_data->>'onboarding_niche',
            'planned_articles', NEW.raw_user_meta_data->>'planned_articles_month',
            'referral_source', NEW.raw_user_meta_data->>'referral_source'
          )
        )
      );

      PERFORM net.http_post(
        url := v_url || '/functions/v1/send-transactional-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key
        ),
        body := jsonb_build_object(
          'templateName', 'admin-new-user',
          'templateData', jsonb_build_object(
            'email', NEW.email,
            'fullName', COALESCE(NEW.raw_user_meta_data->>'full_name', '-'),
            'niche', COALESCE(NEW.raw_user_meta_data->>'onboarding_niche', '-'),
            'plannedArticles', COALESCE(NEW.raw_user_meta_data->>'planned_articles_month', '-'),
            'referralSource', COALESCE(NEW.raw_user_meta_data->>'referral_source', '-'),
            'ip', COALESCE(NEW.raw_user_meta_data->>'registration_ip', '-'),
            'registeredAt', to_char(now() AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD HH24:MI') || ' MSK'
          )
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_activate_users()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET is_active = true
  WHERE is_active = false
    AND created_at <= now() - interval '1 minute';
END;
$$;