
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
  INSERT INTO public.profiles (id, email, full_name, registration_ip)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'registration_ip'
  );
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  -- Create in-app notification for all admins
  FOR v_admin IN
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  LOOP
    INSERT INTO public.notifications (user_id, title, message)
    VALUES (
      v_admin.user_id,
      '🆕 Новый пользователь ждёт активации',
      'Email: ' || COALESCE(NEW.email, '—') || '. Имя: ' || COALESCE(NEW.raw_user_meta_data->>'full_name', 'Не указано') || '. IP: ' || COALESCE(NEW.raw_user_meta_data->>'registration_ip', '—') || '. Перейдите во вкладку «Пользователи» для активации.'
    );
  END LOOP;

  -- Send Telegram notification (non-blocking)
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
            'ip', NEW.raw_user_meta_data->>'registration_ip'
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
