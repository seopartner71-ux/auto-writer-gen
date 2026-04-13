
-- Add onboarding fields to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_niche text,
  ADD COLUMN IF NOT EXISTS planned_articles_month integer,
  ADD COLUMN IF NOT EXISTS referral_source text;

-- Function to auto-activate users after 2 minutes
CREATE OR REPLACE FUNCTION public.auto_activate_users()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.profiles
  SET is_active = true
  WHERE is_active = false
    AND created_at <= now() - interval '2 minutes';
END;
$$;

-- Enable pg_cron and pg_net if not already
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule auto-activation every minute
SELECT cron.schedule(
  'auto-activate-users',
  '* * * * *',
  $$SELECT public.auto_activate_users();$$
);
