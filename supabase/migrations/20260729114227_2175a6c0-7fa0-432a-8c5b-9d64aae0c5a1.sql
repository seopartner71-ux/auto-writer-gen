UPDATE public.document_types
SET post_checks_config =
  CASE
    WHEN post_checks_config @> '[{"type": "no_invented_brands"}]'::jsonb THEN post_checks_config
    ELSE COALESCE(post_checks_config, '[]'::jsonb) || '[{"type": "no_invented_brands"}]'::jsonb
  END,
  updated_at = now()
WHERE is_active = true AND category = 'pdf';