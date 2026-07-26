UPDATE public.document_types
SET pdf_template_config = COALESCE(pdf_template_config, '{}'::jsonb) || jsonb_build_object('use_stock_photos', false)
WHERE slug = 'expert_pdf';