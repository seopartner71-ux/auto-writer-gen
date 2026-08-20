ALTER TABLE public.page_registry
  ADD COLUMN IF NOT EXISTS indexable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS canonical text,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS page_registry_project_url_idx
  ON public.page_registry (project_id, url_path);