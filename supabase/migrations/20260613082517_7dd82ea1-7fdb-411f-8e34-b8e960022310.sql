
CREATE TABLE public.vc_writer_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  model text NOT NULL,
  generate_cover boolean NOT NULL DEFAULT false,
  total int NOT NULL DEFAULT 0,
  completed int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vc_writer_batches TO authenticated;
GRANT ALL ON public.vc_writer_batches TO service_role;
ALTER TABLE public.vc_writer_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vc_batches_select_own" ON public.vc_writer_batches FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "vc_batches_insert_own" ON public.vc_writer_batches FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "vc_batches_delete_own" ON public.vc_writer_batches FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.vc_writer_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.vc_writer_batches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  position int NOT NULL,
  format text NOT NULL,
  topic text NOT NULL,
  thesis text,
  audience text,
  tone text,
  length int NOT NULL DEFAULT 5500,
  status text NOT NULL DEFAULT 'queued',
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vc_writer_batch_items TO authenticated;
GRANT ALL ON public.vc_writer_batch_items TO service_role;
ALTER TABLE public.vc_writer_batch_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vc_items_select_own" ON public.vc_writer_batch_items FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "vc_items_insert_own" ON public.vc_writer_batch_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX vc_items_batch_pos_idx ON public.vc_writer_batch_items(batch_id, position);
CREATE INDEX vc_items_queued_idx ON public.vc_writer_batch_items(batch_id) WHERE status = 'queued';

CREATE OR REPLACE FUNCTION public.claim_vc_batch_item(p_batch_id uuid)
RETURNS public.vc_writer_batch_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.vc_writer_batch_items;
BEGIN
  UPDATE public.vc_writer_batch_items
  SET status = 'processing', updated_at = now()
  WHERE id = (
    SELECT id FROM public.vc_writer_batch_items
    WHERE batch_id = p_batch_id AND status = 'queued'
    ORDER BY position ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO r;
  RETURN r;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_vc_batch_item(uuid) TO service_role;
