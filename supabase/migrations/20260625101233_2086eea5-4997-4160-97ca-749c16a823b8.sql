
WITH ranked AS (
  SELECT cp.id, cp.client_id, cp.month, cp.year,
    (SELECT COUNT(*) FROM public.content_topics ct WHERE ct.plan_id = cp.id) AS topic_count,
    cp.created_at
  FROM public.content_plans cp
  WHERE cp.status = 'in_progress'
),
keepers AS (
  SELECT DISTINCT ON (client_id, month, year) id
  FROM ranked
  ORDER BY client_id, month, year, topic_count DESC, created_at ASC, id ASC
),
to_delete AS (
  SELECT r.id FROM ranked r
  WHERE r.id NOT IN (SELECT id FROM keepers)
)
DELETE FROM public.content_topics WHERE plan_id IN (SELECT id FROM to_delete);

WITH ranked AS (
  SELECT cp.id, cp.client_id, cp.month, cp.year,
    (SELECT COUNT(*) FROM public.content_topics ct WHERE ct.plan_id = cp.id) AS topic_count,
    cp.created_at
  FROM public.content_plans cp
  WHERE cp.status = 'in_progress'
),
keepers AS (
  SELECT DISTINCT ON (client_id, month, year) id
  FROM ranked
  ORDER BY client_id, month, year, topic_count DESC, created_at ASC, id ASC
)
DELETE FROM public.content_plans
WHERE status = 'in_progress'
  AND id NOT IN (SELECT id FROM keepers);

CREATE UNIQUE INDEX IF NOT EXISTS content_plans_client_month_year_inprogress_unique
ON public.content_plans (client_id, month, year)
WHERE status = 'in_progress';
