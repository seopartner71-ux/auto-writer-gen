
-- 1. Fix user_stats: restrict UPDATE to only last_activity_at
DROP POLICY IF EXISTS "Users can update own stats" ON public.user_stats;
CREATE POLICY "Users can update own activity"
  ON public.user_stats
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create trigger to prevent client from changing counters
CREATE OR REPLACE FUNCTION public.protect_user_stats_counters()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Preserve server-managed fields, only allow last_activity_at changes from client
  NEW.total_articles_created := OLD.total_articles_created;
  NEW.total_words_generated := OLD.total_words_generated;
  NEW.average_content_score := OLD.average_content_score;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_stats_counters ON public.user_stats;
CREATE TRIGGER protect_stats_counters
  BEFORE UPDATE ON public.user_stats
  FOR EACH ROW
  WHEN (current_setting('role') != 'service_role')
  EXECUTE FUNCTION public.protect_user_stats_counters();

-- 2. Add notifications DELETE policy for own read notifications
CREATE POLICY "Users can delete own notifications"
  ON public.notifications
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 3. Add UPDATE policy for article-images storage
CREATE POLICY "Users can update own article images"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'article-images' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'article-images' AND auth.uid()::text = (storage.foldername(name))[1]);
