ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS commercial_profile jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.site_products
  ADD COLUMN IF NOT EXISTS service_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS data_source text,
  ADD COLUMN IF NOT EXISTS content_error text;

ALTER TABLE public.site_clusters
  ADD COLUMN IF NOT EXISTS content_error text;

ALTER TABLE public.site_silos
  ADD COLUMN IF NOT EXISTS content_error text;

COMMENT ON COLUMN public.projects.commercial_profile IS
  'P11 commercial project profile: company/contacts/region/commercial/trust/cta groups. User supplied only, never AI invented.';
COMMENT ON COLUMN public.site_products.service_meta IS
  'P11 service data foundation: scope, process, duration, pricing_method, warranty, benefits, cta.';