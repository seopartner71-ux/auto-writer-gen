ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS site_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS site_copyright text DEFAULT '',
  ADD COLUMN IF NOT EXISTS site_about text DEFAULT '';