ALTER TABLE public.vc_writer_history
  ADD COLUMN IF NOT EXISTS author_persona text,
  ADD COLUMN IF NOT EXISTS verified_facts text,
  ADD COLUMN IF NOT EXISTS risk_report jsonb;