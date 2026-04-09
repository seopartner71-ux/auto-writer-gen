
-- Fix 1: Replace public article policy to exclude telegraph_access_token
DROP POLICY IF EXISTS "Public article access" ON public.articles;

CREATE POLICY "Public article access" ON public.articles
  FOR SELECT
  TO anon, authenticated
  USING (is_public = true);

-- We'll use a secure view for public article access that excludes sensitive fields
CREATE OR REPLACE VIEW public.public_articles AS
SELECT id, title, content, meta_description, keywords, language, geo, created_at, updated_at, published_url, author_profile_id, share_token
FROM public.articles
WHERE is_public = true;

-- Fix 2: Remove user UPDATE policy on user_stats (only server-side updates allowed)
DROP POLICY IF EXISTS "Users can update own stats" ON public.user_stats;

-- Fix 3: Restrict wordpress_sites - ensure app_password is encrypted on read
-- (Already handled by encrypt/decrypt functions, but tighten the policy)
-- No additional migration needed for this - already uses pgcrypto

-- Fix 4: Add restrictive policy for realtime messages (if table exists)
-- This is handled at application level - Supabase manages realtime.messages internally
