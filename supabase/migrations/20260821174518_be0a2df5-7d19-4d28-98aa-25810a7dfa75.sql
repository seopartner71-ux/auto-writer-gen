ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS production_url text,
  ADD COLUMN IF NOT EXISTS deployment_status text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

ALTER TABLE public.deployments
  ADD COLUMN IF NOT EXISTS launch_report jsonb;