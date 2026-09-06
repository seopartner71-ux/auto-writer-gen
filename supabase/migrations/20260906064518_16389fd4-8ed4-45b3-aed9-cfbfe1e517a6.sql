CREATE TABLE IF NOT EXISTS public.commerce_content_autorun (
  project_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'idle',
  paused_reason text,
  batch_size integer NOT NULL DEFAULT 10,
  lease_until timestamptz,
  last_run_at timestamptz,
  processed_total integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.commerce_content_autorun
  DROP CONSTRAINT IF EXISTS commerce_content_autorun_status_chk;
ALTER TABLE public.commerce_content_autorun
  ADD CONSTRAINT commerce_content_autorun_status_chk
  CHECK (status IN ('idle','running','paused','done'));

ALTER TABLE public.commerce_content_autorun
  DROP CONSTRAINT IF EXISTS commerce_content_autorun_batch_chk;
ALTER TABLE public.commerce_content_autorun
  ADD CONSTRAINT commerce_content_autorun_batch_chk
  CHECK (batch_size BETWEEN 1 AND 40);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commerce_content_autorun TO authenticated;
GRANT ALL ON public.commerce_content_autorun TO service_role;

ALTER TABLE public.commerce_content_autorun ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own commerce autorun" ON public.commerce_content_autorun;
CREATE POLICY "Users manage own commerce autorun"
  ON public.commerce_content_autorun FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_commerce_content_autorun_updated_at ON public.commerce_content_autorun;
CREATE TRIGGER update_commerce_content_autorun_updated_at
  BEFORE UPDATE ON public.commerce_content_autorun
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS commerce_content_autorun_active_idx
  ON public.commerce_content_autorun (enabled, status, lease_until);

INSERT INTO public.internal_cron_secrets (name, secret_value)
VALUES ('commerce_content_worker', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;