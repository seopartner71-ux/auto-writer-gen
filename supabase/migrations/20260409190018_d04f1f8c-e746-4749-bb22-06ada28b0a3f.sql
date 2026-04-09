CREATE POLICY "Users can update own stats"
ON public.user_stats
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);