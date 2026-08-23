
-- P25 Multi-Site Network & AI Radar
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'client';

CREATE TABLE IF NOT EXISTS public.agency_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_name text,
  logo_url text,
  primary_color text NOT NULL DEFAULT '#6E56CF',
  accent_color text NOT NULL DEFAULT '#0A0A0A',
  telegram_chat_id text,
  alert_email text,
  alerts jsonb NOT NULL DEFAULT '{"geo_drop":true,"qa_critical":true,"deploy_done":true,"article_published":true,"indexing_done":true}'::jsonb,
  geo_drop_threshold integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_settings TO authenticated;
GRANT ALL ON public.agency_settings TO service_role;
ALTER TABLE public.agency_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own agency settings" ON public.agency_settings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.network_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.network_alerts TO authenticated;
GRANT ALL ON public.network_alerts TO service_role;
ALTER TABLE public.network_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own network alerts" ON public.network_alerts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS network_alerts_user_idx ON public.network_alerts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.radar_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  query text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.radar_queries TO authenticated;
GRANT ALL ON public.radar_queries TO service_role;
ALTER TABLE public.radar_queries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own radar queries" ON public.radar_queries FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE UNIQUE INDEX IF NOT EXISTS radar_queries_uniq
  ON public.radar_queries (user_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(query));

CREATE TABLE IF NOT EXISTS public.client_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_user_id, project_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_access TO authenticated;
GRANT ALL ON public.client_access TO service_role;
ALTER TABLE public.client_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages client access" ON public.client_access FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "client reads own access" ON public.client_access FOR SELECT TO authenticated
  USING (auth.uid() = client_user_id);
