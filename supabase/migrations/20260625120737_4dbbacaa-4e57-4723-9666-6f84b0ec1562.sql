
REVOKE EXECUTE ON FUNCTION public.tg_notify(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_check_stuck_queue() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_send_daily_summary() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_trigger_article_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_trigger_new_profile() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_trigger_profile_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_trigger_plan_responded() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.tg_notify(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_check_stuck_queue() TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_send_daily_summary() TO service_role;
