
DROP VIEW IF EXISTS public.public_articles;

CREATE VIEW public.public_articles WITH (security_invoker = on) AS
SELECT id, title, content, meta_description, keywords, language, geo, created_at, updated_at, published_url, author_profile_id, share_token
FROM public.articles
WHERE is_public = true;
