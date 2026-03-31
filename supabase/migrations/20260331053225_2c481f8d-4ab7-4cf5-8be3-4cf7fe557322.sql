ALTER TABLE public.radar_results ADD COLUMN IF NOT EXISTS sentiment text DEFAULT 'unknown' CHECK (sentiment IN ('positive', 'neutral', 'negative', 'not_found', 'unknown'));
ALTER TABLE public.radar_results ADD COLUMN IF NOT EXISTS is_domain_found boolean DEFAULT false;
ALTER TABLE public.radar_results ADD COLUMN IF NOT EXISTS is_brand_found boolean DEFAULT false;