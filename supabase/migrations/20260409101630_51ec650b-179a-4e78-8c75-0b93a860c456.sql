
-- Create projects table
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'ru',
  region TEXT NOT NULL DEFAULT 'RU',
  auto_interlinking BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own projects"
  ON public.projects FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own projects"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects"
  ON public.projects FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects"
  ON public.projects FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all projects"
  ON public.projects FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- Timestamp trigger
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add project_id to articles
ALTER TABLE public.articles
  ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

-- Add keywords array to articles
ALTER TABLE public.articles
  ADD COLUMN keywords TEXT[] DEFAULT '{}';

-- Index for fast lookups
CREATE INDEX idx_articles_project_id ON public.articles(project_id);
CREATE INDEX idx_projects_user_id ON public.projects(user_id);
