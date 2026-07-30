ALTER TABLE public.ticket_messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;

-- Storage policies for private bucket support-attachments
DROP POLICY IF EXISTS "support-attachments owner insert" ON storage.objects;
DROP POLICY IF EXISTS "support-attachments owner select" ON storage.objects;
DROP POLICY IF EXISTS "support-attachments owner delete" ON storage.objects;

CREATE POLICY "support-attachments owner insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'support-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "support-attachments owner select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'support-attachments' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.has_role(auth.uid(), 'admin')));

CREATE POLICY "support-attachments owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'support-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);