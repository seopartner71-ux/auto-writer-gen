
-- Rate limiting table for per-user API throttling
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  window_start timestamp with time zone NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1,
  UNIQUE (user_id, action, window_start)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Only service role can manage rate limits (edge functions use service role)
-- No user-facing policies needed

-- Function to check and increment rate limit
-- Returns true if request is ALLOWED, false if rate limited
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id uuid,
  p_action text,
  p_max_requests integer DEFAULT 30,
  p_window_minutes integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_window_start timestamp with time zone;
  v_current_count integer;
BEGIN
  -- Calculate window start (truncate to nearest window)
  v_window_start := date_trunc('hour', now()) + 
    (floor(extract(minute from now()) / p_window_minutes) * p_window_minutes) * interval '1 minute';
  
  -- Get current count for this window
  SELECT request_count INTO v_current_count
  FROM public.rate_limits
  WHERE user_id = p_user_id 
    AND action = p_action 
    AND window_start = v_window_start;
  
  IF v_current_count IS NULL THEN
    -- First request in this window
    INSERT INTO public.rate_limits (user_id, action, window_start, request_count)
    VALUES (p_user_id, p_action, v_window_start, 1)
    ON CONFLICT (user_id, action, window_start) DO UPDATE SET request_count = rate_limits.request_count + 1;
    RETURN true;
  ELSIF v_current_count >= p_max_requests THEN
    -- Rate limited
    RETURN false;
  ELSE
    -- Increment
    UPDATE public.rate_limits
    SET request_count = request_count + 1
    WHERE user_id = p_user_id AND action = p_action AND window_start = v_window_start;
    RETURN true;
  END IF;
END;
$$;

-- Cleanup old rate limit records (run periodically)
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '2 hours';
$$;
