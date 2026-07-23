
ALTER TABLE public.ecosystem_formats
  ADD COLUMN IF NOT EXISTS progress smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS pdf_path text,
  ADD COLUMN IF NOT EXISTS error_reason text,
  ADD COLUMN IF NOT EXISTS retry_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS duration_ms integer;

ALTER TABLE public.ecosystem_formats REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ecosystem_formats;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END$$;

-- Storage RLS for the private ecosystem-formats bucket.
-- Path scheme: {user_id}/{ecosystem_id}/{format_type}/{ts}.pdf
DROP POLICY IF EXISTS "Users read own ecosystem formats" ON storage.objects;
DROP POLICY IF EXISTS "Service writes ecosystem formats" ON storage.objects;

CREATE POLICY "Users read own ecosystem formats" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'ecosystem-formats' AND (storage.foldername(name))[1] = auth.uid()::text
  );
