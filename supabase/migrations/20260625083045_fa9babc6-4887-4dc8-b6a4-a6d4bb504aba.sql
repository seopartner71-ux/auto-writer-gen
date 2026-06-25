
-- Content plans (admin/staff create plans per project; clients approve via public link)
CREATE TABLE public.content_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  year smallint NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  status text NOT NULL DEFAULT 'awaiting' CHECK (status IN ('awaiting','review','responded','in_progress','done')),
  public_uuid uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  client_responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_plans TO authenticated;
GRANT SELECT, UPDATE ON public.content_plans TO anon; -- read & status bump via public link (RLS scopes)
GRANT ALL ON public.content_plans TO service_role;

ALTER TABLE public.content_plans ENABLE ROW LEVEL SECURITY;

-- Admin/staff full access
CREATE POLICY "Staff manage plans"
  ON public.content_plans FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

-- Project owner can read their own plans
CREATE POLICY "Project owner reads plans"
  ON public.content_plans FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = content_plans.project_id AND p.user_id = auth.uid()));

-- Anonymous read by public_uuid handled in app via service-role/edge; allow anon SELECT only via UUID filter still requires a row-returning policy. Public access via dedicated edge function (no anon RLS row policy created here).

CREATE TRIGGER trg_content_plans_updated_at
BEFORE UPDATE ON public.content_plans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_content_plans_project ON public.content_plans(project_id);
CREATE INDEX idx_content_plans_public_uuid ON public.content_plans(public_uuid);

-- Topics
CREATE TABLE public.content_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.content_plans(id) ON DELETE CASCADE,
  tab text NOT NULL CHECK (tab IN ('blog','links','trust')),
  position smallint NOT NULL DEFAULT 0,
  title text NOT NULL,
  status text CHECK (status IN ('ok','rev','no')),
  comment text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_topics TO authenticated;
GRANT ALL ON public.content_topics TO service_role;

ALTER TABLE public.content_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage topics"
  ON public.content_topics FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

CREATE POLICY "Project owner reads topics"
  ON public.content_topics FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.content_plans cp
    JOIN public.projects p ON p.id = cp.project_id
    WHERE cp.id = content_topics.plan_id AND p.user_id = auth.uid()
  ));

CREATE TRIGGER trg_content_topics_updated_at
BEFORE UPDATE ON public.content_topics
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_content_topics_plan ON public.content_topics(plan_id);

-- Public read by uuid (returns plan + project + topics)
CREATE OR REPLACE FUNCTION public.get_content_plan_by_uuid(p_uuid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan record;
  v_project record;
  v_topics jsonb;
BEGIN
  SELECT * INTO v_plan FROM public.content_plans WHERE public_uuid = p_uuid;
  IF v_plan.id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT id, name, domain INTO v_project FROM public.projects WHERE id = v_plan.project_id;
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
    'project', jsonb_build_object('id', v_project.id, 'name', v_project.name, 'domain', v_project.domain),
    'topics', v_topics
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_content_plan_by_uuid(uuid) TO anon, authenticated;

-- Submit client response (anonymous): updates topic statuses/comments and bumps plan status
CREATE OR REPLACE FUNCTION public.submit_content_plan_response(p_uuid uuid, p_responses jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
  v_topic jsonb;
  v_owner uuid;
  v_project_name text;
BEGIN
  IF p_responses IS NULL OR jsonb_typeof(p_responses) <> 'array' THEN
    RAISE EXCEPTION 'invalid_responses';
  END IF;

  SELECT cp.id, p.user_id, p.name
    INTO v_plan_id, v_owner, v_project_name
  FROM public.content_plans cp
  JOIN public.projects p ON p.id = cp.project_id
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

  -- Notify staff/admins
  INSERT INTO public.notifications (user_id, title, message)
  SELECT ur.user_id,
         'Получен ответ по контент-плану',
         'Клиент согласовал темы по проекту: ' || COALESCE(v_project_name,'-')
  FROM public.user_roles ur
  WHERE ur.role IN ('admin'::app_role,'staff'::app_role);

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_content_plan_response(uuid, jsonb) TO anon, authenticated;
