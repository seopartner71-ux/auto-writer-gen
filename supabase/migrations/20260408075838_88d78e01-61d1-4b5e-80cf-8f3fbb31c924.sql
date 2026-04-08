
-- Prompt groups table
CREATE TABLE public.radar_prompt_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.radar_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.radar_prompt_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own radar prompt groups"
  ON public.radar_prompt_groups FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Prompts table
CREATE TABLE public.radar_prompts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID REFERENCES public.radar_prompt_groups(id) ON DELETE SET NULL,
  project_id UUID NOT NULL REFERENCES public.radar_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.radar_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own radar prompts"
  ON public.radar_prompts FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Analysis runs table
CREATE TABLE public.radar_analysis_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.radar_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  total_prompts INTEGER DEFAULT 0,
  completed_prompts INTEGER DEFAULT 0,
  current_model TEXT,
  current_prompt_text TEXT,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.radar_analysis_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own radar analysis runs"
  ON public.radar_analysis_runs FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add columns to radar_results
ALTER TABLE public.radar_results
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.radar_analysis_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prompt_id UUID REFERENCES public.radar_prompts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sources JSONB DEFAULT '[]'::jsonb;

-- Enable realtime for analysis runs (progress tracking)
ALTER PUBLICATION supabase_realtime ADD TABLE public.radar_analysis_runs;

-- Indexes
CREATE INDEX idx_radar_prompts_project ON public.radar_prompts(project_id);
CREATE INDEX idx_radar_prompts_group ON public.radar_prompts(group_id);
CREATE INDEX idx_radar_prompt_groups_project ON public.radar_prompt_groups(project_id);
CREATE INDEX idx_radar_results_run ON public.radar_results(run_id);
CREATE INDEX idx_radar_results_prompt ON public.radar_results(prompt_id);
CREATE INDEX idx_radar_analysis_runs_project ON public.radar_analysis_runs(project_id);
