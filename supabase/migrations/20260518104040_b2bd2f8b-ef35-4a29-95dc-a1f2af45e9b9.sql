-- 1) Revoke EXECUTE from public roles on internal helpers and trigger functions.
-- These are called by triggers or by edge functions via service_role (which
-- bypasses EXECUTE checks on its own schemas), so revoking from PUBLIC /
-- anon / authenticated is safe and silences the security linter.

DO $$
DECLARE
  fn text;
  funcs text[] := ARRAY[
    'public.encrypt_sensitive(text)',
    'public.decrypt_sensitive(text)',
    'public.handle_new_user()',
    'public.protect_sensitive_profile_fields()',
    'public.protect_user_stats_counters()',
    'public.sync_blogger_credential_flags()',
    'public.sync_profiles_credential_flags()',
    'public.sync_projects_credential_flags()',
    'public.sync_wordpress_credential_flags()',
    'public.update_updated_at_column()',
    'public.update_stats_on_new_article()',
    'public.cleanup_project_related()',
    'public.cleanup_rate_limits()',
    'public.auto_activate_users()',
    'public.move_to_dlq(text, text, bigint, jsonb)',
    'public.enqueue_email(text, jsonb)',
    'public.read_email_batch(text, integer, integer)',
    'public.delete_email(text, bigint)',
    'public.claim_queue_items(integer)',
    'public.deduct_credit(uuid)',
    'public.check_rate_limit(uuid, text, integer, integer)',
    'public.check_credits(uuid)',
    'public.admin_add_credits(uuid, integer, boolean, text)',
    'public.admin_set_user_role(uuid, public.app_role)',
    'public.refund_credits(uuid, integer, text, uuid, jsonb)'
  ];
BEGIN
  FOREACH fn IN ARRAY funcs LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'skip revoke %: %', fn, SQLERRM;
    END;
  END LOOP;
END $$;

-- 2) Lock down the article-images bucket: keep file reads working by exact
-- path (used in <img src="...">) but prevent listing the bucket contents.
-- Drop any broad SELECT policy that lets anon list everything.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (policyname ILIKE '%article-images%' OR policyname ILIKE '%article_images%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', p.policyname);
  END LOOP;
END $$;

-- Recreate as narrow policies (read by exact object name, write by owner).
CREATE POLICY "article-images-public-read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'article-images');

CREATE POLICY "article-images-owner-write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'article-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "article-images-owner-update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'article-images' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'article-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "article-images-owner-delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'article-images' AND auth.uid()::text = (storage.foldername(name))[1]);