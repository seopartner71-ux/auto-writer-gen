ALTER TABLE public.format_deployments
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS indexnow_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS indexnow_response jsonb,
  ADD COLUMN IF NOT EXISTS indexing_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS indexing_status_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS indexing_status_google text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS indexing_status_yandex text NOT NULL DEFAULT 'pending';

ALTER TABLE public.format_deployments
  DROP CONSTRAINT IF EXISTS format_deployments_indexing_status_chk;
ALTER TABLE public.format_deployments
  ADD CONSTRAINT format_deployments_indexing_status_chk
  CHECK (
    indexing_status IN ('pending','submitted','indexed','error')
    AND indexing_status_google IN ('pending','submitted','indexed','error')
    AND indexing_status_yandex IN ('pending','submitted','indexed','error')
  );

CREATE INDEX IF NOT EXISTS idx_format_deployments_deployed_at
  ON public.format_deployments (deployed_at DESC);

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS indexnow_key text;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS auto_indexnow boolean NOT NULL DEFAULT true;