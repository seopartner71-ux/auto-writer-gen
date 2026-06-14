ALTER TABLE public.vc_writer_batch_items ADD COLUMN IF NOT EXISTS funnel_stage TEXT;
ALTER TABLE public.vc_writer_history ADD COLUMN IF NOT EXISTS funnel_stage TEXT;