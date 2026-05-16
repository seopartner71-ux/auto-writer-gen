
-- 1) Fix search_path on pgmq wrappers
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public;

-- 2) Tighten permissive RLS policies
DROP POLICY IF EXISTS "Anon can insert analytics hits" ON public.analytics_logs;
CREATE POLICY "Anon can insert analytics hits"
  ON public.analytics_logs
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (project_id IS NOT NULL);

DROP POLICY IF EXISTS "Service role can insert error_logs" ON public.error_logs;
CREATE POLICY "Service role can insert error_logs"
  ON public.error_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 3) sandbox_rate_limits: RLS on, no policies. Lock down to service_role only.
DROP POLICY IF EXISTS "Service role manages sandbox rate limits" ON public.sandbox_rate_limits;
CREATE POLICY "Service role manages sandbox rate limits"
  ON public.sandbox_rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4) Revoke EXECUTE on sensitive SECURITY DEFINER functions from anon/authenticated.
-- These must be callable only via service_role (edge functions, triggers, cron).

-- Encryption — never expose
REVOKE EXECUTE ON FUNCTION public.encrypt_sensitive(text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrypt_sensitive(text) FROM anon, authenticated, PUBLIC;

-- Credit mutation — backend only
REVOKE EXECUTE ON FUNCTION public.deduct_credit(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deduct_credits_v2(uuid, integer, text, text, uuid, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_credits(uuid, integer, text, uuid, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_add_credits(uuid, integer, boolean, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, app_role) FROM anon, PUBLIC;

-- Cron / internal helpers
REVOKE EXECUTE ON FUNCTION public.auto_activate_users() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_queue_items(integer) FROM anon, authenticated, PUBLIC;

-- Email queue — backend only
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, authenticated, PUBLIC;

-- Trigger functions — never called directly
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_project_related() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.protect_sensitive_profile_fields() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.protect_user_stats_counters() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_blogger_credential_flags() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_profiles_credential_flags() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_projects_credential_flags() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_wordpress_credential_flags() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_stats_on_new_article() FROM anon, authenticated, PUBLIC;

-- Hide budget/server-side helpers from anon (keep for authenticated where needed via edge)
REVOKE EXECUTE ON FUNCTION public.check_ai_budget(uuid, text) FROM anon, PUBLIC;
-- has_role/check_credits/match_project_articles/get_project_github_config/
-- increment_project_views/calculate_generation_cost/check_rate_limit:
-- intentionally callable by authenticated users (RLS / business logic).
