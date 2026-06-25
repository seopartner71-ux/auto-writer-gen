CREATE UNIQUE INDEX IF NOT EXISTS content_plans_client_month_year_awaiting_uniq
ON public.content_plans (client_id, month, year)
WHERE client_id IS NOT NULL AND status = 'awaiting';