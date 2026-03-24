
-- 1. Add deny policies on rate_limits for authenticated users
CREATE POLICY "Deny select on rate_limits" ON public.rate_limits FOR SELECT TO authenticated USING (false);
CREATE POLICY "Deny insert on rate_limits" ON public.rate_limits FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "Deny update on rate_limits" ON public.rate_limits FOR UPDATE TO authenticated USING (false);
CREATE POLICY "Deny delete on rate_limits" ON public.rate_limits FOR DELETE TO authenticated USING (false);

-- 2. Drop old PERMISSIVE false policies on user_roles
DROP POLICY IF EXISTS "Deny all inserts on user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Deny all updates on user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Deny all deletes on user_roles" ON public.user_roles;

-- 3. Create RESTRICTIVE policies on user_roles (cannot be overridden by any PERMISSIVE policy)
CREATE POLICY "Restrict inserts on user_roles" ON public.user_roles AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "Restrict updates on user_roles" ON public.user_roles AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);
CREATE POLICY "Restrict deletes on user_roles" ON public.user_roles AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
