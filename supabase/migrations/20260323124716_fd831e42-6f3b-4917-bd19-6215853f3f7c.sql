
-- Add credits column to profiles
ALTER TABLE public.profiles ADD COLUMN credits_amount integer NOT NULL DEFAULT 0;

-- Function to deduct 1 credit atomically, returns true if successful
CREATE OR REPLACE FUNCTION public.deduct_credit(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rows_affected integer;
BEGIN
  UPDATE public.profiles
  SET credits_amount = credits_amount - 1
  WHERE id = p_user_id AND credits_amount > 0;
  
  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RETURN rows_affected > 0;
END;
$$;

-- Function to check credit balance
CREATE OR REPLACE FUNCTION public.check_credits(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(credits_amount, 0) FROM public.profiles WHERE id = p_user_id;
$$;
