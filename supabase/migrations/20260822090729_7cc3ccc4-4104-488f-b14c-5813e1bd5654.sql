-- P20 Media Engine: image assets registry
create table if not exists public.image_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_type text not null check (entity_type in ('product','category','article','hub','home','service')),
  entity_id uuid,
  registry_id uuid,
  image_type text not null default 'hero' check (image_type in ('hero','gallery','cover','inline')),
  image_url text not null default '',
  source text not null default 'ai' check (source in ('upload','xml','api','ai','placeholder')),
  alt text not null default '',
  prompt text,
  width int,
  height int,
  position int not null default 0,
  status text not null default 'pending' check (status in ('pending','ready','failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists image_assets_project_idx on public.image_assets(project_id);
create index if not exists image_assets_entity_idx on public.image_assets(project_id, entity_type, entity_id);
create unique index if not exists image_assets_slot_idx
  on public.image_assets(project_id, entity_type, entity_id, image_type, position)
  where entity_id is not null;

grant select, insert, update, delete on public.image_assets to authenticated;
grant all on public.image_assets to service_role;

alter table public.image_assets enable row level security;

create policy "Owners read own image assets" on public.image_assets
  for select to authenticated
  using (exists (select 1 from public.projects p where p.id = image_assets.project_id and p.user_id = auth.uid()));

create policy "Owners insert own image assets" on public.image_assets
  for insert to authenticated
  with check (exists (select 1 from public.projects p where p.id = image_assets.project_id and p.user_id = auth.uid()));

create policy "Owners update own image assets" on public.image_assets
  for update to authenticated
  using (exists (select 1 from public.projects p where p.id = image_assets.project_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = image_assets.project_id and p.user_id = auth.uid()));

create policy "Owners delete own image assets" on public.image_assets
  for delete to authenticated
  using (exists (select 1 from public.projects p where p.id = image_assets.project_id and p.user_id = auth.uid()));

create trigger image_assets_set_updated_at
  before update on public.image_assets
  for each row execute function public.update_updated_at_column();