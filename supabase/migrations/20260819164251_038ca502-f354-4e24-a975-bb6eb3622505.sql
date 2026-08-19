CREATE TABLE public.page_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  page_type text,
  url_path text NOT NULL,
  intent text,
  demand_score integer NOT NULL DEFAULT 0,
  semantic_score integer NOT NULL DEFAULT 0,
  product_count integer NOT NULL DEFAULT 0,
  keyword_count integer NOT NULL DEFAULT 0,
  duplicate_score integer NOT NULL DEFAULT 0,
  cannibalization_score integer NOT NULL DEFAULT 0,
  decision text NOT NULL DEFAULT 'candidate',
  reason text,
  status text NOT NULL DEFAULT 'candidate',
  title text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, entity_type, entity_id)
);

CREATE INDEX page_registry_project_decision_idx ON public.page_registry (project_id, decision);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.page_registry TO authenticated;
GRANT ALL ON public.page_registry TO service_role;
ALTER TABLE public.page_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage page_registry of own projects" ON public.page_registry
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_registry.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_registry.project_id AND p.user_id = auth.uid()));

CREATE TABLE public.page_decision_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL,
  entity_type text NOT NULL,
  cluster_id uuid,
  page_type text,
  intent text,
  demand_score integer NOT NULL DEFAULT 0,
  semantic_score integer NOT NULL DEFAULT 0,
  product_count integer NOT NULL DEFAULT 0,
  duplicate_score integer NOT NULL DEFAULT 0,
  decision text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX page_decision_log_project_idx ON public.page_decision_log (project_id, created_at DESC);

GRANT SELECT, INSERT ON public.page_decision_log TO authenticated;
GRANT ALL ON public.page_decision_log TO service_role;
ALTER TABLE public.page_decision_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read page_decision_log of own projects" ON public.page_decision_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_decision_log.project_id AND p.user_id = auth.uid()));
CREATE POLICY "Users insert page_decision_log of own projects" ON public.page_decision_log
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_decision_log.project_id AND p.user_id = auth.uid()));

CREATE TRIGGER page_registry_touch BEFORE UPDATE ON public.page_registry
  FOR EACH ROW EXECUTE FUNCTION public.silo_touch_updated_at();