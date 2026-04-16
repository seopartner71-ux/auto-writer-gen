
-- Analytics logs for tracking pixel hits
CREATE TABLE public.analytics_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  url text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_analytics_logs_project_id ON public.analytics_logs (project_id);
CREATE INDEX idx_analytics_logs_created_at ON public.analytics_logs (created_at);

ALTER TABLE public.analytics_logs ENABLE ROW LEVEL SECURITY;

-- Anon can insert (tracking pixel)
CREATE POLICY "Anon can insert analytics hits"
  ON public.analytics_logs FOR INSERT TO anon
  WITH CHECK (true);

-- Authenticated users can view analytics for own projects
CREATE POLICY "Users can view own project analytics"
  ON public.analytics_logs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = analytics_logs.project_id AND p.user_id = auth.uid()
  ));

-- Admins can view all
CREATE POLICY "Admins can view all analytics"
  ON public.analytics_logs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Add monitoring fields to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS last_ping_status text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_ping_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS total_views bigint DEFAULT 0;
