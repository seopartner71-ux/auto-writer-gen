
CREATE TABLE IF NOT EXISTS public.cost_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  project_id uuid,
  user_id uuid,
  operation_type text NOT NULL CHECK (operation_type IN (
    'site_generation',
    'article_generation',
    'fal_ai_photo',
    'fal_ai_portrait',
    'fal_ai_logo',
    'cloudflare_deploy',
    'auto_post_cron'
  )),
  model text,
  tokens_input integer NOT NULL DEFAULT 0,
  tokens_output integer NOT NULL DEFAULT 0,
  cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cost_log_created_at ON public.cost_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_log_project_id ON public.cost_log (project_id);
CREATE INDEX IF NOT EXISTS idx_cost_log_operation_type ON public.cost_log (operation_type);
CREATE INDEX IF NOT EXISTS idx_cost_log_user_id ON public.cost_log (user_id);

ALTER TABLE public.cost_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all cost logs"
  ON public.cost_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "No client inserts on cost_log"
  ON public.cost_log
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

CREATE POLICY "No client updates on cost_log"
  ON public.cost_log
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated, anon
  USING (false);

CREATE POLICY "No client deletes on cost_log"
  ON public.cost_log
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated, anon
  USING (false);

INSERT INTO public.app_settings (key, value, description)
VALUES ('usd_to_rub_rate', '90', 'Курс доллара к рублю для отображения расходов')
ON CONFLICT (key) DO NOTHING;
