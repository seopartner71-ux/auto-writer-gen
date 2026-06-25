-- 1) status column on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_status_check') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_status_check
      CHECK (status IN ('pending','active','blocked'));
  END IF;
END $$;

-- Backfill from existing is_active flag (existing active users stay active)
UPDATE public.profiles
SET status = CASE WHEN is_active THEN 'active' ELSE 'pending' END;

-- 2) Trigger that mirrors is_active from status
CREATE OR REPLACE FUNCTION public.sync_profile_status_is_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.is_active := (NEW.status = 'active');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_status_trigger ON public.profiles;
CREATE TRIGGER sync_profile_status_trigger
  BEFORE INSERT OR UPDATE OF status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_status_is_active();

REVOKE EXECUTE ON FUNCTION public.sync_profile_status_is_active() FROM PUBLIC, anon, authenticated;

-- 3) Disable legacy auto-activation cron job
DO $$ BEGIN
  PERFORM cron.unschedule('auto-activate-users');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'auto-activate-users cron not found or already removed';
END $$;

-- 4) Registration toggle in app_settings
INSERT INTO public.app_settings (key, value, description)
VALUES ('registration_enabled', 'true', 'Открыта ли публичная регистрация на /register')
ON CONFLICT (key) DO NOTHING;

-- Public RPC so anon users can read the toggle without broad SELECT on app_settings
CREATE OR REPLACE FUNCTION public.is_registration_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT lower(value) = 'true' FROM public.app_settings WHERE key = 'registration_enabled' LIMIT 1),
    true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_registration_enabled() TO anon, authenticated;