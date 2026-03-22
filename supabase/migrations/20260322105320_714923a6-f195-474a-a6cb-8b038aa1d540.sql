CREATE TABLE public.wordpress_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_url text NOT NULL,
  username text NOT NULL,
  app_password text NOT NULL,
  site_name text,
  is_connected boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, site_url)
);

ALTER TABLE public.wordpress_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own WP sites"
ON public.wordpress_sites FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_wordpress_sites_updated_at
  BEFORE UPDATE ON public.wordpress_sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();