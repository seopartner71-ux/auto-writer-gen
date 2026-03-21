
-- Enum для ролей
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Профили
CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email text,
    full_name text,
    plan text DEFAULT 'basic',
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Роли
CREATE TABLE public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

-- Security Definer Function
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Author Profiles
CREATE TABLE public.author_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    voice_tone text,
    style_examples text,
    stop_words text[],
    system_prompt_override text,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.author_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own author profiles" ON public.author_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own author profiles" ON public.author_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own author profiles" ON public.author_profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own author profiles" ON public.author_profiles FOR DELETE USING (auth.uid() = user_id);

-- Keywords
CREATE TABLE public.keywords (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    seed_keyword text NOT NULL,
    lsi_keywords text[],
    questions text[],
    intent text,
    volume integer,
    difficulty integer,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own keywords" ON public.keywords FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own keywords" ON public.keywords FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own keywords" ON public.keywords FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own keywords" ON public.keywords FOR DELETE USING (auth.uid() = user_id);

-- SERP Results
CREATE TABLE public.serp_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword_id uuid REFERENCES public.keywords(id) ON DELETE CASCADE NOT NULL,
    position integer,
    url text,
    title text,
    snippet text,
    word_count integer,
    headings jsonb,
    analyzed_at timestamptz DEFAULT now()
);

ALTER TABLE public.serp_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view serp results for own keywords" ON public.serp_results
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.keywords k WHERE k.id = keyword_id AND k.user_id = auth.uid())
  );
CREATE POLICY "Users can insert serp results for own keywords" ON public.serp_results
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.keywords k WHERE k.id = keyword_id AND k.user_id = auth.uid())
  );

-- Articles
CREATE TABLE public.articles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    keyword_id uuid REFERENCES public.keywords(id),
    author_profile_id uuid REFERENCES public.author_profiles(id),
    title text,
    content text,
    meta_description text,
    seo_score jsonb,
    status text DEFAULT 'draft',
    scheduled_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own articles" ON public.articles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own articles" ON public.articles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own articles" ON public.articles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own articles" ON public.articles FOR DELETE USING (auth.uid() = user_id);

-- AI Models Config (admin managed)
CREATE TABLE public.ai_models (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    model_key text UNIQUE NOT NULL,
    display_name text,
    tier text,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active models" ON public.ai_models FOR SELECT USING (is_active = true);
CREATE POLICY "Admins can manage models" ON public.ai_models FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Usage Logs
CREATE TABLE public.usage_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    action text,
    model_used text,
    tokens_used integer,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage" ON public.usage_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all usage" ON public.usage_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Trigger: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_articles_updated_at
  BEFORE UPDATE ON public.articles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
