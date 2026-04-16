
CREATE OR REPLACE FUNCTION public.protect_sensitive_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- If gsc_json_key is being set to NULL but OLD had a value, preserve it
  IF NEW.gsc_json_key IS NULL AND OLD.gsc_json_key IS NOT NULL THEN
    NEW.gsc_json_key := OLD.gsc_json_key;
  END IF;
  
  -- Same protection for ghost_api_key
  IF NEW.ghost_api_key IS NULL AND OLD.ghost_api_key IS NOT NULL THEN
    NEW.ghost_api_key := OLD.ghost_api_key;
  END IF;
  
  -- Same protection for ghost_url
  IF NEW.ghost_url IS NULL AND OLD.ghost_url IS NOT NULL THEN
    NEW.ghost_url := OLD.ghost_url;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_profile_sensitive_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_sensitive_profile_fields();
