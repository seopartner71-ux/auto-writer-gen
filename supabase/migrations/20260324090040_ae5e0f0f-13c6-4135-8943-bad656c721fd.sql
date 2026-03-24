
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS price_usd integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description_ru text DEFAULT '',
  ADD COLUMN IF NOT EXISTS description_en text DEFAULT '';
