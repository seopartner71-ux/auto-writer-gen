
DROP POLICY IF EXISTS "Users can insert own articles" ON public.articles;
CREATE POLICY "Users can insert own articles"
  ON public.articles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (is_ab_test = false OR public.has_role(auth.uid(), 'admin'::app_role))
  );

DROP POLICY IF EXISTS "Users can delete own articles" ON public.articles;
CREATE POLICY "Users can delete own articles"
  ON public.articles
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND (is_ab_test = false OR public.has_role(auth.uid(), 'admin'::app_role))
  );
