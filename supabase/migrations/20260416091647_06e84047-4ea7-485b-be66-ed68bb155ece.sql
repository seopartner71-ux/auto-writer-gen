ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS hosting_platform text DEFAULT 'vercel';
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS site_contacts text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS site_privacy text;