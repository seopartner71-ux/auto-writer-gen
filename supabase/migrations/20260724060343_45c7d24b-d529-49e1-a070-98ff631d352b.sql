
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS expert_photo_url text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text;

ALTER TABLE public.ecosystem_formats
  ADD COLUMN IF NOT EXISTS image_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

DROP POLICY IF EXISTS "client-experts owner select" ON storage.objects;
DROP POLICY IF EXISTS "client-experts owner insert" ON storage.objects;
DROP POLICY IF EXISTS "client-experts owner update" ON storage.objects;
DROP POLICY IF EXISTS "client-experts owner delete" ON storage.objects;

CREATE POLICY "client-experts owner select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'client-experts' AND owner = auth.uid());

CREATE POLICY "client-experts owner insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-experts' AND owner = auth.uid());

CREATE POLICY "client-experts owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'client-experts' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'client-experts' AND owner = auth.uid());

CREATE POLICY "client-experts owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'client-experts' AND owner = auth.uid());
