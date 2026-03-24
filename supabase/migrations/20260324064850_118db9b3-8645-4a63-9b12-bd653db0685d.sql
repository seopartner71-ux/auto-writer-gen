-- Tighten api_keys: replace broad ALL with specific per-operation policies for authenticated only
DROP POLICY IF EXISTS "Only admins can manage api_keys" ON public.api_keys;

CREATE POLICY "Admins can select api_keys"
  ON public.api_keys FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert api_keys"
  ON public.api_keys FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update api_keys"
  ON public.api_keys FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete api_keys"
  ON public.api_keys FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));