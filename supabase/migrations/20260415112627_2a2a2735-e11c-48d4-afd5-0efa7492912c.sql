
-- Add GitHub fields to projects table
ALTER TABLE public.projects
ADD COLUMN github_token text DEFAULT NULL,
ADD COLUMN github_repo text DEFAULT NULL;

-- Function for edge functions to read GitHub config (security definer, bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_project_github_config(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_repo text;
BEGIN
  SELECT github_token, github_repo INTO v_token, v_repo
  FROM public.projects
  WHERE id = p_project_id;

  IF v_token IS NULL OR v_repo IS NULL THEN
    RETURN jsonb_build_object('configured', false);
  END IF;

  RETURN jsonb_build_object(
    'configured', true,
    'github_token', v_token,
    'github_repo', v_repo
  );
END;
$$;
