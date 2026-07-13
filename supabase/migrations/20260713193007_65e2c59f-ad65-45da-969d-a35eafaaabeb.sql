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
  v_cost_cap numeric;
  v_day_cap numeric;
BEGIN
  v_is_priv := public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'staff');
  IF v_is_priv THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'privileged');
  END IF;

  SELECT COALESCE(plan, 'nano') INTO v_plan FROM profiles WHERE id = _user_id;
  v_plan := lower(COALESCE(v_plan, 'nano'));

  -- Real DB plan mapping: nano=NANO, basic=PRO, pro=FACTORY.
  -- Thresholds synced with plan price (курс 90).
  IF v_plan IN ('basic', 'pro_paid', 'pro-plan') THEN
    v_cost_cap := 30.0; v_day_cap := 5.0;   -- PRO
  ELSIF v_plan IN ('pro', 'factory', 'business', 'enterprise') THEN
    v_cost_cap := 100.0; v_day_cap := 15.0; -- FACTORY
  ELSE
    v_cost_cap := 12.0; v_day_cap := 2.0;   -- NANO
  END IF;

  SELECT COALESCE(SUM(cost_usd), 0) INTO v_month_cost
    FROM cost_log
    WHERE user_id = _user_id AND created_at >= date_trunc('month', now());

  SELECT COALESCE(SUM(cost_usd), 0) INTO v_day_cost
    FROM cost_log
    WHERE user_id = _user_id AND created_at >= date_trunc('day', now());

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

  RETURN jsonb_build_object('allowed', true, 'reason', 'ok',
    'monthly_cost', v_month_cost, 'cost_cap', v_cost_cap,
    'day_cost', v_day_cost, 'day_cap', v_day_cap);
END;
$function$;