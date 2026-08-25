REVOKE ALL ON FUNCTION public.enqueue_article_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_page_seo_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_silo_change() FROM PUBLIC, anon, authenticated;