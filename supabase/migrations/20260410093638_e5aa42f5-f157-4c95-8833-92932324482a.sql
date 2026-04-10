
-- Drop the view first since it may reference articles
DROP VIEW IF EXISTS public.public_articles;

-- Remove the sensitive column
ALTER TABLE public.articles DROP COLUMN IF EXISTS telegraph_access_token;

-- Recreate the view without the sensitive column
CREATE VIEW public.public_articles AS
SELECT
  id,
  title,
  content,
  meta_description,
  keywords,
  language,
  geo,
  published_url,
  author_profile_id,
  created_at,
  updated_at
FROM public.articles
WHERE is_public = true;

ALTER VIEW public.public_articles SET (security_invoker = on);
