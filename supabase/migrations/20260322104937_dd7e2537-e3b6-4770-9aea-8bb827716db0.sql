CREATE POLICY "Users can delete own bulk job items"
ON public.bulk_job_items
FOR DELETE
TO public
USING (EXISTS (
  SELECT 1 FROM bulk_jobs bj
  WHERE bj.id = bulk_job_items.bulk_job_id AND bj.user_id = auth.uid()
));