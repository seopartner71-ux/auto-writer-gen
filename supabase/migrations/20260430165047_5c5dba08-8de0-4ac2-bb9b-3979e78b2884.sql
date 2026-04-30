ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_homepage_style_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_homepage_style_check
  CHECK (homepage_style = ANY (ARRAY['landing'::text, 'magazine'::text, 'news'::text, 'minimal'::text]));