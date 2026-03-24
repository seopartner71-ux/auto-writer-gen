
CREATE POLICY "Deny all inserts on user_roles"
  ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "Deny all updates on user_roles"
  ON public.user_roles FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "Deny all deletes on user_roles"
  ON public.user_roles FOR DELETE
  TO authenticated
  USING (false);
