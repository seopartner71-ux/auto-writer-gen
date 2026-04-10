
-- 1. Fix profiles: restrict INSERT/UPDATE to authenticated only
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- 2. Fix rate_limits: replace PERMISSIVE deny with RESTRICTIVE
DROP POLICY IF EXISTS "Deny delete on rate_limits" ON public.rate_limits;
DROP POLICY IF EXISTS "Deny insert on rate_limits" ON public.rate_limits;
DROP POLICY IF EXISTS "Deny select on rate_limits" ON public.rate_limits;
DROP POLICY IF EXISTS "Deny update on rate_limits" ON public.rate_limits;

CREATE POLICY "Restrict select on rate_limits"
  ON public.rate_limits AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (false);

CREATE POLICY "Restrict insert on rate_limits"
  ON public.rate_limits AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY "Restrict update on rate_limits"
  ON public.rate_limits AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY "Restrict delete on rate_limits"
  ON public.rate_limits AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (false);

-- 3. Add serp_results DELETE/UPDATE for own keywords
CREATE POLICY "Users can update serp results for own keywords"
  ON public.serp_results
  FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM keywords k WHERE k.id = serp_results.keyword_id AND k.user_id = auth.uid()));

CREATE POLICY "Users can delete serp results for own keywords"
  ON public.serp_results
  FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM keywords k WHERE k.id = serp_results.keyword_id AND k.user_id = auth.uid()));
