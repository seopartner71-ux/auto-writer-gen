-- Blogger connections table
CREATE TABLE public.blogger_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  google_email text,
  refresh_token text NOT NULL,
  access_token text,
  token_expires_at timestamptz,
  blogs jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_blog_id text,
  default_blog_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.blogger_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own blogger connection"
  ON public.blogger_connections
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all blogger connections"
  ON public.blogger_connections
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE TRIGGER set_blogger_connections_updated_at
  BEFORE UPDATE ON public.blogger_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Articles: track Blogger publication
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS blogger_post_id text,
  ADD COLUMN IF NOT EXISTS blogger_post_url text,
  ADD COLUMN IF NOT EXISTS blogger_blog_id text;

CREATE INDEX IF NOT EXISTS idx_articles_blogger_post ON public.articles(blogger_post_id) WHERE blogger_post_id IS NOT NULL;