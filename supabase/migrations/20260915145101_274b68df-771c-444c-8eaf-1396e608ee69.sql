CREATE INDEX IF NOT EXISTS idx_keywords_user_id ON public.keywords (user_id);
CREATE INDEX IF NOT EXISTS idx_keywords_user_intent ON public.keywords (user_id, intent);
CREATE INDEX IF NOT EXISTS idx_articles_user_created ON public.articles (user_id, created_at DESC);

UPDATE public.site_deploy_queue
SET status = 'cancelled'
WHERE status = 'pending' AND created_at < now() - interval '2 days';