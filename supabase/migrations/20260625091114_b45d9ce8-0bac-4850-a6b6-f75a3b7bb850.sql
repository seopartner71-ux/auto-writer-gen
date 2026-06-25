
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS content_topic_id uuid REFERENCES public.content_topics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_articles_source ON public.articles(source);
CREATE INDEX IF NOT EXISTS idx_articles_content_topic ON public.articles(content_topic_id);

ALTER TABLE public.content_topics
  ADD COLUMN IF NOT EXISTS article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.sync_content_topic_from_article()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_done_statuses text[] := ARRAY['completed','published','done'];
  v_error_statuses text[] := ARRAY['failed','error'];
BEGIN
  IF NEW.content_topic_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_status := COALESCE(NEW.status, '');

  IF v_status = ANY(v_done_statuses) THEN
    UPDATE public.content_topics
       SET gen_status   = 'done',
           article_id   = NEW.id,
           article_title = COALESCE(NEW.title, article_title),
           generated_at = COALESCE(generated_at, now()),
           gen_error    = NULL,
           updated_at   = now()
     WHERE id = NEW.content_topic_id;
  ELSIF v_status = ANY(v_error_statuses) THEN
    UPDATE public.content_topics
       SET gen_status = 'error',
           gen_error  = COALESCE(NULLIF(NEW.quality_status, ''), gen_error, 'error'),
           updated_at = now()
     WHERE id = NEW.content_topic_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_content_topic_from_article ON public.articles;
CREATE TRIGGER trg_sync_content_topic_from_article
AFTER INSERT OR UPDATE OF status, content_topic_id ON public.articles
FOR EACH ROW
WHEN (NEW.content_topic_id IS NOT NULL)
EXECUTE FUNCTION public.sync_content_topic_from_article();
