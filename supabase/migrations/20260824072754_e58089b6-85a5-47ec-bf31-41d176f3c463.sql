CREATE TABLE public.site_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  version text NOT NULL DEFAULT '1.0.0',
  engine text NOT NULL DEFAULT 'mustache-lite@dbTemplate',
  description text,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_prefix text NOT NULL,
  pages jsonb NOT NULL DEFAULT '{}'::jsonb,
  assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  css_path text,
  status text NOT NULL DEFAULT 'installed',
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug, version)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_templates TO authenticated;
GRANT ALL ON public.site_templates TO service_role;
ALTER TABLE public.site_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_templates_select_own_or_public" ON public.site_templates
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_public = true OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "site_templates_insert_own" ON public.site_templates
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "site_templates_update_own" ON public.site_templates
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "site_templates_delete_own" ON public.site_templates
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_site_templates_updated_at
  BEFORE UPDATE ON public.site_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.site_template_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  project_id uuid,
  template_id uuid,
  level text NOT NULL DEFAULT 'info',
  event text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.site_template_events TO authenticated;
GRANT ALL ON public.site_template_events TO service_role;
ALTER TABLE public.site_template_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "site_template_events_select_own" ON public.site_template_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS site_template_id uuid REFERENCES public.site_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_engine text NOT NULL DEFAULT 'legacy';

ALTER TABLE public.projects
  ADD CONSTRAINT projects_template_engine_check CHECK (template_engine IN ('legacy','template'));

CREATE POLICY "site_templates_storage_read_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'site-templates' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "site_templates_storage_write_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-templates' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "site_templates_storage_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'site-templates' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "site_templates_storage_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'site-templates' AND (storage.foldername(name))[1] = auth.uid()::text);