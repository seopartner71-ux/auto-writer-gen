
-- Function to update user stats when a new article is created
CREATE OR REPLACE FUNCTION public.update_stats_on_new_article()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_stats (user_id, total_articles_created, last_activity_at)
  VALUES (NEW.user_id, 1, now())
  ON CONFLICT (user_id) DO UPDATE
  SET total_articles_created = user_stats.total_articles_created + 1,
      last_activity_at = now();
  RETURN NEW;
END;
$$;

-- Trigger on articles table
CREATE TRIGGER on_article_created
  AFTER INSERT ON public.articles
  FOR EACH ROW EXECUTE FUNCTION public.update_stats_on_new_article();

-- Also allow service role to insert user_stats rows
CREATE POLICY "Service can insert user stats" ON public.user_stats FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
