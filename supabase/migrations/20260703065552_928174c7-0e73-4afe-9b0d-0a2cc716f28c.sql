ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS google_verification_file text,
  ADD COLUMN IF NOT EXISTS gsc_account_note text,
  ADD COLUMN IF NOT EXISTS google_verification_file_deployed_at timestamptz;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_google_verification_file_format
  CHECK (google_verification_file IS NULL OR google_verification_file ~* '^google[a-f0-9]+\.html$');