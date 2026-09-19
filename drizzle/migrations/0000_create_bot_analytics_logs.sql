CREATE TABLE public.bot_analytics_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name TEXT NOT NULL DEFAULT 'unknown',
  bot_name TEXT NOT NULL DEFAULT 'Other/Unknown',
  full_user_agent TEXT,
  ip_address TEXT,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bot_analytics_logs TO authenticated;
GRANT ALL ON public.bot_analytics_logs TO service_role;

ALTER TABLE public.bot_analytics_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read bot analytics"
ON public.bot_analytics_logs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_bot_analytics_logs_visited_at ON public.bot_analytics_logs (visited_at DESC);
CREATE INDEX idx_bot_analytics_logs_project ON public.bot_analytics_logs (project_name);