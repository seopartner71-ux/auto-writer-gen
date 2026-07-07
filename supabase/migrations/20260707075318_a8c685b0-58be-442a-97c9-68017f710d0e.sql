-- 1) Add stop-request flag for the improve pipeline
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS improve_stop_requested boolean NOT NULL DEFAULT false;

-- 2) Reset all currently-stuck quality_status='checking' rows.
-- The stale-status logic was masked by lingering 'improve' events; now that
-- it filters to quality_check/ai_detect only, we unblock the backlog manually.
UPDATE public.articles
   SET quality_status = NULL,
       updated_at = now()
 WHERE quality_status = 'checking'
   AND updated_at < now() - interval '30 minutes';
