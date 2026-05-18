CREATE OR REPLACE FUNCTION public.deduct_credits_v2(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_model_key text DEFAULT NULL,
  p_article_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_balance integer;
  v_user_plan text;
  v_model_min_plan text;
  v_caller uuid := auth.uid();
  v_is_service boolean := COALESCE((current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role', false);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;

  IF NOT v_is_service
     AND v_caller IS DISTINCT FROM p_user_id
     AND NOT public.has_role(v_caller, 'admin'::app_role)
     AND NOT public.has_role(v_caller, 'staff'::app_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  IF public.has_role(p_user_id, 'admin'::app_role) OR public.has_role(p_user_id, 'staff'::app_role) THEN
    INSERT INTO public.credit_transactions(user_id, amount, balance_after, reason, model_key, article_id, metadata)
    SELECT p_user_id, 0, COALESCE(credits_amount,0), p_reason || ':bypass', p_model_key, p_article_id, p_metadata
    FROM public.profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'bypassed', true);
  END IF;

  IF p_model_key IS NOT NULL THEN
    SELECT COALESCE(plan,'basic') INTO v_user_plan FROM public.profiles WHERE id = p_user_id;
    SELECT min_plan INTO v_model_min_plan FROM public.ai_models WHERE model_key = p_model_key;

    IF v_model_min_plan = 'pro' AND v_user_plan = 'basic' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'plan_required', 'required_plan', 'pro');
    END IF;
  END IF;

  UPDATE public.profiles
  SET credits_amount = credits_amount - p_amount
  WHERE id = p_user_id AND credits_amount >= p_amount
  RETURNING credits_amount INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_credits');
  END IF;

  INSERT INTO public.credit_transactions(user_id, amount, balance_after, reason, model_key, article_id, metadata)
  VALUES (p_user_id, -p_amount, v_new_balance, p_reason, p_model_key, p_article_id, p_metadata);

  RETURN jsonb_build_object('ok', true, 'balance', v_new_balance);
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_credits_v2(uuid, integer, text, text, uuid, jsonb)
  TO authenticated, service_role;