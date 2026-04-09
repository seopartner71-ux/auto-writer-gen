
-- Add feature_flags JSONB column
ALTER TABLE public.subscription_plans
ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Seed default feature flags for existing plans
UPDATE public.subscription_plans SET feature_flags = '{
  "maxAuthorProfiles": 1,
  "maxProImages": 0,
  "models": ["google/gemini-2.5-flash-lite"],
  "hasCalendar": false,
  "hasUniquenessCheck": false,
  "hasJsonLdSchema": false,
  "hasFullSerp": false,
  "hasAntiAiCheck": false,
  "hasBulkMode": false,
  "hasWordPress": false,
  "hasProImageGen": false,
  "hasMiralinks": false,
  "hasGoGetLinks": false,
  "hasProjects": false,
  "hasRadar": false
}'::jsonb WHERE id = 'free';

UPDATE public.subscription_plans SET feature_flags = '{
  "maxAuthorProfiles": 5,
  "maxProImages": 0,
  "models": ["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash", "openai/gpt-5-nano"],
  "hasCalendar": false,
  "hasUniquenessCheck": true,
  "hasJsonLdSchema": true,
  "hasFullSerp": true,
  "hasAntiAiCheck": true,
  "hasBulkMode": false,
  "hasWordPress": false,
  "hasProImageGen": false,
  "hasMiralinks": false,
  "hasGoGetLinks": false,
  "hasProjects": false,
  "hasRadar": false
}'::jsonb WHERE id = 'basic';

UPDATE public.subscription_plans SET feature_flags = '{
  "maxAuthorProfiles": -1,
  "maxProImages": 100,
  "models": ["google/gemini-2.5-pro", "openai/gpt-5", "google/gemini-2.5-flash", "google/gemini-2.5-flash-lite", "openai/gpt-5-nano"],
  "hasCalendar": true,
  "hasUniquenessCheck": true,
  "hasJsonLdSchema": true,
  "hasFullSerp": true,
  "hasAntiAiCheck": true,
  "hasBulkMode": true,
  "hasWordPress": true,
  "hasProImageGen": true,
  "hasMiralinks": true,
  "hasGoGetLinks": true,
  "hasProjects": true,
  "hasRadar": true
}'::jsonb WHERE id = 'pro';
