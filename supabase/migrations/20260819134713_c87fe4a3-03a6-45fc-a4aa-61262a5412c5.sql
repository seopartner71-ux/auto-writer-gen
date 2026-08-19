-- P7: redirects, product assignment confidence, commerce link graph
CREATE TABLE IF NOT EXISTS public.site_redirects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  old_url text NOT NULL,
  new_url text NOT NULL,
  status_code smallint NOT NULL DEFAULT 301,
  reason text,
  entity_type text,
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, old_url)
);
CREATE INDEX IF NOT EXISTS site_redirects_project_idx ON public.site_redirects(project_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_redirects TO authenticated;
GRANT ALL ON public.site_redirects TO service_role;
ALTER TABLE public.site_redirects ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='site_redirects' AND policyname='Users manage redirects of own projects') THEN
    CREATE POLICY "Users manage redirects of own projects" ON public.site_redirects FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = site_redirects.project_id AND p.user_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = site_redirects.project_id AND p.user_id = auth.uid()));
  END IF;
END $$;

ALTER TABLE public.site_products
  ADD COLUMN IF NOT EXISTS cluster_confidence numeric,
  ADD COLUMN IF NOT EXISTS assignment_status text NOT NULL DEFAULT 'unassigned',
  ADD COLUMN IF NOT EXISTS category_hint text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS benefits jsonb;

ALTER TABLE public.internal_links
  ADD COLUMN IF NOT EXISTS from_path text,
  ADD COLUMN IF NOT EXISTS from_product_id uuid,
  ADD COLUMN IF NOT EXISTS to_product_id uuid,
  ADD COLUMN IF NOT EXISTS from_kind text,
  ADD COLUMN IF NOT EXISTS to_kind text;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS qa_gate_enabled boolean NOT NULL DEFAULT true;