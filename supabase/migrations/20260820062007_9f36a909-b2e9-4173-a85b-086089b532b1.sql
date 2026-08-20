ALTER TABLE public.page_registry
  ADD COLUMN IF NOT EXISTS quality_status text,
  ADD COLUMN IF NOT EXISTS commercial_score integer,
  ADD COLUMN IF NOT EXISTS seo_quality_score integer,
  ADD COLUMN IF NOT EXISTS quality_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS quality_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS quality_factors jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS page_registry_quality_status_idx
  ON public.page_registry (project_id, quality_status);