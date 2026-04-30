ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS ai_model text NOT NULL DEFAULT 'gemini-flash';

-- Validation: only known values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_ai_model_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_ai_model_check
      CHECK (ai_model IN ('gemini-flash', 'claude-sonnet'));
  END IF;
END $$;