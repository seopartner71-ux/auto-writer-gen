
-- Fix 1: add archived_reason column and mark 'guide' as duplicate of expert_pdf.
ALTER TABLE public.document_types
  ADD COLUMN IF NOT EXISTS archived_reason text;

DO $$
DECLARE
  v_guide_id uuid;
  v_expert_id uuid;
  v_updated int;
BEGIN
  SELECT id INTO v_guide_id FROM public.document_types WHERE slug = 'guide';
  SELECT id INTO v_expert_id FROM public.document_types WHERE slug = 'expert_pdf';

  IF v_guide_id IS NOT NULL AND v_expert_id IS NOT NULL THEN
    UPDATE public.ecosystem_formats
    SET document_type_id = v_expert_id
    WHERE document_type_id = v_guide_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    UPDATE public.document_types
    SET is_active = false,
        archived_reason = 'duplicate_of_expert_pdf'
    WHERE id = v_guide_id;

    RAISE NOTICE '[DEDUP] merged duplicate document_type ''guide'' into ''expert_pdf'', updated % ecosystem_formats', v_updated;
  END IF;
END $$;

-- Fix 5: post_checks_config updates for checklist / memo / howto.
UPDATE public.document_types
SET post_checks_config = COALESCE(post_checks_config, '{}'::jsonb) ||
  jsonb_build_object(
    'forbidden_openings',
    jsonb_build_array(
      'В этой статье','В этом чек-листе','В этой памятке','В этой инструкции',
      'Как известно','Многие задаются вопросом','Стоит отметить','Важно понимать',
      'Рассмотрим','Разберём'
    )
  )
WHERE slug = 'checklist';

-- memo/howto/expert_pdf/guide store post_checks_config as a JSON ARRAY of rules.
-- Append a no_forbidden_openings rule (idempotent: skip if already present).
UPDATE public.document_types
SET post_checks_config = post_checks_config || jsonb_build_array(
  jsonb_build_object(
    'type','no_forbidden_openings',
    'phrases', jsonb_build_array(
      'В этой статье','В этом чек-листе','В этой памятке','В этой инструкции',
      'Как известно','Многие задаются вопросом','Стоит отметить','Важно понимать',
      'Рассмотрим','Разберём'
    )
  )
)
WHERE slug IN ('memo','howto')
  AND jsonb_typeof(post_checks_config) = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(post_checks_config) e
    WHERE e->>'type' = 'no_forbidden_openings'
  );

UPDATE public.document_types
SET post_checks_config = post_checks_config || jsonb_build_array(
  jsonb_build_object('type','no_invented_brands')
)
WHERE slug IN ('memo','howto')
  AND jsonb_typeof(post_checks_config) = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(post_checks_config) e
    WHERE e->>'type' = 'no_invented_brands'
  );
