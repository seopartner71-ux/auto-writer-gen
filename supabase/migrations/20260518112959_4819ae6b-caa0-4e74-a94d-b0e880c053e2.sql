
-- 1) Daily cap added to check_ai_budget
CREATE OR REPLACE FUNCTION public.check_ai_budget(_user_id uuid, _model text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan text;
  v_is_priv boolean;
  v_month_cost numeric;
  v_day_cost numeric;
  v_opus_calls int;
  v_cost_cap numeric;
  v_day_cap numeric;
  v_opus_cap int;
  v_is_opus boolean;
BEGIN
  v_is_priv := public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'staff');
  IF v_is_priv THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'privileged');
  END IF;

  SELECT COALESCE(plan, 'basic') INTO v_plan FROM profiles WHERE id = _user_id;
  v_plan := COALESCE(v_plan, 'basic');

  IF v_plan = 'pro' THEN
    v_cost_cap := 25.0; v_day_cap := 5.0; v_opus_cap := 12;
  ELSIF v_plan = 'factory' THEN
    v_cost_cap := 80.0; v_day_cap := 15.0; v_opus_cap := 75;
  ELSE
    v_cost_cap := 3.0; v_day_cap := 1.0; v_opus_cap := 0;
  END IF;

  SELECT COALESCE(SUM(cost_usd), 0), COALESCE(SUM(CASE WHEN model ILIKE '%opus%' THEN 1 ELSE 0 END), 0)
    INTO v_month_cost, v_opus_calls
    FROM cost_log
    WHERE user_id = _user_id AND created_at >= date_trunc('month', now());

  SELECT COALESCE(SUM(cost_usd), 0) INTO v_day_cost
    FROM cost_log
    WHERE user_id = _user_id AND created_at >= date_trunc('day', now());

  v_is_opus := COALESCE(_model, '') ILIKE '%opus%';

  IF v_day_cost >= v_day_cap THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'day_cap',
      'day_cost', v_day_cost, 'day_cap', v_day_cap,
      'monthly_cost', v_month_cost, 'cost_cap', v_cost_cap);
  END IF;

  IF v_month_cost >= v_cost_cap THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'cost_cap',
      'monthly_cost', v_month_cost, 'cost_cap', v_cost_cap,
      'day_cost', v_day_cost, 'day_cap', v_day_cap);
  END IF;

  IF v_is_opus AND v_opus_calls >= v_opus_cap THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'opus_cap',
      'opus_calls', v_opus_calls, 'opus_cap', v_opus_cap);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', 'ok',
    'monthly_cost', v_month_cost, 'cost_cap', v_cost_cap,
    'day_cost', v_day_cost, 'day_cap', v_day_cap,
    'opus_calls', v_opus_calls, 'opus_cap', v_opus_cap);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.check_ai_budget(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_ai_budget(uuid, text) TO authenticated, service_role;

-- 2) Global health: только админ-edge функции (service_role) могут смотреть
CREATE OR REPLACE FUNCTION public.get_openrouter_global_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_day numeric;
  v_hour numeric;
  v_users int;
BEGIN
  SELECT COALESCE(SUM(cost_usd),0), COUNT(DISTINCT user_id)
    INTO v_day, v_users
    FROM cost_log
    WHERE created_at >= date_trunc('day', now());

  SELECT COALESCE(SUM(cost_usd),0) INTO v_hour
    FROM cost_log
    WHERE created_at >= now() - interval '1 hour';

  RETURN jsonb_build_object(
    'day_cost_usd', v_day,
    'hour_cost_usd', v_hour,
    'active_users_today', v_users,
    'checked_at', now()
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_openrouter_global_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_openrouter_global_health() TO service_role;
