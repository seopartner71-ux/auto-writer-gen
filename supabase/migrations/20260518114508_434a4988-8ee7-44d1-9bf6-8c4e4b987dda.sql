-- 1. Link tracked_keywords to articles
ALTER TABLE public.tracked_keywords
  ADD COLUMN IF NOT EXISTS article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tracked_keywords_article ON public.tracked_keywords(article_id) WHERE article_id IS NOT NULL;

-- 2. View: per-article SERP outcome aggregation
CREATE OR REPLACE VIEW public.article_serp_outcomes
WITH (security_invoker = true)
AS
SELECT
  a.id                              AS article_id,
  a.user_id                         AS user_id,
  a.title                           AS title,
  COALESCE(a.published_url, a.telegraph_url, a.blogger_post_url) AS public_url,
  a.created_at                      AS article_created_at,
  COUNT(DISTINCT tk.id)             AS tracked_keywords_count,
  MIN(rh.position) FILTER (WHERE rh.position IS NOT NULL) AS best_position,
  (
    SELECT rh2.position
    FROM public.rank_history rh2
    WHERE rh2.tracked_keyword_id IN (SELECT id FROM public.tracked_keywords WHERE article_id = a.id)
    ORDER BY rh2.checked_at DESC
    LIMIT 1
  )                                 AS latest_position,
  (
    SELECT rh3.checked_at
    FROM public.rank_history rh3
    WHERE rh3.tracked_keyword_id IN (SELECT id FROM public.tracked_keywords WHERE article_id = a.id)
    ORDER BY rh3.checked_at DESC
    LIMIT 1
  )                                 AS last_checked_at,
  MIN(rh.checked_at) FILTER (WHERE rh.position IS NOT NULL AND rh.position <= 10) AS first_top10_at,
  MIN(rh.checked_at) FILTER (WHERE rh.position IS NOT NULL AND rh.position <= 3)  AS first_top3_at
FROM public.articles a
JOIN public.tracked_keywords tk ON tk.article_id = a.id
LEFT JOIN public.rank_history rh ON rh.tracked_keyword_id = tk.id
GROUP BY a.id, a.user_id, a.title, a.published_url, a.telegraph_url, a.blogger_post_url, a.created_at;

GRANT SELECT ON public.article_serp_outcomes TO authenticated;