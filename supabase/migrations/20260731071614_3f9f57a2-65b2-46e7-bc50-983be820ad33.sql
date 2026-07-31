UPDATE public.document_types
SET primary_model = 'google/gemini-2.5-flash',
    fallback_model = 'google/gemini-2.5-pro',
    updated_at = now()
WHERE slug IN ('catalog','comparison_review','encyclopedia','whitepaper');