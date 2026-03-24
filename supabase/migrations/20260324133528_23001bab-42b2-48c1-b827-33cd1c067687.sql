ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS ghost_url text,
  ADD COLUMN IF NOT EXISTS ghost_api_key text,
  ADD COLUMN IF NOT EXISTS medium_token text;