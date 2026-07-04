ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_google_verification_file_format;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_google_verification_file_format
  CHECK (google_verification_file IS NULL OR google_verification_file ~ '^google[A-Za-z0-9_-]+\.html$');