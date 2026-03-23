
-- FAQ categories
CREATE TABLE public.faq_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  icon text DEFAULT 'BookOpen',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- FAQ articles
CREATE TABLE public.faq_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES public.faq_categories(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  slug text NOT NULL,
  content text NOT NULL DEFAULT '',
  sort_order integer DEFAULT 0,
  is_published boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(category_id, slug)
);

-- RLS
ALTER TABLE public.faq_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faq_articles ENABLE ROW LEVEL SECURITY;

-- Everyone can read
CREATE POLICY "Anyone can view faq categories" ON public.faq_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone can view published faq articles" ON public.faq_articles FOR SELECT TO authenticated USING (is_published = true);

-- Only admins can manage
CREATE POLICY "Admins can manage faq categories" ON public.faq_categories FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can manage faq articles" ON public.faq_articles FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Updated_at trigger
CREATE TRIGGER update_faq_articles_updated_at BEFORE UPDATE ON public.faq_articles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
