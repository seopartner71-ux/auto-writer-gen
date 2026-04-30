CREATE TABLE public.site_image_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  slot text NOT NULL,
  prompt text,
  image_url text NOT NULL,
  source text NOT NULL DEFAULT 'fal',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, slot)
);

CREATE INDEX idx_site_image_cache_project ON public.site_image_cache(project_id);

ALTER TABLE public.site_image_cache ENABLE ROW LEVEL SECURITY;

-- Only service role accesses this table; no public policies needed.
-- Block all client access explicitly.
CREATE POLICY "no_client_access" ON public.site_image_cache FOR ALL TO authenticated USING (false) WITH CHECK (false);