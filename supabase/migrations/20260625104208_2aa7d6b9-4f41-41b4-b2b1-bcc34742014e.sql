ALTER TABLE public.content_topics ADD COLUMN IF NOT EXISTS description text;

-- Update RPC to include description in payload
CREATE OR REPLACE FUNCTION public.get_content_plan_by_uuid(p_uuid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan record;
  v_proj_name text; v_proj_domain text; v_proj_id uuid;
  v_topics jsonb;
BEGIN
  SELECT * INTO v_plan FROM public.content_plans WHERE public_uuid = p_uuid;
  IF v_plan.id IS NULL THEN RETURN NULL; END IF;

  IF v_plan.client_id IS NOT NULL THEN
    SELECT id, name, domain INTO v_proj_id, v_proj_name, v_proj_domain
      FROM public.content_clients WHERE id = v_plan.client_id;
  ELSE
    SELECT id, name, domain INTO v_proj_id, v_proj_name, v_proj_domain
      FROM public.projects WHERE id = v_plan.project_id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id, 'tab', t.tab, 'position', t.position, 'title', t.title,
    'status', t.status, 'comment', t.comment, 'description', t.description
  ) ORDER BY t.tab, t.position, t.created_at), '[]'::jsonb)
  INTO v_topics
  FROM public.content_topics t WHERE t.plan_id = v_plan.id;

  RETURN jsonb_build_object(
    'plan', jsonb_build_object(
      'id', v_plan.id, 'month', v_plan.month, 'year', v_plan.year,
      'status', v_plan.status, 'public_uuid', v_plan.public_uuid,
      'client_responded_at', v_plan.client_responded_at
    ),
    'project', jsonb_build_object('id', v_proj_id, 'name', v_proj_name, 'domain', v_proj_domain),
    'topics', v_topics
  );
END;
$function$;