-- 1) Add 'staff' value to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'staff';

-- 2) Make check_rate_limit() bypass admins and staff entirely so internal
-- employees never hit per-action rate limits (article generation, research,
-- outline, rewrite, radar). All call sites already use this RPC.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id uuid,
  p_action text,
  p_max_requests integer DEFAULT 30,
  p_window_minutes integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_window_start timestamp with time zone;
  v_current_count integer;
BEGIN
  -- Bypass for internal team: admins and staff have no rate limits.
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
      AND role IN ('admin'::app_role, 'staff'::app_role)
  ) THEN
    RETURN true;
  END IF;

  v_window_start := date_trunc('hour', now()) +
    (floor(extract(minute from now()) / p_window_minutes) * p_window_minutes) * interval '1 minute';

  SELECT request_count INTO v_current_count
  FROM public.rate_limits
  WHERE user_id = p_user_id
    AND action = p_action
    AND window_start = v_window_start;

  IF v_current_count IS NULL THEN
    INSERT INTO public.rate_limits (user_id, action, window_start, request_count)
    VALUES (p_user_id, p_action, v_window_start, 1)
    ON CONFLICT (user_id, action, window_start) DO UPDATE SET request_count = rate_limits.request_count + 1;
    RETURN true;
  ELSIF v_current_count >= p_max_requests THEN
    RETURN false;
  ELSE
    UPDATE public.rate_limits
    SET request_count = request_count + 1
    WHERE user_id = p_user_id AND action = p_action AND window_start = v_window_start;
    RETURN true;
  END IF;
END;
$function$;