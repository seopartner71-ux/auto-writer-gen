ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS homepage_style text NOT NULL DEFAULT 'landing';

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_homepage_style_check;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_homepage_style_check
  CHECK (homepage_style IN ('landing','magazine'));