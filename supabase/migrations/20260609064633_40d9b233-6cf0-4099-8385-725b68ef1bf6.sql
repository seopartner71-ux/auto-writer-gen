GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracked_keywords TO authenticated;
GRANT ALL ON public.tracked_keywords TO service_role;

GRANT SELECT ON public.rank_history TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.rank_history TO service_role;
GRANT ALL ON public.rank_history TO service_role;