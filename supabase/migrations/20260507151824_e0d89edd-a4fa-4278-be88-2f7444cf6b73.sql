ALTER TABLE public.author_profiles 
ADD COLUMN IF NOT EXISTS system_instruction_backup text,
ADD COLUMN IF NOT EXISTS prompt_improved_at timestamp with time zone;