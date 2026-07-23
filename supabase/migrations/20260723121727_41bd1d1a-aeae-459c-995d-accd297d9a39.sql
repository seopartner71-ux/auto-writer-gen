
-- Note: existing table content_clients belongs to a different feature (content plans).
-- We create a new dedicated table `clients` for the Content Ecosystem feature.

CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  domain text,
  description text,
  logo_url text,
  brand_color text NOT NULL DEFAULT '#7C3AED',
  expert_name text,
  expert_bio text,
  brand_voice text,
  default_utm_source text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_user_id ON public.clients(user_id);
CREATE INDEX idx_clients_user_archived ON public.clients(user_id, archived);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own clients" ON public.clients
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER clients_updated_at BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- content_ecosystems
CREATE TABLE public.content_ecosystems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source_article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  formats_requested jsonb NOT NULL DEFAULT '[]'::jsonb,
  formats_completed jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ecosystems_user_id ON public.content_ecosystems(user_id);
CREATE INDEX idx_ecosystems_client_id ON public.content_ecosystems(client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_ecosystems TO authenticated;
GRANT ALL ON public.content_ecosystems TO service_role;

ALTER TABLE public.content_ecosystems ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own ecosystems" ON public.content_ecosystems
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER content_ecosystems_updated_at BEFORE UPDATE ON public.content_ecosystems
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ecosystem_formats
CREATE TABLE public.ecosystem_formats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_id uuid NOT NULL REFERENCES public.content_ecosystems(id) ON DELETE CASCADE,
  format_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  content text,
  model_used text,
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ecosystem_formats_eco ON public.ecosystem_formats(ecosystem_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecosystem_formats TO authenticated;
GRANT ALL ON public.ecosystem_formats TO service_role;

ALTER TABLE public.ecosystem_formats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage formats via ecosystem" ON public.ecosystem_formats
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.content_ecosystems e
      WHERE e.id = ecosystem_id AND e.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.content_ecosystems e
      WHERE e.id = ecosystem_id AND e.user_id = auth.uid()
    )
  );

CREATE TRIGGER ecosystem_formats_updated_at BEFORE UPDATE ON public.ecosystem_formats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- articles.client_id
ALTER TABLE public.articles ADD COLUMN client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;
CREATE INDEX idx_articles_client_id ON public.articles(client_id);

-- Storage policies for client-logos bucket
CREATE POLICY "Users read own client logos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'client-logos' AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "Users upload own client logos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'client-logos' AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "Users update own client logos" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'client-logos' AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "Users delete own client logos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'client-logos' AND (storage.foldername(name))[1] = auth.uid()::text
  );
