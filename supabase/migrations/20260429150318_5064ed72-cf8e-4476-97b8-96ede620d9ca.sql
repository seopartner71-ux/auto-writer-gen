ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS last_deploy_at timestamp with time zone;