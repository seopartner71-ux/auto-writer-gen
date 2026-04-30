ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS homepage_style_check;
ALTER TABLE public.projects ADD CONSTRAINT homepage_style_check
  CHECK (homepage_style IN ('landing','magazine','news','minimal','dark','local','expert'));