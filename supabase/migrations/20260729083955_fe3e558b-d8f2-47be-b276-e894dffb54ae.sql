UPDATE public.document_types
SET primary_model = 'google/gemini-2.5-pro',
    fallback_model = 'google/gemini-2.5-flash',
    updated_at = now();