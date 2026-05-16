
UPDATE public.subscription_plans SET features = jsonb_set(features, '{0}', '{"text_en": "150 credits / mo (~30 articles)", "text_ru": "150 кредитов / мес (~30 статей)", "included": true}'::jsonb) WHERE id = 'free';

UPDATE public.subscription_plans SET features = jsonb_set(features, '{0}', '{"text_en": "450 credits / mo (~90 articles)", "text_ru": "450 кредитов / мес (~90 статей)", "included": true}'::jsonb) WHERE id = 'basic';

UPDATE public.subscription_plans SET features = jsonb_set(features, '{0}', '{"text_en": "1300 credits / mo (~260 articles)", "text_ru": "1300 кредитов / мес (~260 статей)", "included": true}'::jsonb) WHERE id = 'pro';
