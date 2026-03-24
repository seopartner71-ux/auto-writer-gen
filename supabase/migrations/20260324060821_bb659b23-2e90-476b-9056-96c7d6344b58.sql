
-- Step 1: New enum for article status
CREATE TYPE public.article_status AS ENUM ('research', 'outline', 'generating', 'completed');

-- Step 2: Add new columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'ru',
  ADD COLUMN IF NOT EXISTS theme_preference TEXT DEFAULT 'dark';

-- Step 3: Clusters table
CREATE TABLE public.clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own clusters" ON public.clusters FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all clusters" ON public.clusters FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Step 4: Article metrics table
CREATE TABLE public.article_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  word_count INTEGER DEFAULT 0,
  character_count INTEGER DEFAULT 0,
  reading_time_minutes INTEGER DEFAULT 0,
  h2_count INTEGER DEFAULT 0,
  h3_count INTEGER DEFAULT 0,
  images_count INTEGER DEFAULT 0,
  keyword_density DECIMAL(5,2) DEFAULT 0,
  lsi_covered_count INTEGER DEFAULT 0,
  content_score INTEGER DEFAULT 0,
  is_title_optimal BOOLEAN DEFAULT false,
  is_description_optimal BOOLEAN DEFAULT false,
  schema_json JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.article_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own article metrics" ON public.article_metrics FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM articles a WHERE a.id = article_metrics.article_id AND a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM articles a WHERE a.id = article_metrics.article_id AND a.user_id = auth.uid()));
CREATE POLICY "Admins can view all article metrics" ON public.article_metrics FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Step 5: Competitors table
CREATE TABLE public.competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT,
  meta_description TEXT,
  type TEXT,
  word_count INTEGER DEFAULT 0,
  h2_count INTEGER DEFAULT 0,
  is_selected BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own competitors" ON public.competitors FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM articles a WHERE a.id = competitors.article_id AND a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM articles a WHERE a.id = competitors.article_id AND a.user_id = auth.uid()));
CREATE POLICY "Admins can view all competitors" ON public.competitors FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Step 6: PAA Questions table
CREATE TABLE public.paa_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer_snippet TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.paa_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own paa questions" ON public.paa_questions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM articles a WHERE a.id = paa_questions.article_id AND a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM articles a WHERE a.id = paa_questions.article_id AND a.user_id = auth.uid()));

-- Step 7: Article versions table
CREATE TABLE public.article_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.article_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own article versions" ON public.article_versions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM articles a WHERE a.id = article_versions.article_id AND a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM articles a WHERE a.id = article_versions.article_id AND a.user_id = auth.uid()));

-- Step 8: User stats table
CREATE TABLE public.user_stats (
  user_id UUID PRIMARY KEY,
  total_articles_created INTEGER DEFAULT 0,
  total_words_generated INTEGER DEFAULT 0,
  average_content_score DECIMAL(5,2) DEFAULT 0,
  last_activity_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own stats" ON public.user_stats FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users can update own stats" ON public.user_stats FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all stats" ON public.user_stats FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Step 9: Add new columns to articles
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS geo TEXT DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS lsi_keywords JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS suggested_outline JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_content_gap JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS share_token UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS cluster_id UUID REFERENCES public.clusters(id) ON DELETE SET NULL;

-- Step 10: RLS policy for public article access
CREATE POLICY "Public article access" ON public.articles FOR SELECT USING (is_public = true);
