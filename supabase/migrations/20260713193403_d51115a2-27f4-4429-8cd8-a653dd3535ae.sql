
-- Align credit costs to unified grid: Opus 8 / Sonnet 5 / Flash 3 / Lite 1
UPDATE public.ai_models SET credit_cost = 8, min_plan = 'basic' WHERE model_key = 'anthropic/claude-opus-4';
UPDATE public.ai_models SET credit_cost = 5, min_plan = 'basic' WHERE model_key = 'anthropic/claude-sonnet-4';
UPDATE public.ai_models SET credit_cost = 5, min_plan = 'basic' WHERE model_key = 'openai/gpt-5';
UPDATE public.ai_models SET credit_cost = 5, min_plan = 'basic' WHERE model_key = 'mistralai/mistral-large-2512';
UPDATE public.ai_models SET credit_cost = 3, min_plan = 'basic' WHERE model_key = 'openai/gpt-5-mini';
UPDATE public.ai_models SET credit_cost = 3, min_plan = 'nano'  WHERE model_key = 'google/gemini-2.5-pro';
UPDATE public.ai_models SET credit_cost = 3, min_plan = 'nano'  WHERE model_key = 'google/gemini-2.5-flash';
UPDATE public.ai_models SET credit_cost = 3, min_plan = 'nano'  WHERE model_key = 'google/gemini-3-flash-preview';
UPDATE public.ai_models SET credit_cost = 3, min_plan = 'nano'  WHERE model_key = 'openai/gpt-5-nano';
UPDATE public.ai_models SET credit_cost = 1, min_plan = 'nano'  WHERE model_key = 'google/gemini-2.5-flash-lite';
