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
  -- Skip when the parent project is gone (cascade delete): nothing to deploy.
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pid) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  INSERT INTO public.site_deploy_queue (project_id, entity_type, entity_id, reason, status)
  VALUES (pid, TG_ARGV[0], eid, lower(TG_OP), 'pending');
  RETURN COALESCE(NEW, OLD);
END;
$$;