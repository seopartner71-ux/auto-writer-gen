
-- Fix: restrict usage_logs insert to authenticated users inserting their own logs
DROP POLICY "Service can insert usage logs" ON public.usage_logs;
CREATE POLICY "Users can insert own usage logs" ON public.usage_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
