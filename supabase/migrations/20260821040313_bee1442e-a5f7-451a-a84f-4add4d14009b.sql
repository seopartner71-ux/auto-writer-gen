CREATE TABLE IF NOT EXISTS public.page_seo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  registry_id uuid NOT NULL REFERENCES public.page_registry(id) ON DELETE CASCADE,
  url_path text NOT NULL,
  page_type text NOT NULL,
  title text,
  meta_description text,
  h1 text,
  canonical text,
  og_title text,
  og_description text,
  robots text NOT NULL DEFAULT 'index,follow',
  schema_type text,
  schema_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  seo_status text NOT NULL DEFAULT 'FAIL',
  seo_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_used text,
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS page_seo_registry_idx ON public.page_seo (registry_id);
CREATE INDEX IF NOT EXISTS page_seo_project_status_idx ON public.page_seo (project_id, seo_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.page_seo TO authenticated;
GRANT ALL ON public.page_seo TO service_role;

ALTER TABLE public.page_seo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage page_seo of own projects" ON public.page_seo
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_seo.project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = page_seo.project_id AND p.user_id = auth.uid()));

CREATE TRIGGER page_seo_touch BEFORE UPDATE ON public.page_seo
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();