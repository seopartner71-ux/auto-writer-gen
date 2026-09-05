CREATE TABLE public.competitor_monitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  name text NOT NULL,
  domain text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.competitor_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id uuid NOT NULL REFERENCES public.competitor_monitors(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  url text NOT NULL,
  label text,
  frequency text NOT NULL DEFAULT 'weekly',
  monitor_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending',
  last_error text,
  last_checked_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competitor_pages_frequency_chk CHECK (frequency IN ('daily','twice_week','weekly','manual')),
  CONSTRAINT competitor_pages_unique_url UNIQUE (monitor_id, url)
);

CREATE TABLE public.competitor_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.competitor_pages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  is_baseline boolean NOT NULL DEFAULT false,
  http_status integer,
  title text,
  description text,
  h1 text,
  headings jsonb NOT NULL DEFAULT '[]'::jsonb,
  word_count integer NOT NULL DEFAULT 0,
  content text,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  internal_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  external_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  tables jsonb NOT NULL DEFAULT '[]'::jsonb,
  lists jsonb NOT NULL DEFAULT '[]'::jsonb,
  cta jsonb NOT NULL DEFAULT '[]'::jsonb,
  prices jsonb NOT NULL DEFAULT '[]'::jsonb,
  schema_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  canonical text,
  robots text,
  content_hash text,
  structure_hash text,
  meta_hash text,
  links_hash text,
  raw_html text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.competitor_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.competitor_pages(id) ON DELETE CASCADE,
  monitor_id uuid NOT NULL REFERENCES public.competitor_monitors(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  snapshot_id uuid REFERENCES public.competitor_snapshots(id) ON DELETE SET NULL,
  prev_snapshot_id uuid REFERENCES public.competitor_snapshots(id) ON DELETE SET NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  severity text NOT NULL DEFAULT 'low',
  score integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_analysis jsonb,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competitor_changes_severity_chk CHECK (severity IN ('low','medium','high','critical'))
);

CREATE TABLE public.competitor_check_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.competitor_pages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  trigger_source text NOT NULL DEFAULT 'cron',
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competitor_check_jobs_status_chk CHECK (status IN ('queued','running','done','failed'))
);

CREATE INDEX idx_competitor_monitors_user ON public.competitor_monitors(user_id);
CREATE INDEX idx_competitor_pages_monitor ON public.competitor_pages(monitor_id);
CREATE INDEX idx_competitor_pages_user ON public.competitor_pages(user_id);
CREATE INDEX idx_competitor_pages_due ON public.competitor_pages(next_check_at) WHERE is_enabled = true;
CREATE INDEX idx_competitor_snapshots_page ON public.competitor_snapshots(page_id, checked_at DESC);
CREATE INDEX idx_competitor_changes_user ON public.competitor_changes(user_id, detected_at DESC);
CREATE INDEX idx_competitor_changes_page ON public.competitor_changes(page_id, detected_at DESC);
CREATE INDEX idx_competitor_check_jobs_status ON public.competitor_check_jobs(status, scheduled_at);
CREATE UNIQUE INDEX idx_competitor_check_jobs_active ON public.competitor_check_jobs(page_id) WHERE status IN ('queued','running');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitor_monitors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitor_pages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitor_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitor_changes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitor_check_jobs TO authenticated;
GRANT ALL ON public.competitor_monitors TO service_role;
GRANT ALL ON public.competitor_pages TO service_role;
GRANT ALL ON public.competitor_snapshots TO service_role;
GRANT ALL ON public.competitor_changes TO service_role;
GRANT ALL ON public.competitor_check_jobs TO service_role;

ALTER TABLE public.competitor_monitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_check_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own competitor monitors" ON public.competitor_monitors FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own competitor pages" ON public.competitor_pages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own competitor snapshots" ON public.competitor_snapshots FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own competitor changes" ON public.competitor_changes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own competitor jobs" ON public.competitor_check_jobs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_competitor_monitors_updated_at BEFORE UPDATE ON public.competitor_monitors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_competitor_pages_updated_at BEFORE UPDATE ON public.competitor_pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();