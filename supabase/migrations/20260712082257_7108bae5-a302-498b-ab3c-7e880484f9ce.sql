
ALTER TABLE public.profiles ALTER COLUMN plan SET DEFAULT 'free';
ALTER TABLE public.profiles ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE public.profiles ALTER COLUMN credits_amount SET DEFAULT 3;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_key text;
  v_admin record;
BEGIN
  INSERT INTO public.profiles (
    id, email, full_name, registration_ip, onboarding_niche,
    planned_articles_month, referral_source,
    plan, status, credits_amount
  )
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'registration_ip',
    NEW.raw_user_meta_data->>'onboarding_niche',
    (NEW.raw_user_meta_data->>'planned_articles_month')::integer,
    NEW.raw_user_meta_data->>'referral_source',
    'free',
    'active',
    3
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  FOR v_admin IN
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  LOOP
    INSERT INTO public.notifications (user_id, title, message)
    VALUES (
      v_admin.user_id,
      'Новый пользователь зарегистрирован',
      'Email: ' || COALESCE(NEW.email, '-') || '. Имя: ' || COALESCE(NEW.raw_user_meta_data->>'full_name', 'Не указано') ||
      '. Тематика: ' || COALESCE(NEW.raw_user_meta_data->>'onboarding_niche', '-') ||
      '. Статей/мес: ' || COALESCE(NEW.raw_user_meta_data->>'planned_articles_month', '-') ||
      '. Источник: ' || COALESCE(NEW.raw_user_meta_data->>'referral_source', '-') ||
      '. IP: ' || COALESCE(NEW.raw_user_meta_data->>'registration_ip', '-') ||
      '. Тариф NANO, 3 кредита, активирован автоматически.'
    );
  END LOOP;

  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;

    IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
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
$function$;
