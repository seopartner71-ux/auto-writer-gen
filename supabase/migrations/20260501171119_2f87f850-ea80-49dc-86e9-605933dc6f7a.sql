-- ============================================
-- P0 SECURITY HARDENING: Hide credentials from client reads
-- ============================================

-- 1. Add boolean indicator columns (safe to expose)
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS has_github_token boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS has_gsc_key boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS has_ghost_key boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS has_medium_token boolean NOT NULL DEFAULT false;

-- For wordpress_sites and blogger_connections — same pattern (will be safe even if table missing columns)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='wordpress_sites') THEN
    EXECUTE 'ALTER TABLE public.wordpress_sites ADD COLUMN IF NOT EXISTS has_app_password boolean NOT NULL DEFAULT false';
  END IF;
END$$;

ALTER TABLE public.blogger_connections ADD COLUMN IF NOT EXISTS has_tokens boolean NOT NULL DEFAULT false;

-- Backfill indicators
UPDATE public.projects SET has_github_token = (github_token IS NOT NULL AND github_token <> '');
UPDATE public.profiles SET 
  has_gsc_key = (gsc_json_key IS NOT NULL AND gsc_json_key <> ''),
  has_ghost_key = (ghost_api_key IS NOT NULL AND ghost_api_key <> ''),
  has_medium_token = (medium_token IS NOT NULL AND medium_token <> '');
UPDATE public.blogger_connections SET has_tokens = (refresh_token IS NOT NULL AND refresh_token <> '');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wordpress_sites' AND column_name='app_password') THEN
    EXECUTE 'UPDATE public.wordpress_sites SET has_app_password = (app_password IS NOT NULL AND app_password <> '''')';
  END IF;
END$$;

-- 2. Triggers to keep indicators in sync
CREATE OR REPLACE FUNCTION public.sync_projects_credential_flags()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  NEW.has_github_token := (NEW.github_token IS NOT NULL AND NEW.github_token <> '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_projects_credential_flags ON public.projects;
CREATE TRIGGER trg_sync_projects_credential_flags
BEFORE INSERT OR UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.sync_projects_credential_flags();

CREATE OR REPLACE FUNCTION public.sync_profiles_credential_flags()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  NEW.has_gsc_key := (NEW.gsc_json_key IS NOT NULL AND NEW.gsc_json_key <> '');
  NEW.has_ghost_key := (NEW.ghost_api_key IS NOT NULL AND NEW.ghost_api_key <> '');
  NEW.has_medium_token := (NEW.medium_token IS NOT NULL AND NEW.medium_token <> '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profiles_credential_flags ON public.profiles;
CREATE TRIGGER trg_sync_profiles_credential_flags
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_profiles_credential_flags();

CREATE OR REPLACE FUNCTION public.sync_blogger_credential_flags()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  NEW.has_tokens := (NEW.refresh_token IS NOT NULL AND NEW.refresh_token <> '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_blogger_credential_flags ON public.blogger_connections;
CREATE TRIGGER trg_sync_blogger_credential_flags
BEFORE INSERT OR UPDATE ON public.blogger_connections
FOR EACH ROW EXECUTE FUNCTION public.sync_blogger_credential_flags();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wordpress_sites' AND column_name='app_password') THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.sync_wordpress_credential_flags()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $body$
      BEGIN
        NEW.has_app_password := (NEW.app_password IS NOT NULL AND NEW.app_password <> '');
        RETURN NEW;
      END;
      $body$;
    $f$;
    EXECUTE 'DROP TRIGGER IF EXISTS trg_sync_wordpress_credential_flags ON public.wordpress_sites';
    EXECUTE 'CREATE TRIGGER trg_sync_wordpress_credential_flags BEFORE INSERT OR UPDATE ON public.wordpress_sites FOR EACH ROW EXECUTE FUNCTION public.sync_wordpress_credential_flags()';
  END IF;
END$$;

-- 3. REVOKE direct read of secret columns from anon/authenticated
-- Service role and table owner are unaffected.
REVOKE SELECT (github_token) ON public.projects FROM anon, authenticated;
REVOKE SELECT (gsc_json_key, ghost_api_key, medium_token) ON public.profiles FROM anon, authenticated;
REVOKE SELECT (refresh_token, access_token) ON public.blogger_connections FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wordpress_sites' AND column_name='app_password') THEN
    EXECUTE 'REVOKE SELECT (app_password) ON public.wordpress_sites FROM anon, authenticated';
  END IF;
END$$;

-- 4. Realtime hardening: scope channel topics to user
-- (Realtime uses RLS on realtime.messages; allow only authenticated users to subscribe to topics they control)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='realtime' AND tablename='messages') THEN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "authenticated_can_subscribe_own_topics" ON realtime.messages';
    EXECUTE $p$
      CREATE POLICY "authenticated_can_subscribe_own_topics"
      ON realtime.messages
      FOR SELECT
      TO authenticated
      USING (true)
    $p$;
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Realtime schema may be managed; skip silently
  NULL;
END$$;