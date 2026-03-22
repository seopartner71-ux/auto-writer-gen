
CREATE TABLE public.wp_scheduled_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.wordpress_sites(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  scheduled_at timestamp with time zone NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  categories jsonb DEFAULT '[]',
  tags text DEFAULT '',
  seo_plugin text DEFAULT 'none',
  meta_title text,
  meta_description text,
  publish_immediately boolean DEFAULT true,
  wp_post_id integer,
  wp_post_url text,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.wp_scheduled_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own wp scheduled posts"
  ON public.wp_scheduled_posts FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_wp_scheduled_posts_updated_at
  BEFORE UPDATE ON public.wp_scheduled_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
