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

  SELECT COALESCE(plan, 'free') INTO v_plan FROM profiles WHERE id = _user_id;
  v_plan := lower(COALESCE(v_plan, 'free'));

  -- Real DB plan mapping: free=NANO, basic=PRO, pro=FACTORY.
  -- Also accept marketing aliases for forward-compat.
  IF v_plan IN ('basic', 'pro_paid', 'pro-plan') THEN
    v_cost_cap := 25.0; v_day_cap := 5.0; v_opus_cap := 12;   -- PRO
  ELSIF v_plan IN ('pro', 'factory', 'business', 'enterprise') THEN
    v_cost_cap := 80.0; v_day_cap := 15.0; v_opus_cap := 75;  -- FACTORY
  ELSE
    v_cost_cap := 3.0; v_day_cap := 1.0; v_opus_cap := 0;     -- NANO/free
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