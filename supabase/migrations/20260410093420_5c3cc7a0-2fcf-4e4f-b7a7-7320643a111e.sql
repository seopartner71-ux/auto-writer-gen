
-- Drop and recreate the public_articles view to exclude sensitive tokens
DROP VIEW IF EXISTS public.public_articles;
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
