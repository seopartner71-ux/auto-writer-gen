
CREATE OR REPLACE FUNCTION public.increment_project_views(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.projects
  SET total_views = COALESCE(total_views, 0) + 1
  WHERE id = p_project_id;
END;
$$;
