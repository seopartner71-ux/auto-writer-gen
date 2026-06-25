ALTER TABLE public.content_plans DROP CONSTRAINT IF EXISTS content_plans_status_check;
ALTER TABLE public.content_plans ADD CONSTRAINT content_plans_status_check
  CHECK (status IN ('awaiting','review','responded','in_progress','paused','done','completed'));