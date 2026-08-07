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
  ELSIF OLD.content_updated_at IS NULL THEN
    NEW.content_updated_at := COALESCE(NEW.content_updated_at, OLD.created_at);
  ELSE
    NEW.content_updated_at := OLD.content_updated_at;
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.articles
SET content_updated_at = created_at
WHERE content_updated_at IS NULL;