CREATE TABLE IF NOT EXISTS public.site_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  version text NOT NULL,
  build_hash text,
  provider text,
  pages integer NOT NULL DEFAULT 0,
  published_url text,
  status text NOT NULL DEFAULT 'draft',
  is_current boolean NOT NULL DEFAULT false,
  deployment_id uuid,
  launch_report jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_releases_project_idx ON public.site_releases(project_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_releases TO authenticated;
GRANT ALL ON public.site_releases TO service_role;

ALTER TABLE public.site_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own releases" ON public.site_releases;
CREATE POLICY "Users manage their own releases" ON public.site_releases
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.generation_jobs REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.generation_jobs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;