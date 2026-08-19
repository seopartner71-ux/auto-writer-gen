ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS custom_domain_status text DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS custom_domain_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS custom_domain_error text;

CREATE OR REPLACE FUNCTION public.enqueue_site_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
  eid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    pid := OLD.project_id; eid := OLD.id;
  ELSE
    pid := NEW.project_id; eid := NEW.id;
  END IF;
  IF pid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  INSERT INTO public.site_deploy_queue (project_id, entity_type, entity_id, reason, status)
  VALUES (pid, TG_ARGV[0], eid, lower(TG_OP), 'pending');
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS enqueue_site_products ON public.site_products;
CREATE TRIGGER enqueue_site_products
AFTER INSERT OR UPDATE OR DELETE ON public.site_products
FOR EACH ROW EXECUTE FUNCTION public.enqueue_site_change('product');

DROP TRIGGER IF EXISTS enqueue_site_clusters ON public.site_clusters;
CREATE TRIGGER enqueue_site_clusters
AFTER INSERT OR UPDATE OR DELETE ON public.site_clusters
FOR EACH ROW EXECUTE FUNCTION public.enqueue_site_change('category');

DROP TRIGGER IF EXISTS enqueue_site_silos ON public.site_silos;
CREATE TRIGGER enqueue_site_silos
AFTER INSERT OR UPDATE OR DELETE ON public.site_silos
FOR EACH ROW EXECUTE FUNCTION public.enqueue_site_change('silo');