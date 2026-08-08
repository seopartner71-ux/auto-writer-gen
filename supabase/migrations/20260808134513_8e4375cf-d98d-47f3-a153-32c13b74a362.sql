CREATE OR REPLACE FUNCTION public.track_article_content_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.content IS DISTINCT FROM OLD.content
     OR NEW.meta_description IS DISTINCT FROM OLD.meta_description THEN
    NEW.content_updated_at := now();
  ELSIF NEW.content_updated_at IS DISTINCT FROM OLD.content_updated_at THEN
    RETURN NEW;
  ELSE
    NEW.content_updated_at := OLD.content_updated_at;
  END IF;
  RETURN NEW;
END;
$function$;