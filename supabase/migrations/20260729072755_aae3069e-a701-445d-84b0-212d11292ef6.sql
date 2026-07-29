-- 1. document_types.generation_pattern
ALTER TABLE public.document_types
  ADD COLUMN IF NOT EXISTS generation_pattern text NOT NULL DEFAULT 'inline'
  CHECK (generation_pattern IN ('inline','background'));

UPDATE public.document_types
  SET generation_pattern = 'background'
  WHERE slug IN ('whitepaper','catalog');

-- 2. Reset stuck generations (>5 min in 'generating')
CREATE OR REPLACE FUNCTION public.reset_stuck_document_generations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH upd AS (
    UPDATE public.ecosystem_formats
       SET status = 'failed',
           error_reason = COALESCE(error_reason, 'Stuck generation reset (>5 min in generating)'),
           updated_at = now()
     WHERE status = 'generating'
       AND updated_at < now() - interval '5 minutes'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$$;

-- Immediate cleanup of currently stuck rows
SELECT public.reset_stuck_document_generations();

-- 3. Queue table for background document jobs
CREATE TABLE IF NOT EXISTS public.document_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem_format_id uuid NOT NULL REFERENCES public.ecosystem_formats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.document_generation_jobs TO authenticated;
GRANT ALL ON public.document_generation_jobs TO service_role;

ALTER TABLE public.document_generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their document jobs"
  ON public.document_generation_jobs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_docjobs_status_created
  ON public.document_generation_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_docjobs_format
  ON public.document_generation_jobs (ecosystem_format_id);

CREATE TRIGGER trg_docjobs_updated_at
  BEFORE UPDATE ON public.document_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();