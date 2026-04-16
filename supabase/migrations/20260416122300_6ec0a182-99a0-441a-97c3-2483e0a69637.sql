-- Add injection_links and footer_link to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS injection_links jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS footer_link jsonb DEFAULT NULL;

COMMENT ON COLUMN public.projects.injection_links IS 'Array of {url, anchor} objects to auto-inject into articles during publish';
COMMENT ON COLUMN public.projects.footer_link IS 'Object {url, text} for site-wide footer link';