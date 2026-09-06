REVOKE EXECUTE ON FUNCTION public.commerce_content_autorun_wake_trg() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_content_autorun_wake_trg() TO service_role;