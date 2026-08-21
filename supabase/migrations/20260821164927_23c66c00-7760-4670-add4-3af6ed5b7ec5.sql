CREATE TABLE IF NOT EXISTS public.design_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  industry TEXT NOT NULL DEFAULT 'ecommerce',
  style TEXT NOT NULL DEFAULT 'minimal',
  color_scheme JSONB NOT NULL DEFAULT '{}'::jsonb,
  typography JSONB NOT NULL DEFAULT '{}'::jsonb,
  layout_type TEXT NOT NULL DEFAULT 'wide',
  components_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  model_used TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS design_profiles_project_idx ON public.design_profiles (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS design_profiles_active_idx ON public.design_profiles (project_id) WHERE is_active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.design_profiles TO authenticated;
GRANT ALL ON public.design_profiles TO service_role;

ALTER TABLE public.design_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage design_profiles of own projects" ON public.design_profiles
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = design_profiles.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = design_profiles.project_id AND p.user_id = auth.uid()));

CREATE TRIGGER design_profiles_touch BEFORE UPDATE ON public.design_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.page_visual_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  registry_id UUID NOT NULL REFERENCES public.page_registry(id) ON DELETE CASCADE,
  design_profile_id UUID REFERENCES public.design_profiles(id) ON DELETE SET NULL,
  url_path TEXT NOT NULL,
  page_type TEXT NOT NULL,
  template TEXT NOT NULL,
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  visual_status TEXT NOT NULL DEFAULT 'REVIEW',
  visual_score INTEGER NOT NULL DEFAULT 0,
  visual_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_used TEXT,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS page_visual_config_registry_idx ON public.page_visual_config (registry_id);
CREATE INDEX IF NOT EXISTS page_visual_config_project_status_idx ON public.page_visual_config (project_id, visual_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.page_visual_config TO authenticated;
GRANT ALL ON public.page_visual_config TO service_role;

ALTER TABLE public.page_visual_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage page_visual_config of own projects" ON public.page_visual_config
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_visual_config.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_visual_config.project_id AND p.user_id = auth.uid()));

CREATE TRIGGER page_visual_config_touch BEFORE UPDATE ON public.page_visual_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();