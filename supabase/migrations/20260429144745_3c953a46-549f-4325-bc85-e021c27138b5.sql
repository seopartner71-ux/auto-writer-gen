-- Site Factory: дополнительные поля для SEO/legal/контактов
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS site_terms text,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS company_address text,
  ADD COLUMN IF NOT EXISTS company_phone text,
  ADD COLUMN IF NOT EXISTS company_email text,
  ADD COLUMN IF NOT EXISTS team_members jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS founding_year integer,
  ADD COLUMN IF NOT EXISTS og_image_url text;