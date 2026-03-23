INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('article-images', 'article-images', true, 1048576, ARRAY['image/webp', 'image/jpeg', 'image/png']);

CREATE POLICY "Users can upload own images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'article-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Public read for article images"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'article-images');

CREATE POLICY "Users can delete own images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'article-images' AND (storage.foldername(name))[1] = auth.uid()::text);