ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS content_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS regenerated_at timestamptz;

CREATE OR REPLACE FUNCTION public.track_article_content_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.content IS DISTINCT FROM OLD.content
     OR NEW.meta_description IS DISTINCT FROM OLD.meta_description THEN
    NEW.content_updated_at := now();
  ELSE
    NEW.content_updated_at := OLD.content_updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS track_article_content_update ON public.articles;
CREATE TRIGGER track_article_content_update
BEFORE UPDATE ON public.articles
FOR EACH ROW
EXECUTE FUNCTION public.track_article_content_update();