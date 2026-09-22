ALTER TABLE public.bot_analytics_logs
  ADD COLUMN IF NOT EXISTS requested_file text,
  ADD COLUMN IF NOT EXISTS repository_name text;

ALTER TABLE public.bot_analytics_logs REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bot_analytics_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bot_analytics_logs;
  END IF;
END $$;