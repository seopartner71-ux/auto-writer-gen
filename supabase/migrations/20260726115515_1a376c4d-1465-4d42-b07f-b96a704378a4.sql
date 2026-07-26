
UPDATE public.document_types SET primary_model = 'google/gemini-2.5-flash', fallback_model = 'google/gemini-2.5-flash-lite' WHERE slug IN ('checklist','memo','howto');
UPDATE public.document_types SET primary_model = 'google/gemini-2.5-pro', fallback_model = 'google/gemini-2.5-flash' WHERE slug = 'guide';
