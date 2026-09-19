-- Allow admins to delete bot analytics logs (for the "Clear logs" admin button)
ALTER TABLE public.bot_analytics_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can delete bot analytics" ON public.bot_analytics_logs;
CREATE POLICY "Admins can delete bot analytics"
  ON public.bot_analytics_logs
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
