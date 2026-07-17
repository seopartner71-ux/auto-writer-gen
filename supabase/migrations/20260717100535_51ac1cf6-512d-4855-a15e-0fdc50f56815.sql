
CREATE OR REPLACE FUNCTION public.notify_author_share()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author_name text;
  v_owner_email text;
BEGIN
  SELECT name INTO v_author_name FROM public.author_profiles WHERE id = NEW.author_profile_id;
  SELECT email INTO v_owner_email FROM public.profiles WHERE id = NEW.owner_id;

  INSERT INTO public.notifications (user_id, title, message, is_read)
  VALUES (
    NEW.shared_with_user_id,
    'Вам открыли доступ к автору',
    COALESCE(v_owner_email, 'Пользователь') || ' поделился с вами автором «' || COALESCE(v_author_name, 'без названия') || '». Автор доступен в разделе «Авторы».',
    false
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_author_share ON public.author_profile_shares;
CREATE TRIGGER trg_notify_author_share
AFTER INSERT ON public.author_profile_shares
FOR EACH ROW
EXECUTE FUNCTION public.notify_author_share();
