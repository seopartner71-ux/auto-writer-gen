-- Part A: producers for articles and page_seo -------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_article_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  aid uuid;
  pid uuid;
BEGIN
  aid := COALESCE(NEW.id, OLD.id);
  -- Only articles that are actually published as a Site Factory page matter:
  -- page_registry is the source of truth for "this article is a page".
  SELECT r.project_id INTO pid
  FROM public.page_registry r
  WHERE r.entity_type = 'article' AND r.entity_id = aid
  LIMIT 1;
  IF pid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  INSERT INTO public.site_deploy_queue (project_id, entity_type, entity_id, reason, status)
  VALUES (pid, 'article', aid, lower(TG_OP), 'pending');
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_article_change ON public.articles;
CREATE TRIGGER trg_enqueue_article_change
AFTER INSERT OR UPDATE OR DELETE ON public.articles
FOR EACH ROW EXECUTE FUNCTION public.enqueue_article_change();

CREATE OR REPLACE FUNCTION public.enqueue_page_seo_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rid uuid;
  pid uuid;
BEGIN
  rid := COALESCE(NEW.registry_id, OLD.registry_id);
  pid := COALESCE(NEW.project_id, OLD.project_id);
  IF rid IS NULL AND pid IS NOT NULL THEN
    SELECT r.id INTO rid FROM public.page_registry r
    WHERE r.project_id = pid AND r.url_path = COALESCE(NEW.url_path, OLD.url_path)
    LIMIT 1;
  END IF;
  IF rid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF pid IS NULL THEN
    SELECT r.project_id INTO pid FROM public.page_registry r WHERE r.id = rid;
  END IF;
  IF pid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pid) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- entity_id here is the page_registry row id, matched by planRebuild via
  -- the "seo:<registry id>" key.
  INSERT INTO public.site_deploy_queue (project_id, entity_type, entity_id, reason, status)
  VALUES (pid, 'seo', rid, lower(TG_OP), 'pending');
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_page_seo_change ON public.page_seo;
CREATE TRIGGER trg_enqueue_page_seo_change
AFTER INSERT OR UPDATE OR DELETE ON public.page_seo
FOR EACH ROW EXECUTE FUNCTION public.enqueue_page_seo_change();

-- Part B: silo structural vs cosmetic ---------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_silo_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  pid uuid;
  eid uuid;
  kind text;
BEGIN
  IF TG_OP = 'DELETE' THEN pid := OLD.project_id; eid := OLD.id;
  ELSE pid := NEW.project_id; eid := NEW.id; END IF;
  IF pid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pid) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.slug IS NOT DISTINCT FROM OLD.slug
     AND NEW.position IS NOT DISTINCT FROM OLD.position
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.hub_article_id IS NOT DISTINCT FROM OLD.hub_article_id
  THEN
    kind := 'cosmetic';
  ELSE
    kind := 'structural';
  END IF;
  INSERT INTO public.site_deploy_queue (project_id, entity_type, entity_id, reason, status)
  VALUES (pid, 'silo', eid, kind, 'pending');
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS enqueue_site_change_silo ON public.site_silos;
DROP TRIGGER IF EXISTS trg_enqueue_site_change_silos ON public.site_silos;
DROP TRIGGER IF EXISTS trg_enqueue_silo_change ON public.site_silos;
CREATE TRIGGER trg_enqueue_silo_change
AFTER INSERT OR UPDATE OR DELETE ON public.site_silos
FOR EACH ROW EXECUTE FUNCTION public.enqueue_silo_change();