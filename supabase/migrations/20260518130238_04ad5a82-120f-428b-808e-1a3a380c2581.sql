-- Remove duplicates first, keeping earliest row per group
DELETE FROM public.tracked_keywords a USING public.tracked_keywords b
WHERE a.ctid > b.ctid
  AND a.user_id IS NOT DISTINCT FROM b.user_id
  AND a.keyword IS NOT DISTINCT FROM b.keyword
  AND a.target_domain IS NOT DISTINCT FROM b.target_domain
  AND a.engine IS NOT DISTINCT FROM b.engine
  AND COALESCE(a.region,'') = COALESCE(b.region,'')
  AND COALESCE(a.city,'') = COALESCE(b.city,'');

CREATE UNIQUE INDEX IF NOT EXISTS tracked_keywords_unique_idx
ON public.tracked_keywords (user_id, keyword, target_domain, engine, region, city);