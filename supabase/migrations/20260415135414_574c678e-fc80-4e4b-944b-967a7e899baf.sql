ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS author_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS author_bio text DEFAULT '',
  ADD COLUMN IF NOT EXISTS author_avatar text DEFAULT '',
  ADD COLUMN IF NOT EXISTS primary_color text DEFAULT '',
  ADD COLUMN IF NOT EXISTS font_pair text DEFAULT '';