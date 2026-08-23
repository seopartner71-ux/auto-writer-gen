CREATE TABLE public.catalog_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cluster_id uuid REFERENCES public.site_clusters(id) ON DELETE CASCADE,
  attribute text NOT NULL,
  attribute_key text NOT NULL,
  slug text NOT NULL,
  filter_type text NOT NULL DEFAULT 'enum',
  values jsonb NOT NULL DEFAULT '[]'::jsonb,
  value_count integer NOT NULL DEFAULT 0,
  product_count integer NOT NULL DEFAULT 0,
  indexable boolean NOT NULL DEFAULT true,
  manual_override boolean NOT NULL DEFAULT false,
  reason text NOT NULL DEFAULT 'ok',
  priority integer NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX catalog_filters_unique ON public.catalog_filters (project_id, coalesce(cluster_id, '00000000-0000-0000-0000-000000000000'::uuid), attribute_key);
CREATE INDEX catalog_filters_project_idx ON public.catalog_filters (project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_filters TO authenticated;
GRANT ALL ON public.catalog_filters TO service_role;
ALTER TABLE public.catalog_filters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own catalog_filters" ON public.catalog_filters FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = catalog_filters.project_id AND p.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = catalog_filters.project_id AND p.user_id = auth.uid()));

CREATE TABLE public.catalog_filter_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cluster_id uuid REFERENCES public.site_clusters(id) ON DELETE CASCADE,
  cluster_path text,
  slug text NOT NULL,
  url_path text NOT NULL,
  title text NOT NULL DEFAULT '',
  h1 text,
  facets jsonb NOT NULL DEFAULT '[]'::jsonb,
  product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  product_count integer NOT NULL DEFAULT 0,
  keyword_hits integer NOT NULL DEFAULT 0,
  demand_score integer NOT NULL DEFAULT 0,
  indexable boolean NOT NULL DEFAULT true,
  canonical text,
  reason text NOT NULL DEFAULT 'INDEXABLE',
  status text NOT NULL DEFAULT 'active',
  seo_content jsonb,
  content_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX catalog_filter_pages_url_unique ON public.catalog_filter_pages (project_id, url_path);
CREATE INDEX catalog_filter_pages_project_idx ON public.catalog_filter_pages (project_id, status);
CREATE INDEX catalog_filter_pages_cluster_idx ON public.catalog_filter_pages (cluster_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_filter_pages TO authenticated;
GRANT ALL ON public.catalog_filter_pages TO service_role;
ALTER TABLE public.catalog_filter_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own catalog_filter_pages" ON public.catalog_filter_pages FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = catalog_filter_pages.project_id AND p.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = catalog_filter_pages.project_id AND p.user_id = auth.uid()));

CREATE TRIGGER catalog_filters_updated_at BEFORE UPDATE ON public.catalog_filters
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER catalog_filter_pages_updated_at BEFORE UPDATE ON public.catalog_filter_pages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();