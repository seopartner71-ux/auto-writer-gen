ALTER TABLE public.format_deployments
  ADD COLUMN IF NOT EXISTS archive_org_identifier text,
  ADD COLUMN IF NOT EXISTS archive_org_url text,
  ADD COLUMN IF NOT EXISTS archive_org_pdf_url text,
  ADD COLUMN IF NOT EXISTS archive_org_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_org_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS archive_org_error text;

CREATE INDEX IF NOT EXISTS idx_format_deployments_archive_status
  ON public.format_deployments (archive_org_status);

CREATE INDEX IF NOT EXISTS idx_format_deployments_archive_uploaded_at
  ON public.format_deployments (archive_org_uploaded_at DESC);

CREATE OR REPLACE FUNCTION public.validate_archive_org_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.archive_org_status IS NULL THEN
    NEW.archive_org_status := 'pending';
  END IF;
  IF NEW.archive_org_status NOT IN ('pending','uploading','uploaded','processing','available','error') THEN
    RAISE EXCEPTION 'invalid archive_org_status: %', NEW.archive_org_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_archive_org_status ON public.format_deployments;
CREATE TRIGGER trg_validate_archive_org_status
  BEFORE INSERT OR UPDATE ON public.format_deployments
  FOR EACH ROW EXECUTE FUNCTION public.validate_archive_org_status();