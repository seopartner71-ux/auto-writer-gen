
-- Budget guard: limits Opus usage and total monthly $ cost per user.
-- Admin and staff bypass all checks. Basic plan = no Opus, $3 cap. Pro plan = 12 Opus calls/mo, $25 cap.
CREATE OR REPLACE FUNCTION public.check_ai_budget(_user_id uuid, _model text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_is_priv boolean;
  v_month_cost numeric;
  v_opus_calls int;
  v_cost_cap numeric;
  v_opus_cap int;
  v_is_opus boolean;
BEGIN
  -- Admin/staff bypass everything
  v_is_priv := public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'staff');
  IF v_is_priv THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'privileged', 'monthly_cost', 0, 'opus_calls', 0);
  END IF;

  SELECT COALESCE(plan, 'basic') INTO v_plan FROM profiles WHERE id = _user_id;
  v_plan := COALESCE(v_plan, 'basic');

  -- Tier caps
  IF v_plan = 'pro' THEN
    v_cost_cap := 25.0;
    v_opus_cap := 12;
  ELSIF v_plan = 'factory' THEN
    v_cost_cap := 80.0;
    v_opus_cap := 75;
  ELSE
    v_cost_cap := 3.0;
    v_opus_cap := 0;
  END IF;

  SELECT COALESCE(SUM(cost_usd), 0), COALESCE(SUM(CASE WHEN model ILIKE '%opus%' THEN 1 ELSE 0 END), 0)
    INTO v_month_cost, v_opus_calls
    FROM cost_log
    WHERE user_id = _user_id
      AND created_at >= date_trunc('month', now());

  v_is_opus := COALESCE(_model, '') ILIKE '%opus%';

  IF v_month_cost >= v_cost_cap THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'cost_cap', 'monthly_cost', v_month_cost, 'cost_cap', v_cost_cap, 'opus_calls', v_opus_calls, 'opus_cap', v_opus_cap);
  END IF;

  IF v_is_opus AND v_opus_calls >= v_opus_cap THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'opus_cap', 'monthly_cost', v_month_cost, 'cost_cap', v_cost_cap, 'opus_calls', v_opus_calls, 'opus_cap', v_opus_cap);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', 'ok', 'monthly_cost', v_month_cost, 'cost_cap', v_cost_cap, 'opus_calls', v_opus_calls, 'opus_cap', v_opus_cap);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_ai_budget(uuid, text) TO authenticated, service_role;
