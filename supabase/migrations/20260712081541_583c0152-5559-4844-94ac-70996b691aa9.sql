CREATE OR REPLACE FUNCTION public.log_registered_activation_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.activation_events (user_id, event_name, session_id, metadata)
  VALUES (
    NEW.id,
    'registered',
    'server',
    jsonb_build_object(
      'niche', NEW.onboarding_niche,
      'planned_articles', NEW.planned_articles_month,
      'referral_source', NEW.referral_source
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_registered_activation ON public.profiles;
CREATE TRIGGER trg_log_registered_activation
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.log_registered_activation_event();