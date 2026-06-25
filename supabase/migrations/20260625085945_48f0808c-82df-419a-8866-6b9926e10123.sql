
ALTER TABLE public.content_topics
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.content_topics
  ALTER COLUMN gen_status SET DEFAULT 'pending';

UPDATE public.content_topics SET gen_status = 'pending' WHERE gen_status IS NULL OR gen_status = 'waiting';

ALTER TABLE public.content_plans
  ADD COLUMN IF NOT EXISTS template_settings jsonb;

ALTER TABLE public.content_topics REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'content_topics'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.content_topics';
  END IF;
END $$;
