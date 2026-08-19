
-- P6: commercial site factory (additive only)

CREATE TABLE IF NOT EXISTS public.site_products (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  silo_id uuid references public.site_silos(id) on delete set null,
  site_cluster_id uuid references public.site_clusters(id) on delete set null,
  external_id text,
  sku text,
  name text not null,
  slug text,
  url_path text,
  price numeric,
  currency text default 'RUB',
  brand text,
  availability text default 'in_stock',
  description text,
  characteristics jsonb default '{}'::jsonb,
  images text[] default '{}',
  source_url text,
  kind text not null default 'product',
  status text not null default 'active',
  position integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
CREATE UNIQUE INDEX IF NOT EXISTS site_products_project_sku_uidx ON public.site_products(project_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_products_project_idx ON public.site_products(project_id);

CREATE TABLE IF NOT EXISTS public.site_keywords (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  keyword text not null,
  frequency integer,
  intent text,
  cluster_hint text,
  category_hint text,
  priority integer default 0,
  silo_id uuid references public.site_silos(id) on delete set null,
  site_cluster_id uuid references public.site_clusters(id) on delete set null,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
CREATE UNIQUE INDEX IF NOT EXISTS site_keywords_project_kw_uidx ON public.site_keywords(project_id, lower(keyword));

CREATE TABLE IF NOT EXISTS public.site_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null,
  filename text,
  format text,
  rows_total integer default 0,
  rows_ok integer default 0,
  rows_dupe integer default 0,
  rows_error integer default 0,
  preview jsonb default '[]'::jsonb,
  status text not null default 'preview',
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS site_imports_project_idx ON public.site_imports(project_id);

CREATE TABLE IF NOT EXISTS public.site_deploy_queue (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  reason text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS site_deploy_queue_project_idx ON public.site_deploy_queue(project_id, status);

ALTER TABLE public.site_silos ADD COLUMN IF NOT EXISTS page_type text DEFAULT 'silo_hub';
ALTER TABLE public.site_clusters ADD COLUMN IF NOT EXISTS page_type text DEFAULT 'category';

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS deployment_url text,
  ADD COLUMN IF NOT EXISTS custom_domain_status text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ssl_status text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS dns_status text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS dns_records jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_qa_report jsonb,
  ADD COLUMN IF NOT EXISTS last_build_hash text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_products TO authenticated;
GRANT ALL ON public.site_products TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_keywords TO authenticated;
GRANT ALL ON public.site_keywords TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_imports TO authenticated;
GRANT ALL ON public.site_imports TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_deploy_queue TO authenticated;
GRANT ALL ON public.site_deploy_queue TO service_role;

ALTER TABLE public.site_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_deploy_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own site_products" ON public.site_products FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "own site_keywords" ON public.site_keywords FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "own site_imports" ON public.site_imports FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "own site_deploy_queue" ON public.site_deploy_queue FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

CREATE TRIGGER site_products_updated_at BEFORE UPDATE ON public.site_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER site_keywords_updated_at BEFORE UPDATE ON public.site_keywords
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
