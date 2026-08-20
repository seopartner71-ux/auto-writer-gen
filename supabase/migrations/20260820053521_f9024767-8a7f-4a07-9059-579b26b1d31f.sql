ALTER TABLE public.page_registry ADD COLUMN IF NOT EXISTS has_offer boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS page_registry_project_url_live_idx
  ON public.page_registry (project_id, url_path)
  WHERE decision <> 'rejected';

ALTER TABLE public.page_decision_log ADD COLUMN IF NOT EXISTS has_offer boolean NOT NULL DEFAULT false;