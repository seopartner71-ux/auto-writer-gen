-- Commerce Content Engine: store generated SEO content on existing entities.
alter table public.site_products
  add column if not exists seo_content jsonb,
  add column if not exists content_status text not null default 'pending',
  add column if not exists content_generated_at timestamptz,
  add column if not exists content_hash text;

alter table public.site_clusters
  add column if not exists seo_content jsonb,
  add column if not exists content_status text not null default 'pending',
  add column if not exists content_generated_at timestamptz,
  add column if not exists content_hash text;

alter table public.site_silos
  add column if not exists seo_content jsonb,
  add column if not exists content_status text not null default 'pending',
  add column if not exists content_generated_at timestamptz,
  add column if not exists content_hash text;

-- Keyword -> target entity bridge (no third semantics source).
alter table public.site_keywords
  add column if not exists target_type text,
  add column if not exists target_id uuid,
  add column if not exists source_keyword_id uuid,
  add column if not exists coverage_status text not null default 'uncovered',
  add column if not exists role text not null default 'secondary',
  add column if not exists semantic_terms text[];

create index if not exists idx_site_keywords_target on public.site_keywords (project_id, target_type, target_id);
create index if not exists idx_site_products_content on public.site_products (project_id, content_status);
