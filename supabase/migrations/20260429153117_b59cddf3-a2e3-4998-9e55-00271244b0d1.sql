
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS juridical_inn text,
  ADD COLUMN IF NOT EXISTS legal_address text,
  ADD COLUMN IF NOT EXISTS work_hours text,
  ADD COLUMN IF NOT EXISTS whatsapp_url text,
  ADD COLUMN IF NOT EXISTS telegram_url text,
  ADD COLUMN IF NOT EXISTS vk_url text,
  ADD COLUMN IF NOT EXISTS youtube_url text,
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS clients_count_text text,
  ADD COLUMN IF NOT EXISTS authors jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS business_pages jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_post_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_weekly_post boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.site_post_schedule_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  message text,
  keyword text,
  article_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.site_post_schedule_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own schedule logs" ON public.site_post_schedule_logs;
CREATE POLICY "Users view own schedule logs" ON public.site_post_schedule_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins manage schedule logs" ON public.site_post_schedule_logs;
CREATE POLICY "Admins manage schedule logs" ON public.site_post_schedule_logs
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_post_schedule_logs_project ON public.site_post_schedule_logs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_auto_weekly ON public.projects(auto_weekly_post) WHERE auto_weekly_post = true;
