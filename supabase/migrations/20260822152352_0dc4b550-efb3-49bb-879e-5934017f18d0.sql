CREATE TABLE IF NOT EXISTS public.ai_visibility (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  query text not null,
  entity text not null default '',
  model text not null,
  mentioned boolean not null default false,
  position integer,
  cited boolean not null default false,
  confidence numeric not null default 0,
  competitors jsonb not null default '[]'::jsonb,
  raw_answer text,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS ai_visibility_project_idx ON public.ai_visibility (project_id, checked_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_visibility TO authenticated;
GRANT ALL ON public.ai_visibility TO service_role;
ALTER TABLE public.ai_visibility ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_visibility_owner" ON public.ai_visibility FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.project_score_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  release_id uuid references public.site_releases(id) on delete set null,
  version text,
  seo_score integer not null default 0,
  geo_score integer not null default 0,
  visual_score integer not null default 0,
  media_score integer not null default 0,
  quality_score integer not null default 0,
  content_score integer not null default 0,
  commercial_score integer not null default 0,
  pages integer not null default 0,
  indexed_urls integer not null default 0,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS project_score_history_project_idx ON public.project_score_history (project_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_score_history TO authenticated;
GRANT ALL ON public.project_score_history TO service_role;
ALTER TABLE public.project_score_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_score_history_owner" ON public.project_score_history FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);