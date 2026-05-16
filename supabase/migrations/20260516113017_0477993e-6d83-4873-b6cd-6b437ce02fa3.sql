
ALTER TABLE public.subscription_plans REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.subscription_plans';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
