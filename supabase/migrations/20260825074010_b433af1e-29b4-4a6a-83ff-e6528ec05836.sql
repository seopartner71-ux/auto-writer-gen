ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS last_shared_hash text,
  ADD COLUMN IF NOT EXISTS last_release_id uuid;