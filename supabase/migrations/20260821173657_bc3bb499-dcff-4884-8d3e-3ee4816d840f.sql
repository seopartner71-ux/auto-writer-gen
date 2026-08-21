CREATE TABLE IF NOT EXISTS public.deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'cloudflare',
  domain text,
  status text NOT NULL DEFAULT 'draft',
  build_id text,
  url text,
  zip_url text,
  pages_count integer,
  qa_report jsonb,
  readiness jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deployed_at timestamptz
);

CREATE INDEX IF NOT EXISTS deployments_project_created_idx ON public.deployments (project_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deployments TO authenticated;
GRANT ALL ON public.deployments TO service_role;

ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own deployments" ON public.deployments;
CREATE POLICY "Users manage own deployments" ON public.deployments
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins view all deployments" ON public.deployments;
CREATE POLICY "Admins view all deployments" ON public.deployments
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.indexing_logs ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.indexing_logs ADD COLUMN IF NOT EXISTS deployment_id uuid;
CREATE INDEX IF NOT EXISTS indexing_logs_project_idx ON public.indexing_logs (project_id, created_at DESC);