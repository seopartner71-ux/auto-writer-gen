
-- Radar: brand monitoring projects
CREATE TABLE public.radar_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  brand_name text NOT NULL,
  domain text NOT NULL,
  data_nuggets text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.radar_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own radar projects" ON public.radar_projects
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Radar: keywords to track
CREATE TABLE public.radar_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid REFERENCES public.radar_projects(id) ON DELETE CASCADE NOT NULL,
  keyword text NOT NULL,
  is_active boolean DEFAULT true,
  last_checked_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.radar_keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own radar keywords" ON public.radar_keywords
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Radar: check results per keyword per model
CREATE TABLE public.radar_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  keyword_id uuid REFERENCES public.radar_keywords(id) ON DELETE CASCADE NOT NULL,
  model text NOT NULL,
  status text NOT NULL DEFAULT 'opportunity',
  brand_mentioned boolean DEFAULT false,
  domain_linked boolean DEFAULT false,
  competitor_domains text[] DEFAULT '{}',
  ai_response_text text,
  matched_snippets text[] DEFAULT '{}',
  checked_at timestamptz DEFAULT now()
);

ALTER TABLE public.radar_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own radar results" ON public.radar_results
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger for updated_at on radar_projects
CREATE TRIGGER update_radar_projects_updated_at
  BEFORE UPDATE ON public.radar_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
