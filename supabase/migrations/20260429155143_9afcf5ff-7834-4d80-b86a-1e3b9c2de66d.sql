-- Allow deleting projects by cascading related data
ALTER TABLE public.articles DROP CONSTRAINT IF EXISTS articles_project_id_fkey;
ALTER TABLE public.articles ADD CONSTRAINT articles_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

-- Clean orphan-prone tables on project delete via trigger (no FK to avoid type mismatch)
CREATE OR REPLACE FUNCTION public.cleanup_project_related()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.analytics_logs WHERE project_id = OLD.id;
  DELETE FROM public.radar_analysis_runs WHERE project_id = OLD.id;
  DELETE FROM public.radar_keywords WHERE project_id = OLD.id;
  DELETE FROM public.radar_prompt_groups WHERE project_id = OLD.id;
  DELETE FROM public.radar_prompts WHERE project_id = OLD.id;
  DELETE FROM public.site_post_schedule_logs WHERE project_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_project_related ON public.projects;
CREATE TRIGGER trg_cleanup_project_related
BEFORE DELETE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.cleanup_project_related();