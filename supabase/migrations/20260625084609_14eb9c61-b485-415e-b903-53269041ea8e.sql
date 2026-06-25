
-- 1. content_clients
CREATE TABLE public.content_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text NOT NULL,
  niche text,
  contact_email text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_clients TO authenticated;
GRANT ALL ON public.content_clients TO service_role;
ALTER TABLE public.content_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage content_clients" ON public.content_clients FOR ALL
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'staff'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'staff'::app_role));
CREATE TRIGGER trg_content_clients_updated_at
BEFORE UPDATE ON public.content_clients
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. content_plans: optional project_id + new client_id
ALTER TABLE public.content_plans ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE public.content_plans ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.content_clients(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_content_plans_client ON public.content_plans(client_id);

-- 3. content_topics: pipeline fields
ALTER TABLE public.content_topics
  ADD COLUMN IF NOT EXISTS gen_status text NOT NULL DEFAULT 'waiting',
  ADD COLUMN IF NOT EXISTS article_title text,
  ADD COLUMN IF NOT EXISTS article_markdown text,
  ADD COLUMN IF NOT EXISTS article_meta jsonb,
  ADD COLUMN IF NOT EXISTS gen_error text,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz;

-- 4. update get_content_plan_by_uuid to support client_id (fallback)
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
    'status', t.status, 'comment', t.comment
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

-- 5. update submit_content_plan_response: support client plans (skip projects join)
CREATE OR REPLACE FUNCTION public.submit_content_plan_response(p_uuid uuid, p_responses jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id uuid;
  v_topic jsonb;
  v_name text;
BEGIN
  IF p_responses IS NULL OR jsonb_typeof(p_responses) <> 'array' THEN
    RAISE EXCEPTION 'invalid_responses';
  END IF;

  SELECT cp.id,
         COALESCE(cc.name, p.name, '-')
    INTO v_plan_id, v_name
  FROM public.content_plans cp
  LEFT JOIN public.content_clients cc ON cc.id = cp.client_id
  LEFT JOIN public.projects p ON p.id = cp.project_id
  WHERE cp.public_uuid = p_uuid;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  FOR v_topic IN SELECT * FROM jsonb_array_elements(p_responses) LOOP
    UPDATE public.content_topics
    SET status = NULLIF(v_topic->>'status',''),
        comment = NULLIF(v_topic->>'comment',''),
        responded_at = now()
    WHERE id = (v_topic->>'id')::uuid
      AND plan_id = v_plan_id
      AND COALESCE(v_topic->>'status','') IN ('ok','rev','no');
  END LOOP;

  UPDATE public.content_plans
  SET status = 'responded',
      client_responded_at = now()
  WHERE id = v_plan_id;

  INSERT INTO public.notifications (user_id, title, message)
  SELECT ur.user_id,
         'Получен ответ по контент-плану',
         'Клиент согласовал темы: ' || v_name
  FROM public.user_roles ur
  WHERE ur.role IN ('admin'::app_role,'staff'::app_role);

  RETURN jsonb_build_object('ok', true);
END;
$function$;
