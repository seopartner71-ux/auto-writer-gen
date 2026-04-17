ALTER TABLE public.bulk_jobs
  ADD COLUMN IF NOT EXISTS auto_publish_blogger boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blogger_blog_id text;