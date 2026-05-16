
-- 1. Расширяем ai_models
ALTER TABLE public.ai_models 
  ADD COLUMN IF NOT EXISTS credit_cost integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS min_plan text NOT NULL DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS description text;

-- Базовые цены (стоимость 1 статьи ~3000 знаков)
UPDATE public.ai_models SET credit_cost = 1, min_plan = 'basic'
  WHERE model_key IN ('google/gemini-2.5-flash-lite','google/gemini-2.5-flash','google/gemini-3-flash-preview','openai/gpt-5-nano');
UPDATE public.ai_models SET credit_cost = 3, min_plan = 'basic' WHERE model_key = 'google/gemini-2.5-pro';
UPDATE public.ai_models SET credit_cost = 5, min_plan = 'pro' WHERE model_key = 'anthropic/claude-sonnet-4';
UPDATE public.ai_models SET credit_cost = 6, min_plan = 'pro' WHERE model_key IN ('openai/gpt-5','openai/gpt-5-mini');
UPDATE public.ai_models SET credit_cost = 15, min_plan = 'pro' WHERE model_key = 'anthropic/claude-opus-4';

-- 2. Журнал транзакций
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount integer NOT NULL,
  balance_after integer NOT NULL,
  reason text NOT NULL,
  model_key text,
  article_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_tx_user_created ON public.credit_transactions(user_id, created_at DESC);

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own credit tx" ON public.credit_transactions;
CREATE POLICY "Users view own credit tx" ON public.credit_transactions
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "No client writes credit tx" ON public.credit_transactions;
CREATE POLICY "No client writes credit tx" ON public.credit_transactions
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- 3. RPC: расчёт цены генерации
CREATE OR REPLACE FUNCTION public.calculate_generation_cost(
  p_model_key text,
  p_length integer DEFAULT 3000,
  p_stealth boolean DEFAULT false,
  p_images integer DEFAULT 0,
  p_deep_research boolean DEFAULT false,
  p_fact_check boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_base int;
  v_min_plan text;
  v_mult numeric := 1.0;
  v_total numeric;
  v_cap int := 999;
BEGIN
  SELECT credit_cost, min_plan INTO v_base, v_min_plan
  FROM public.ai_models WHERE model_key = p_model_key AND is_active = true;
  
  IF v_base IS NULL THEN
    v_base := 5; v_min_plan := 'basic';
  END IF;
  
  -- Множитель за объём
  IF p_length > 10000 THEN v_mult := 3.0;
  ELSIF p_length > 6000 THEN v_mult := 2.0;
  ELSIF p_length > 3000 THEN v_mult := 1.5;
  END IF;
  
  v_total := v_base * v_mult;
  IF p_stealth THEN v_total := v_total * 1.5; END IF;
  v_total := v_total
    + COALESCE(p_images, 0)
    + (CASE WHEN p_deep_research THEN 1 ELSE 0 END)
    + (CASE WHEN p_fact_check THEN 1 ELSE 0 END);
  
  RETURN jsonb_build_object(
    'credits', GREATEST(1, CEIL(v_total)::int),
    'base', v_base,
    'length_multiplier', v_mult,
    'min_plan', v_min_plan,
    'breakdown', jsonb_build_object(
      'model', v_base,
      'length_x', v_mult,
      'stealth', p_stealth,
      'images', COALESCE(p_images,0),
      'research', p_deep_research,
      'fact_check', p_fact_check
    )
  );
END;
$$;

-- 4. RPC: атомарное списание + лог
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
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;
  
  -- Admin/staff bypass
  IF public.has_role(p_user_id, 'admin'::app_role) OR public.has_role(p_user_id, 'staff'::app_role) THEN
    INSERT INTO public.credit_transactions(user_id, amount, balance_after, reason, model_key, article_id, metadata)
    SELECT p_user_id, 0, COALESCE(credits_amount,0), p_reason || ':bypass', p_model_key, p_article_id, p_metadata
    FROM public.profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'bypassed', true);
  END IF;
  
  -- Проверка plan vs model
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

-- 5. RPC: возврат кредитов
CREATE OR REPLACE FUNCTION public.refund_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_article_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance int;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;
  
  UPDATE public.profiles SET credits_amount = COALESCE(credits_amount,0) + p_amount
  WHERE id = p_user_id RETURNING credits_amount INTO v_balance;
  
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'user_not_found');
  END IF;
  
  INSERT INTO public.credit_transactions(user_id, amount, balance_after, reason, article_id, metadata)
  VALUES (p_user_id, p_amount, v_balance, p_reason, p_article_id, p_metadata);
  
  RETURN jsonb_build_object('ok', true, 'balance', v_balance);
END;
$$;

-- 6. Гранты
GRANT EXECUTE ON FUNCTION public.calculate_generation_cost(text,integer,boolean,integer,boolean,boolean) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.deduct_credits_v2(uuid,integer,text,text,uuid,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refund_credits(uuid,integer,text,uuid,jsonb) TO authenticated, service_role;
